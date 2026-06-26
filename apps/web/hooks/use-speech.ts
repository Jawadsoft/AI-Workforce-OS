'use client'

import { useRef, useState, useCallback, useEffect } from 'react'

// ── Web Speech API types ───────────────────────────────────────────────────────
// TypeScript's DOM lib doesn't always expose SpeechRecognition as a standalone
// global type (only on window.*). Declare a minimal local interface instead.
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: { transcript: string; confidence: number }
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
  item(index: number): SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}
interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
}

/**
 * Extracts complete sentences from the buffer.
 * Returns the sentences found and the leftover tail that isn't a full sentence yet.
 * Minimum sentence length: 12 chars — avoids sending single words to ElevenLabs.
 */
function extractSentences(buffer: string): { sentences: string[]; remaining: string } {
  const sentences: string[] = []
  // Match sentence-ending punctuation followed by whitespace + uppercase (new sentence)
  // or end of string
  const re = /[.!?]+(?:\s+(?=[A-Z"'(])|$)/g
  let lastIdx = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(buffer)) !== null) {
    const end     = match.index + match[0].trimEnd().length
    const sentence = buffer.slice(lastIdx, end).trim()
    if (sentence.length >= 12) {
      sentences.push(sentence)
      lastIdx = re.lastIndex
    }
  }

  return { sentences, remaining: buffer.slice(lastIdx) }
}

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1')
    : 'http://localhost:3001/api/v1'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseSpeechReturn {
  isListening:       boolean
  isSpeaking:        boolean
  ttsEnabled:        boolean
  sttSupported:      boolean
  startListening:    () => void
  stopListening:     () => void
  toggleListening:   () => void
  /** Streaming TTS: call once per sentence as LLM tokens arrive */
  addSpeechChunk:    (text: string, agentName?: string, agentId?: string) => void
  /** Call after stream ends — flushes any remaining sentence buffer */
  flushSpeechBuffer: (agentName?: string, agentId?: string) => void
  /** Stop playback and clear the whole queue (barge-in / mute) */
  stopSpeaking:      () => void
  toggleTts:         () => void
  interimText:       string
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSpeech(
  onTranscript:   (text: string) => void,
  onQueueDrained?: () => void,  // called when all queued audio has finished playing
): UseSpeechReturn {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking,  setIsSpeaking]  = useState(false)
  const [ttsEnabled,  setTtsEnabled]  = useState(false)
  const [interimText, setInterimText] = useState('')

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // Queue: each entry is a Promise<string | null> (object URL or null on error)
  const queueRef        = useRef<Array<Promise<string | null>>>([])
  const isPlayingRef    = useRef(false)
  const cancelledRef    = useRef(false)   // set true on stopSpeaking, reset on new stream

  // Sentence accumulation buffer (for streaming)
  const sentenceBufferRef = useRef('')

  // Refs so callbacks can access latest values without stale closures
  const ttsEnabledRef      = useRef(ttsEnabled)
  const onQueueDrainedRef  = useRef(onQueueDrained)
  useEffect(() => { ttsEnabledRef.current = ttsEnabled }, [ttsEnabled])
  useEffect(() => { onQueueDrainedRef.current = onQueueDrained }, [onQueueDrained])

  const sttSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  // ── Clean up on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      currentAudioRef.current?.pause()
    }
  }, [])

  // ── Internal: fetch one sentence from backend ─────────────────────────

  const fetchAudio = useCallback(
    (text: string, agentName?: string, agentId?: string): Promise<string | null> => {
      const authToken =
        typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      return fetch(`${API_BASE}/chat/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ text, agentName, agentId }),
      })
        .then(r => r.ok ? r.blob() : Promise.reject(r.status))
        .then(blob => URL.createObjectURL(blob))
        .catch(err => { console.warn('[TTS] fetch failed:', err); return null })
    },
    [],
  )

  // ── Internal: sequential queue player ────────────────────────────────

  const playQueue = useCallback(async () => {
    if (isPlayingRef.current) return     // already running
    isPlayingRef.current = true
    cancelledRef.current = false
    setIsSpeaking(true)

    while (queueRef.current.length > 0 && !cancelledRef.current) {
      const urlPromise = queueRef.current.shift()!
      const url = await urlPromise
      if (!url || cancelledRef.current) continue

      await new Promise<void>(resolve => {
        const audio = new Audio(url)
        currentAudioRef.current = audio
        const cleanup = () => { URL.revokeObjectURL(url); resolve() }
        audio.onended = cleanup
        audio.onerror = cleanup
        audio.play().catch(cleanup)
      })
    }

    isPlayingRef.current = false
    if (!cancelledRef.current) {
      setIsSpeaking(false)
      onQueueDrainedRef.current?.()
    }
  }, [])

  // ── Public: stop everything ───────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    cancelledRef.current = true
    queueRef.current = []
    sentenceBufferRef.current = ''
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.currentTime = 0
      currentAudioRef.current = null
    }
    isPlayingRef.current = false
    setIsSpeaking(false)
  }, [])

  // ── Public: add a sentence chunk (streaming) ──────────────────────────

  /**
   * Accepts raw token text accumulated from the LLM stream.
   * Internally buffers it, extracts complete sentences, and fires
   * parallel ElevenLabs fetches — then feeds them into the sequential player.
   */
  const addSpeechChunk = useCallback((token: string, agentName?: string, agentId?: string) => {
    if (!ttsEnabledRef.current) return
    sentenceBufferRef.current += token
    const { sentences, remaining } = extractSentences(
      stripMarkdown(sentenceBufferRef.current)
    )
    sentenceBufferRef.current = remaining

    if (sentences.length === 0) return

    for (const sentence of sentences) {
      queueRef.current.push(fetchAudio(sentence, agentName, agentId))
    }
    playQueue()
  }, [fetchAudio, playQueue])

  const flushSpeechBuffer = useCallback((agentName?: string, agentId?: string) => {
    if (!ttsEnabledRef.current) return
    const remaining = stripMarkdown(sentenceBufferRef.current).trim()
    sentenceBufferRef.current = ''
    if (remaining.length >= 3) {
      queueRef.current.push(fetchAudio(remaining, agentName, agentId))
      playQueue()
    } else if (queueRef.current.length === 0 && !isPlayingRef.current) {
      onQueueDrainedRef.current?.()
    }
  }, [fetchAudio, playQueue])

  const toggleTts = useCallback(() => {
    setTtsEnabled(prev => {
      if (prev) stopSpeaking()
      return !prev
    })
  }, [stopSpeaking])

  // ── STT ──────────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)
    setInterimText('')
  }, [])

  const startListening = useCallback(() => {
    if (!sttSupported) return
    stopSpeaking()   // barge-in: kill audio

    const SR: new () => SpeechRecognitionInstance =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    const r = new SR()
    r.continuous     = false
    r.interimResults = true
    r.lang           = 'en-US'

    r.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ''
      let final   = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setInterimText(interim || final)
      if (final) { onTranscript(final.trim()); setInterimText('') }
    }

    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== 'no-speech') console.warn('[STT] error:', e.error)
      setIsListening(false); setInterimText('')
    }

    r.onend = () => { setIsListening(false); setInterimText(''); recognitionRef.current = null }

    r.start()
    recognitionRef.current = r
    setIsListening(true)
  }, [sttSupported, stopSpeaking, onTranscript])

  const toggleListening = useCallback(() => {
    if (isListening) stopListening()
    else             startListening()
  }, [isListening, startListening, stopListening])

  return {
    isListening,
    isSpeaking,
    ttsEnabled,
    sttSupported,
    startListening,
    stopListening,
    toggleListening,
    addSpeechChunk,
    flushSpeechBuffer,
    stopSpeaking,
    toggleTts,
    interimText,
  }
}
