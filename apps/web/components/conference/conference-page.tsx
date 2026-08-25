'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn, resolveAvatarUrl } from '@/lib/utils'
import { useSpeech } from '@/hooks/use-speech'
import { useFeatures, FEATURES } from '@/hooks/use-features'
import { Lock } from 'lucide-react'
import {
  Loader2,
  Mic,
  MicOff,
  Radio,
  Send,
  Users,
  Crown,
  MessageSquare,
  Volume2,
  VolumeX,
} from 'lucide-react'

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`)
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1')

type Agent = {
  id: string
  name: string
  role: string
  avatarUrl?: string | null
}

type ConferenceMessage = {
  id: string
  role: string
  content: string
  agentId?: string | null
  speakerName: string
  speakerType: string
  turnId?: string
  routingMethod?: string
  interrupted?: boolean
  createdAt: string
  avatarUrl?: string | null
}

type ConferenceSession = {
  id: string
  title?: string
  status?: string
  meetingType?: string
  meetingTypeLabel?: string
  agenda?: string
  chairAgentId: string
  participantAgentIds: string[]
  participants: Array<{
    id: string
    name: string
    role: string
    avatarUrl?: string | null
    aliases?: string[]
  }>
  listeningEnabled: boolean
  messages: ConferenceMessage[]
  activeTurn: {
    turnId: string
    status: string
    selectedAgentId: string | null
    routingMethod: string | null
  } | null
}

type PastSession = {
  id: string
  title?: string | null
  status: string
  meetingType: string
  meetingTypeLabel: string
  agenda: string
  messageCount: number
  updatedAt: string
}

function clientTurnId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function ConferencePage() {
  const { isEnabled, isLoading: featuresLoading } = useFeatures()
  const qc = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [chairId, setChairId] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [manualAgentId, setManualAgentId] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [autoListen, setAutoListen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sessionIdRef = useRef(sessionId)
  const manualAgentIdRef = useRef(manualAgentId)
  const autoListenRef = useRef(autoListen)
  const turnBusyRef = useRef(false)
  const activeTurnIdRef = useRef<string | null>(null)
  const streamCompleteRef = useRef(true)
  const speechStartListeningRef = useRef<(() => void) | null>(null)
  const speechSequenceRef = useRef<((items: Array<{ text: string; agentName?: string; agentId?: string | null }>) => void) | null>(null)
  const speechSpeakRef = useRef<((text: string, agentName?: string, agentId?: string) => void) | null>(null)
  const speechStopListeningRef = useRef<(() => void) | null>(null)
  const speechIsPlayingRef = useRef<() => boolean>(() => false)

  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { manualAgentIdRef.current = manualAgentId }, [manualAgentId])
  useEffect(() => { autoListenRef.current = autoListen }, [autoListen])

  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['conference-agents'],
    queryFn: async () => {
      const r = await api.get('/conference/agents')
      return (r.data?.data ?? r.data ?? []) as Agent[]
    },
  })

  useEffect(() => {
    if (!agents.length || selectedIds.length) return
    setSelectedIds(agents.map((a) => a.id))
    setChairId(agents[0].id)
  }, [agents, selectedIds.length])

  const { data: pastSessions = [] } = useQuery({
    queryKey: ['conference-sessions'],
    queryFn: async () => {
      const r = await api.get('/conference/sessions')
      return (r.data?.data ?? r.data ?? []) as PastSession[]
    },
  })

  const { data: session, isFetching: sessionLoading } = useQuery({
    queryKey: ['conference-session', sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const r = await api.get(`/conference/sessions/${sessionId}`)
      return (r.data?.data ?? r.data) as ConferenceSession
    },
    refetchInterval: (q) => {
      const s = q.state.data as ConferenceSession | undefined
      if (s?.activeTurn && !['COMPLETE', 'SILENCE', 'INTERRUPTED'].includes(s.activeTurn.status)) {
        return 1500
      }
      return sessionId ? 8000 : false
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.messages?.length])

  const submitTurn = useMutation({
    mutationFn: async (text: string) => {
      const sid = sessionIdRef.current
      if (!sid) throw new Error('No session')
      turnBusyRef.current = true
      streamCompleteRef.current = false
      speechStopListeningRef.current?.()

      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      const clientId = clientTurnId()
      const res = await fetch(`${API_BASE}/conference/sessions/${sid}/turns/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          clientTurnId: clientId,
          ...(manualAgentIdRef.current ? { manualAgentId: manualAgentIdRef.current } : {}),
        }),
      })
      if (!res.ok || !res.body) {
        throw new Error(`Turn failed (${res.status})`)
      }

      setDraft('')
      setManualAgentId(null)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: any = null
      let heardAgent = false

      const appendMessage = (msg: any) => {
        if (!msg || !sid) return
        qc.setQueryData(['conference-session', sid], (prev: any) => {
          if (!prev) return prev
          const exists = (prev.messages || []).some((m: any) => m.id === msg.id)
          if (exists) return prev
          return { ...prev, messages: [...(prev.messages || []), msg] }
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let data: any
          try {
            data = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (data.type === 'user' && data.userMessage) {
            activeTurnIdRef.current = data.turnId ?? null
            appendMessage(data.userMessage)
            const ids = data.selectedAgentIds || []
            setStatusNote(
              data.action === 'SILENCE'
                ? `Silence — ${data.reason || ''}`
                : ids.length > 1
                  ? `Routing ${ids.length} speakers (${data.routingMethod})…`
                  : `Routing (${data.routingMethod})…`,
            )
          } else if (data.type === 'generating') {
            const name = (data.speakerName || 'Agent').split(/[—(]/)[0].trim()
            setStatusNote(
              `${name} speaking (${(data.speakerIndex ?? 0) + 1}/${data.speakerCount || '?'})…`,
            )
          } else if (data.type === 'agent' && data.agentMessage) {
            heardAgent = true
            appendMessage(data.agentMessage)
            const name = (data.agentMessage.speakerName || 'Agent').split(/[—(]/)[0].trim()
            setStatusNote(
              `${name} · ${data.routingMethod || 'SPEAK'} (${(data.speakerIndex ?? 0) + 1}/${data.speakerCount || 1})`,
            )
            // Appear + play voice immediately for this agent, then next
            speechSpeakRef.current?.(
              data.agentMessage.content,
              data.agentMessage.speakerName,
              data.agentMessage.agentId || undefined,
            )
          } else if (data.type === 'done') {
            finalResult = data
            streamCompleteRef.current = true
            if (data.action === 'SILENCE') {
              setStatusNote(`Silence — ${data.reason || 'no reply needed'}`)
              turnBusyRef.current = false
              if (autoListenRef.current) {
                setTimeout(() => speechStartListeningRef.current?.(), 300)
              }
            } else if (!heardAgent) {
              turnBusyRef.current = false
              if (autoListenRef.current) {
                setTimeout(() => speechStartListeningRef.current?.(), 300)
              }
            } else if (!speechIsPlayingRef.current()) {
              // TTS already finished while later agents were generating
              turnBusyRef.current = false
              if (autoListenRef.current) {
                setTimeout(() => speechStartListeningRef.current?.(), 300)
              }
            }
          } else if (data.type === 'error') {
            streamCompleteRef.current = true
            throw new Error(data.message || 'Turn failed')
          }
        }
      }

      await qc.invalidateQueries({ queryKey: ['conference-session', sid] })
      return finalResult
    },
    onError: (err: any) => {
      turnBusyRef.current = false
      setStatusNote(err?.message || 'Turn failed')
      if (autoListenRef.current) {
        setTimeout(() => speechStartListeningRef.current?.(), 400)
      }
    },
  })

  const submitTurnRef = useRef(submitTurn.mutate)
  useEffect(() => { submitTurnRef.current = submitTurn.mutate }, [submitTurn.mutate])

  const handleVoiceTranscript = useCallback((text: string) => {
    const t = text.trim()
    if (!t || !sessionIdRef.current || turnBusyRef.current) return
    setDraft(t)
    setStatusNote(`Heard: “${t}”`)
    submitTurnRef.current(t)
  }, [])

  const onQueueDrained = useCallback(() => {
    // Don't reopen the mic while more agents are still being generated
    if (!streamCompleteRef.current) return
    turnBusyRef.current = false
    activeTurnIdRef.current = null
    if (autoListenRef.current && sessionIdRef.current) {
      speechStartListeningRef.current?.()
    }
  }, [])

  const {
    isListening,
    isSpeaking,
    ttsEnabled,
    sttSupported,
    startListening,
    stopListening,
    speakText,
    speakSequence,
    isAudioPlaying,
    stopSpeaking,
    toggleTts,
    interimText,
  } = useSpeech(handleVoiceTranscript, onQueueDrained, { defaultTtsEnabled: true })

  useEffect(() => { speechStartListeningRef.current = startListening }, [startListening])
  useEffect(() => { speechSequenceRef.current = speakSequence }, [speakSequence])
  useEffect(() => { speechSpeakRef.current = speakText }, [speakText])
  useEffect(() => { speechStopListeningRef.current = stopListening }, [stopListening])
  useEffect(() => { speechIsPlayingRef.current = isAudioPlaying }, [isAudioPlaying])

  const bargeIn = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return
    stopSpeaking()
    try {
      await api.post(`/conference/sessions/${sid}/barge-in`, {
        turnId: activeTurnIdRef.current || undefined,
      })
    } catch {
      /* non-fatal */
    }
    turnBusyRef.current = false
  }, [stopSpeaking])

  const onMicClick = useCallback(async () => {
    if (!sessionId) return
    if (isSpeaking) {
      await bargeIn()
      startListening()
      setStatusNote('Interrupted — listening…')
      return
    }
    if (isListening) {
      stopListening()
      setStatusNote('Mic off')
      return
    }
    startListening()
    setStatusNote('Listening… say an agent’s name to give them the floor')
  }, [sessionId, isSpeaking, isListening, bargeIn, startListening, stopListening])

  const createSession = useMutation({
    mutationFn: async () => {
      const r = await api.post('/conference/sessions', {
        participantAgentIds: selectedIds,
        chairAgentId: chairId || selectedIds[0],
        meetingType: 'MANAGEMENT',
      })
      return (r.data?.data ?? r.data) as ConferenceSession
    },
    onSuccess: (s) => {
      setSessionId(s.id)
      setManualAgentId(null)
      setStatusNote(
        `${s.meetingTypeLabel || 'Management'} meeting ready — tap the mic or speak.`,
      )
      qc.setQueryData(['conference-session', s.id], s)
      qc.invalidateQueries({ queryKey: ['conference-sessions'] })
      setTimeout(() => {
        if (sttSupported && autoListenRef.current) startListening()
      }, 400)
    },
  })

  const endRoom = useCallback(async () => {
    const sid = sessionIdRef.current
    stopListening()
    stopSpeaking()
    if (sid) {
      try {
        await api.post(`/conference/sessions/${sid}/close`)
      } catch {
        /* non-fatal */
      }
    }
    setSessionId(null)
    setStatusNote(null)
    setManualAgentId(null)
    turnBusyRef.current = false
    activeTurnIdRef.current = null
    qc.invalidateQueries({ queryKey: ['conference-sessions'] })
  }, [stopListening, stopSpeaking, qc])

  const updateParticipants = useMutation({
    mutationFn: async (patch: {
      participantAgentIds?: string[]
      chairAgentId?: string
    }) => {
      if (!sessionId) return
      const r = await api.patch(`/conference/sessions/${sessionId}/participants`, patch)
      return r.data?.data ?? r.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conference-session', sessionId] })
    },
  })

  const toggleParticipant = (id: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      if (sessionId) {
        updateParticipants.mutate({
          participantAgentIds: next,
          chairAgentId: next.includes(chairId) ? chairId : next[0],
        })
      }
      if (!next.includes(chairId) && next[0]) setChairId(next[0])
      return next
    })
  }

  const onSend = useCallback(() => {
    const text = draft.trim()
    if (!text || submitTurn.isPending || !sessionId || turnBusyRef.current) return
    stopListening()
    submitTurn.mutate(text)
  }, [draft, sessionId, submitTurn, stopListening])

  const participants = useMemo(() => {
    if (session?.participants?.length) return session.participants
    return agents.filter((a) => selectedIds.includes(a.id))
  }, [session, agents, selectedIds])

  if (!featuresLoading && !isEnabled(FEATURES.CONFERENCE)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Conference / War Room</h2>
          <p className="text-muted-foreground text-sm">This feature is not enabled for your account. Contact your administrator to enable it.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
      {/* Participants panel */}
      <aside className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-card lg:w-72">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            Conference
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shared room · one speaker per turn · address by name
          </p>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {agentsLoading && (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
            </div>
          )}
          {agents.map((a) => {
            const active = selectedIds.includes(a.id)
            const isChair = (session?.chairAgentId || chairId) === a.id
            const isManual = manualAgentId === a.id
            return (
              <div
                key={a.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors',
                  active ? 'border-border bg-background' : 'border-transparent opacity-50',
                  isManual && 'ring-1 ring-primary',
                )}
              >
                <button
                  type="button"
                  title={active ? 'Click to address next' : 'Add to room'}
                  onClick={() => {
                    if (!active) {
                      toggleParticipant(a.id)
                      return
                    }
                    if (sessionId) setManualAgentId(isManual ? null : a.id)
                  }}
                  className="relative shrink-0"
                >
                  {a.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveAvatarUrl(a.avatarUrl) || a.avatarUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {a.name.slice(0, 1)}
                    </div>
                  )}
                  {isChair && (
                    <Crown className="absolute -right-1 -top-1 h-3.5 w-3.5 text-amber-500" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name.split(/[—(]/)[0].trim()}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{a.role}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleParticipant(a.id)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                >
                  {active ? 'In' : 'Out'}
                </button>
                {!sessionId && (
                  <button
                    type="button"
                    title="Set as chair"
                    onClick={() => setChairId(a.id)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      isChair ? 'bg-amber-500/15 text-amber-600' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    Chair
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="space-y-2 border-t border-border p-3">
          {!sessionId ? (
            <>
              <button
                type="button"
                disabled={!selectedIds.length || createSession.isPending}
                onClick={() => createSession.mutate()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {createSession.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Radio className="h-4 w-4" />
                )}
                Start Management conference
              </button>
              {pastSessions.length > 0 && (
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Past meetings
                  </p>
                  {pastSessions.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSessionId(p.id)
                        setStatusNote(`Reopened · ${p.meetingTypeLabel}`)
                      }}
                      className="flex w-full flex-col rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted/60"
                    >
                      <span className="truncate text-xs font-medium">
                        {p.title || p.meetingTypeLabel}
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {p.messageCount} msgs · {new Date(p.updatedAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => void endRoom()}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              End / save memory
            </button>
          )}

          {sessionId && (
            <>
              <button
                type="button"
                onClick={onMicClick}
                disabled={!sttSupported}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isListening
                    ? 'bg-red-500/15 text-red-600 ring-1 ring-red-500/40'
                    : isSpeaking
                      ? 'bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/40'
                      : 'bg-muted hover:bg-muted/80',
                  !sttSupported && 'opacity-50',
                )}
              >
                {isListening ? <Mic className="h-4 w-4 animate-pulse" /> : <MicOff className="h-4 w-4" />}
                {isListening ? 'Listening… tap to stop' : isSpeaking ? 'Tap to interrupt' : 'Tap to speak'}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAutoListen((v) => !v)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px]',
                    autoListen ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                  )}
                >
                  <Mic className="h-3 w-3" />
                  Auto-listen {autoListen ? 'on' : 'off'}
                </button>
                <button
                  type="button"
                  onClick={toggleTts}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px]',
                    ttsEnabled ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                  )}
                >
                  {ttsEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                  Agent voice {ttsEnabled ? 'on' : 'off'}
                </button>
              </div>
            </>
          )}

          <div className="text-[11px] text-muted-foreground">
            {!sttSupported
              ? 'Web Speech not supported in this browser — use Chrome/Edge, or type.'
              : isListening
                ? interimText
                  ? `Hearing: ${interimText}`
                  : 'Mic live — speak now'
                : isSpeaking
                  ? 'Agent speaking…'
                  : 'Web Speech in · ElevenLabs out'}
          </div>
        </div>
      </aside>

      {/* Transcript */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              {session?.title || 'Conference transcript'}
            </div>
            {session?.meetingTypeLabel && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {session.meetingTypeLabel}
                {session.agenda
                  ? ` · ${session.agenda.length > 90 ? `${session.agenda.slice(0, 90)}…` : session.agenda}`
                  : ''}
              </p>
            )}
            {statusNote && (
              <p className="mt-0.5 text-xs text-muted-foreground">{statusNote}</p>
            )}
            {manualAgentId && (
              <p className="mt-0.5 text-xs text-primary">
                Next turn → {participants.find((p) => p.id === manualAgentId)?.name || 'selected agent'}
              </p>
            )}
          </div>
          {(submitTurn.isPending || isSpeaking) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {submitTurn.isPending ? 'Routing / generating…' : 'Speaking…'}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!sessionId && (
            <div className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
              Pick participants, set a chair, then start the conference. Use the mic or type — say an agent’s name to give them the floor.
            </div>
          )}
          {sessionId && sessionLoading && !session && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading transcript…
            </div>
          )}
          {session?.messages?.map((m) => (
            <div
              key={m.id}
              className={cn(
                'flex gap-3',
                m.speakerType === 'USER' ? 'justify-end' : 'justify-start',
              )}
            >
              {m.speakerType !== 'USER' && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {(m.speakerName || '?').slice(0, 1)}
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
                  m.speakerType === 'USER'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60',
                  m.interrupted && 'opacity-70',
                )}
              >
                <div className="mb-0.5 flex items-center gap-2 text-[11px] opacity-70">
                  <span className="font-medium">{m.speakerName}</span>
                  {m.routingMethod && m.speakerType === 'AGENT' && (
                    <span>· {m.routingMethod}</span>
                  )}
                  {m.interrupted && <span>· interrupted</span>}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              </div>
            </div>
          ))}
          {isListening && interimText && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl border border-dashed border-primary/40 px-3.5 py-2 text-sm italic text-muted-foreground">
                {interimText}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={onMicClick}
              disabled={!sessionId || !sttSupported}
              title={!sttSupported ? 'Speech recognition not supported' : 'Speak'}
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40',
                isListening
                  ? 'border-red-500/50 bg-red-500/15 text-red-600'
                  : 'border-border bg-background hover:bg-muted',
              )}
            >
              {isListening ? <Mic className="h-4 w-4 animate-pulse" /> : <MicOff className="h-4 w-4" />}
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
              }}
              disabled={!sessionId || submitTurn.isPending}
              rows={2}
              placeholder={
                sessionId
                  ? isListening
                    ? 'Listening… or type here'
                    : manualAgentId
                      ? 'Message the selected agent…'
                      : 'e.g. Will, what’s our team size?'
                  : 'Start a conference first…'
              }
              className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!sessionId || !draft.trim() || submitTurn.isPending}
              onClick={onSend}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
            >
              {submitTurn.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
