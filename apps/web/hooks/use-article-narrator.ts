'use client'

import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'

export interface NarratorChunk {
  /** Optional key used to highlight the matching bit of UI while it's being read. */
  key?: string
  text: string
}

export interface UseArticleNarratorReturn {
  isSpeaking: boolean
  activeChunkKey: string | null
  /** Play a sequence of text chunks back-to-back via the server's TTS proxy. */
  play: (chunks: NarratorChunk[]) => Promise<void>
  stop: () => void
}

/**
 * Lightweight "read this aloud" narrator for static help content.
 * Reuses the same server-side ElevenLabs proxy (`POST /chat/tts`) as the
 * chat voice mode, but plays a fixed list of chunks sequentially instead
 * of buffering a live LLM token stream.
 */
export function useArticleNarrator(): UseArticleNarratorReturn {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [activeChunkKey, setActiveChunkKey] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    cancelledRef.current = true
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    setIsSpeaking(false)
    setActiveChunkKey(null)
  }, [])

  const play = useCallback(async (chunks: NarratorChunk[]) => {
    stop()
    cancelledRef.current = false
    setIsSpeaking(true)

    let anySucceeded = false

    for (const chunk of chunks) {
      if (cancelledRef.current) break
      setActiveChunkKey(chunk.key ?? null)

      let url: string | null = null
      try {
        const res = await api.post('/chat/tts', { text: chunk.text }, { responseType: 'blob' })
        url = URL.createObjectURL(res.data)
        anySucceeded = true
      } catch (err) {
        console.warn('[Narrator] TTS request failed:', err)
        continue
      }

      if (cancelledRef.current) {
        URL.revokeObjectURL(url)
        break
      }

      await new Promise<void>((resolve) => {
        const audio = new Audio(url!)
        audioRef.current = audio
        const cleanup = () => { URL.revokeObjectURL(url!); resolve() }
        audio.onended = cleanup
        audio.onerror = cleanup
        audio.play().catch(cleanup)
      })
    }

    if (!cancelledRef.current) {
      setIsSpeaking(false)
      setActiveChunkKey(null)
    }
    if (!anySucceeded) {
      throw new Error('Voice narration is unavailable right now.')
    }
  }, [stop])

  return { isSpeaking, activeChunkKey, play, stop }
}
