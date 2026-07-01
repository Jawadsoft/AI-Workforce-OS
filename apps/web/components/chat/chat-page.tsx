'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Send, MessageSquare, Loader2, Zap, Globe, Mail, Phone, LayoutList, MessageCircle, Trash2, Mic, MicOff, Volume2, VolumeX, Paperclip, X, FileText, Image, ChevronLeft } from 'lucide-react'
import { useSpeech } from '@/hooks/use-speech'
import { CRMRecordCard } from './crm-record-card'
import { ChatActionCard, type ActionCard } from './action-cards'
import { resolveAvatarUrl } from '@/lib/utils'
import { useFeatures, FEATURES } from '@/hooks/use-features'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

type FilterTab = 'all' | 'chat' | 'activity' | 'email' | 'calls' | 'whatsapp' | 'website' | 'crm'

const TICKET_BRIEF_TYPES = ['TICKET_BRIEF', 'SPECIALIST_UPDATE', 'TICKET_ASSIGNED']

const FILTER_TABS: { id: FilterTab; label: string; icon: React.ReactNode; match: (b?: string | null) => boolean; comingSoon?: boolean }[] = [
  { id: 'all',      label: 'All',        icon: <LayoutList className="w-3.5 h-3.5" />,    match: () => true },
  { id: 'chat',     label: 'Agent Chat', icon: <MessageSquare className="w-3.5 h-3.5" />, match: (b) => !b },
  { id: 'activity', label: 'Activity',   icon: <Zap className="w-3.5 h-3.5" />,           match: (b) => !!b && TICKET_BRIEF_TYPES.includes(b) },
  { id: 'email',    label: 'Emails',     icon: <Mail className="w-3.5 h-3.5" />,          match: (b) => b === 'email_briefing' },
  { id: 'calls',    label: 'Calls',      icon: <Phone className="w-3.5 h-3.5" />,         match: (b) => b === 'call_briefing',             comingSoon: true },
  { id: 'whatsapp', label: 'WhatsApp',   icon: <MessageCircle className="w-3.5 h-3.5" />, match: (b) => b === 'whatsapp_briefing', comingSoon: true },
  { id: 'website',  label: 'Website',    icon: <Globe className="w-3.5 h-3.5" />,         match: (b) => b === 'widget' },
  { id: 'crm',      label: 'CRM',        icon: <Zap className="w-3.5 h-3.5" />,           match: (b) => !!b && !TICKET_BRIEF_TYPES.includes(b) && !['email_briefing','call_briefing','whatsapp_briefing','widget'].includes(b) },
]

interface Attachment {
  url: string
  name: string
  mimeType: string
}

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  briefingType?: string | null
  attachments?: Attachment[]
  metadata?: { actionCards?: ActionCard[] } | null
  createdAt: string
  streaming?: boolean
}

// ── Markdown renderer ───────────────────────────────────────────────
function renderMarkdown(text: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-semibold leading-tight">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold leading-tight">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-sm font-semibold leading-tight">{children}</h3>,
        p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        hr: () => <hr className="my-3 border-border" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border-b border-border bg-muted/50 px-3 py-2 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
        code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
        pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{children}</pre>,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

// ── Briefing badge ─────────────────────────────────────────────────
const BRIEFING_LABELS: Record<string, { label: string; color: string }> = {
  'TICKET_BRIEF':       { label: 'Ticket Update',    color: 'bg-slate-500/10 text-slate-600' },
  'SPECIALIST_UPDATE':  { label: 'Team Update',      color: 'bg-violet-500/10 text-violet-700' },
  'TICKET_ASSIGNED':    { label: 'Ticket Assigned',  color: 'bg-amber-500/10 text-amber-700' },
  'lead.created':       { label: 'New Lead',         color: 'bg-green-500/10 text-green-700' },
  'lead.updated':       { label: 'Lead Updated',     color: 'bg-blue-500/10 text-blue-700' },
  'job.created':        { label: 'New Job',           color: 'bg-orange-500/10 text-orange-700' },
  'job.scheduled':      { label: 'Job Scheduled',    color: 'bg-purple-500/10 text-purple-700' },
  'job.completed':      { label: 'Job Completed',    color: 'bg-green-500/10 text-green-700' },
  'proposal.sent':      { label: 'Proposal Sent',    color: 'bg-blue-500/10 text-blue-700' },
  'proposal.accepted':  { label: 'Proposal Accepted','color': 'bg-green-500/10 text-green-700' },
  'proposal.declined':  { label: 'Proposal Declined','color': 'bg-red-500/10 text-red-700' },
  'invoice.overdue':    { label: 'Invoice Overdue',  color: 'bg-red-500/10 text-red-700' },
  'message.received':   { label: 'Message',          color: 'bg-indigo-500/10 text-indigo-700' },
  'appointment.booked': { label: 'Appointment',      color: 'bg-teal-500/10 text-teal-700' },
  'widget':             { label: 'Website Chat',     color: 'bg-violet-500/10 text-violet-700' },
}

export function ChatPage() {
  const qc = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('chat')
  const [confirmClear, setConfirmClear] = useState(false)

  // ── Per-conversation stream state ──────────────────────────────────
  // Each agent conversation gets its own isolated streaming bucket so
  // switching agents never pollutes another agent's in-progress response.
  type StreamState = {
    sending: boolean
    streamingMsg: string | null
    pendingCards: ActionCard[]
    progressSteps: { label: string; status: 'active' | 'done' | 'error' }[]
    checkingWith: string | null
    typingAgent: string | null
    uploadedAttachment: Attachment | null
  }
  const [convStreams, setConvStreams] = useState<Record<string, StreamState>>({})
  const abortRefs = useRef<Record<string, AbortController>>({})

  const getStream = (cid: string): StreamState => convStreams[cid] ?? {
    sending: false, streamingMsg: null, pendingCards: [], progressSteps: [],
    checkingWith: null, typingAgent: null, uploadedAttachment: null,
  }
  const patchStream = (cid: string, patch: Partial<StreamState>) =>
    setConvStreams(prev => ({ ...prev, [cid]: { ...getStream(cid), ...prev[cid], ...patch } }))

  // Active conversation's stream state (drives the UI)
  const activeStream = conversationId ? getStream(conversationId) : {
    sending: false, streamingMsg: null, pendingCards: [], progressSteps: [],
    checkingWith: null, typingAgent: null, uploadedAttachment: null,
  }

  // Aliases for the rest of the component to keep existing code readable
  const sending         = activeStream.sending
  const streamingMsg    = activeStream.streamingMsg
  const pendingCards    = activeStream.pendingCards
  const progressSteps   = activeStream.progressSteps
  const checkingWith    = activeStream.checkingWith
  const typingAgent     = activeStream.typingAgent
  const uploadedAttachment = activeStream.uploadedAttachment

  // Legacy setters that forward to the active conversation's stream bucket
  const setSending         = (v: boolean)                  => conversationId && patchStream(conversationId, { sending: v })
  const setStreamingMsg    = (v: string | null)            => conversationId && patchStream(conversationId, { streamingMsg: v })
  const setPendingCards    = (v: ActionCard[] | ((p: ActionCard[]) => ActionCard[])) => conversationId && setConvStreams(prev => {
    const cur = prev[conversationId] ?? getStream(conversationId)
    return { ...prev, [conversationId]: { ...cur, pendingCards: typeof v === 'function' ? v(cur.pendingCards) : v } }
  })
  const setProgressSteps   = (v: { label: string; status: 'active' | 'done' | 'error' }[] | ((p: { label: string; status: 'active' | 'done' | 'error' }[]) => { label: string; status: 'active' | 'done' | 'error' }[])) => conversationId && setConvStreams(prev => {
    const cur = prev[conversationId] ?? getStream(conversationId)
    return { ...prev, [conversationId]: { ...cur, progressSteps: typeof v === 'function' ? v(cur.progressSteps) : v } }
  })
  const setCheckingWith    = (v: string | null)            => conversationId && patchStream(conversationId, { checkingWith: v })
  const setTypingAgent     = (v: string | null)            => conversationId && patchStream(conversationId, { typingAgent: v })
  const setUploadedAttachment = (v: Attachment | null)     => conversationId && patchStream(conversationId, { uploadedAttachment: v })

  // abortRef shim — per-conversation abort controllers
  const abortRef = {
    get current() { return conversationId ? abortRefs.current[conversationId] ?? null : null },
    set current(v: AbortController | null) { if (conversationId) { if (v) abortRefs.current[conversationId] = v; else delete abortRefs.current[conversationId] } },
  }
  const lastResponseRef = useRef<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const { isEnabled } = useFeatures()
  const fileUploadsEnabled = isEnabled(FEATURES.FILE_UPLOADS)
  // When TTS is on, we hold the pending refetch until after audio finishes
  // so the message text appears AFTER being spoken (hear-then-read)
  const [voiceRevealPending, setVoiceRevealPending] = useState(false)
  // Ref so sendText can always read the current agent name without being in deps
  const selectedAgentNameRef = useRef<string | undefined>(undefined)

  // ── Voice (STT + TTS) ────────────────────────────────────────────────
  const sendTextRef        = useRef<(t: string) => void>(() => {})
  const refetchAfterTtsRef = useRef<(() => void) | null>(null)

  const {
    isListening, isSpeaking, ttsEnabled, sttSupported,
    toggleListening, addSpeechChunk, flushSpeechBuffer, stopSpeaking, toggleTts, interimText,
  } = useSpeech(
    (transcript) => sendTextRef.current(transcript),
    // onQueueDrained: called when all audio chunks have finished playing
    () => {
      setVoiceRevealPending(false)
      refetchAfterTtsRef.current?.()
      refetchAfterTtsRef.current = null
    },
  )

  // ── Load active agents ─────────────────────────────────────────────
  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
    select: (data: any[]) => data.filter((a) => a.status === 'ACTIVE'),
  })

  // ── When agent selected, fetch/create their primary conversation ───
  const primaryQuery = useQuery({
    queryKey: ['primary-conv', selectedAgentId],
    queryFn: () => api.get(`/chat/agents/${selectedAgentId}/primary`).then((r) => r.data),
    enabled: !!selectedAgentId,
  })

  useEffect(() => {
    if (primaryQuery.data?.id) {
      setConversationId(primaryQuery.data.id)
      setPendingCards([])
      setStreamingMsg(null)
      setActiveFilter('chat')
    }
  }, [primaryQuery.data?.id])

  // ── Messages for current conversation ─────────────────────────────
  const { data: dbMessages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.get(`/chat/${conversationId}/messages`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!conversationId,
    refetchInterval: 5000, // Poll for new briefings
  })

  const allMessages: Message[] = [
    ...dbMessages,
    ...(streamingMsg !== null ? [{ id: '__stream__', role: 'ASSISTANT' as const, content: streamingMsg, createdAt: new Date().toISOString(), streaming: true }] : []),
  ]

  const activeTab = FILTER_TABS.find(t => t.id === activeFilter) ?? FILTER_TABS[0]
  const messages = allMessages.filter(m => {
    // Streaming message always shows
    if (m.id === '__stream__') return activeFilter === 'all' || activeFilter === 'chat'
    return activeTab.match(m.briefingType)
  })

  // Count per tab (excluding streaming)
  const tabCounts = Object.fromEntries(
    FILTER_TABS.map(t => [t.id, dbMessages.filter((m: Message) => t.match(m.briefingType)).length])
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingMsg])

  // ── Send / stream ──────────────────────────────────────────────────
  // sendText is the core function; handleSend is the button handler that reads from state
  const sendText = useCallback(async (text: string, fileOverride?: File | null) => {
    const file = fileOverride !== undefined ? fileOverride : pendingFile
    if (!text.trim() && !file) return
    if (!conversationId || sending) return

    // Snapshot the conversation ID at call time so this handler always
    // writes to the correct agent's stream bucket even if the user switches agents.
    const convId = conversationId

    // Helper: targeted patch that always writes to convId, not the active conversation
    const patchConv = (patch: Partial<StreamState>) =>
      setConvStreams(prev => {
        const cur = prev[convId] ?? {
          sending: false, streamingMsg: null, pendingCards: [], progressSteps: [],
          checkingWith: null, typingAgent: null, uploadedAttachment: null,
        }
        return { ...prev, [convId]: { ...cur, ...patch } }
      })

    setMessage('')
    setPendingFile(null)
    patchConv({ sending: true, streamingMsg: '', pendingCards: [] })

    abortRefs.current[convId]?.abort()
    const controller = new AbortController()
    abortRefs.current[convId] = controller

    const authToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null

    // Use POST multipart if there's a file, otherwise use GET stream
    const isMultipart = !!file
    const url = isMultipart
      ? `${API_BASE}/chat/${convId}/stream`
      : `${API_BASE}/chat/${convId}/stream?content=${encodeURIComponent(text)}`

    let fetchInit: RequestInit
    if (isMultipart) {
      const formData = new FormData()
      formData.append('content', text)
      if (file) formData.append('file', file)
      fetchInit = {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
        signal: controller.signal,
      }
    } else {
      fetchInit = {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      }
    }

    try {
      const resp = await fetch(url, fetchInit)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if (payload.typing) { patchConv({ typingAgent: payload.agentName ?? null }) }
            if (payload.attachment) { patchConv({ uploadedAttachment: payload.attachment as Attachment }) }
            if (payload.step) {
              const s = payload.step as { label: string; status: 'active' | 'done' | 'error' }
              setConvStreams(prev => {
                const cur = prev[convId] ?? { sending: false, streamingMsg: null, pendingCards: [], progressSteps: [], checkingWith: null, typingAgent: null, uploadedAttachment: null }
                const idx = cur.progressSteps.findIndex(p => p.label === s.label)
                const next = idx >= 0
                  ? cur.progressSteps.map((p, i) => i === idx ? s : p)
                  : [...cur.progressSteps, s]
                return { ...prev, [convId]: { ...cur, progressSteps: next } }
              })
            }
            if (payload.status && !accumulated) {
              patchConv({ typingAgent: null, checkingWith: null })
            }
            if (payload.token) {
              accumulated += payload.token
              patchConv({ streamingMsg: ttsEnabled ? null : accumulated, checkingWith: null, typingAgent: null })
              if (ttsEnabled) addSpeechChunk(payload.token, selectedAgentNameRef.current, selectedAgentId ?? undefined)
            }
            if (payload.checking) { patchConv({ checkingWith: payload.withName ?? 'team', typingAgent: null }) }
            if (payload.action_card) {
              setConvStreams(prev => {
                const cur = prev[convId] ?? { sending: false, streamingMsg: null, pendingCards: [], progressSteps: [], checkingWith: null, typingAgent: null, uploadedAttachment: null }
                return { ...prev, [convId]: { ...cur, pendingCards: [...cur.pendingCards, payload.action_card as ActionCard] } }
              })
            }
            if (payload.done) {
              patchConv({ streamingMsg: null, checkingWith: null, typingAgent: null, sending: false, progressSteps: [] })
              if (accumulated && ttsEnabled) {
                lastResponseRef.current = accumulated
                setVoiceRevealPending(true)
                flushSpeechBuffer(selectedAgentNameRef.current, selectedAgentId ?? undefined)
                refetchAfterTtsRef.current = () => {
                  qc.invalidateQueries({ queryKey: ['messages', convId] })
                  patchConv({ uploadedAttachment: null, pendingCards: [] })
                }
              } else {
                qc.invalidateQueries({ queryKey: ['messages', convId] })
                patchConv({ uploadedAttachment: null, pendingCards: [] })
                if (file) {
                  setTimeout(() => qc.invalidateQueries({ queryKey: ['messages', convId] }), 2500)
                }
              }
            }
            if (payload.error) { patchConv({ streamingMsg: `Error: ${payload.error}`, checkingWith: null, typingAgent: null }) }
          } catch { /* partial */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        patchConv({ streamingMsg: null, checkingWith: null, typingAgent: null, sending: false })
        setVoiceRevealPending(false); refetchAfterTtsRef.current = null
        try {
          await api.post(`/chat/${convId}/messages`, { content: text })
          qc.invalidateQueries({ queryKey: ['messages', convId] })
        } catch { /* ignore */ }
      }
    } finally {
      patchConv({ sending: false })
    }
  }, [conversationId, sending, qc, addSpeechChunk, flushSpeechBuffer, ttsEnabled])

  const handleSend = useCallback(() => {
    if (!message.trim() && !pendingFile) return
    sendText(message, pendingFile)  // pass pendingFile explicitly to avoid stale closure
  }, [message, pendingFile, sendText])

  // Keep sendTextRef current so the useSpeech onTranscript always calls the latest sendText
  useEffect(() => {
    sendTextRef.current = sendText
  }, [sendText])

  const selectedAgent = agents.find((a: any) => a.id === selectedAgentId)
  // Keep ref in sync so sendText (defined above) can read the agent name without stale closure
  selectedAgentNameRef.current = selectedAgent?.name

  // When user clicks a choice button in an ask_user card, auto-send it as a message
  const handleChoiceSelected = useCallback(async (choice: string) => {
    if (!conversationId || sending) return
    const convId = conversationId
    const patchConv = (patch: Partial<StreamState>) =>
      setConvStreams(prev => {
        const cur = prev[convId] ?? { sending: false, streamingMsg: null, pendingCards: [], progressSteps: [], checkingWith: null, typingAgent: null, uploadedAttachment: null }
        return { ...prev, [convId]: { ...cur, ...patch } }
      })

    patchConv({ sending: true, streamingMsg: '', pendingCards: [] })

    abortRefs.current[convId]?.abort()
    const controller = new AbortController()
    abortRefs.current[convId] = controller

    const authToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    const url = `${API_BASE}/chat/${convId}/stream?content=${encodeURIComponent(choice)}`

    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if (payload.typing) { patchConv({ typingAgent: payload.agentName ?? null }) }
            if (payload.step) {
              const s = payload.step as { label: string; status: 'active' | 'done' | 'error' }
              setConvStreams(prev => {
                const cur = prev[convId] ?? { sending: false, streamingMsg: null, pendingCards: [], progressSteps: [], checkingWith: null, typingAgent: null, uploadedAttachment: null }
                const idx = cur.progressSteps.findIndex(p => p.label === s.label)
                const next = idx >= 0 ? cur.progressSteps.map((p, i) => i === idx ? s : p) : [...cur.progressSteps, s]
                return { ...prev, [convId]: { ...cur, progressSteps: next } }
              })
            }
            if (payload.token) {
              accumulated += payload.token
              patchConv({ streamingMsg: ttsEnabled ? null : accumulated, checkingWith: null, typingAgent: null })
              if (ttsEnabled) addSpeechChunk(payload.token, selectedAgentNameRef.current, selectedAgentId ?? undefined)
            }
            if (payload.checking) { patchConv({ checkingWith: payload.withName ?? 'team', typingAgent: null }) }
            if (payload.action_card) {
              setConvStreams(prev => {
                const cur = prev[convId] ?? { sending: false, streamingMsg: null, pendingCards: [], progressSteps: [], checkingWith: null, typingAgent: null, uploadedAttachment: null }
                return { ...prev, [convId]: { ...cur, pendingCards: [...cur.pendingCards, payload.action_card as ActionCard] } }
              })
            }
            if (payload.done) {
              patchConv({ streamingMsg: null, checkingWith: null, typingAgent: null, sending: false, progressSteps: [] })
              if (accumulated && ttsEnabled) {
                lastResponseRef.current = accumulated
                setVoiceRevealPending(true)
                flushSpeechBuffer(selectedAgentNameRef.current, selectedAgentId ?? undefined)
                refetchAfterTtsRef.current = () => {
                  qc.invalidateQueries({ queryKey: ['messages', convId] })
                  patchConv({ pendingCards: [] })
                }
              } else {
                qc.invalidateQueries({ queryKey: ['messages', convId] })
                patchConv({ pendingCards: [] })
              }
            }
          } catch { /* partial */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        patchConv({ streamingMsg: null, checkingWith: null, typingAgent: null, sending: false })
        setVoiceRevealPending(false); refetchAfterTtsRef.current = null
      }
    } finally {
      patchConv({ sending: false })
    }
  }, [conversationId, sending, qc, addSpeechChunk, flushSpeechBuffer, ttsEnabled])

  // When the user declines a transfer, nudge the agent to continue helping directly
  const handleDeclineTransfer = useCallback(() => {
    handleChoiceSelected('Please continue helping me directly here — I prefer not to switch agents.')
  }, [handleChoiceSelected])

  const clearMutation = useMutation({
    mutationFn: () => api.delete(`/chat/${conversationId}/messages`),
    onSuccess: () => {
      setPendingCards([])
      setStreamingMsg(null)
      setConfirmClear(false)
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    },
  })

  // Mobile: show agent list OR chat (WhatsApp style)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    setMobileChatOpen(true)
  }

  return (
    <div className="flex h-full border border-border sm:rounded-lg overflow-hidden bg-card">

      {/* ── Agent list (left panel on desktop / full screen on mobile) ── */}
      <div className={`
        flex-col shrink-0 bg-card border-r border-border
        w-full sm:w-72 sm:flex
        ${mobileChatOpen ? 'hidden sm:flex' : 'flex'}
      `}>
        {/* List header */}
        <div className="px-4 py-4 border-b border-border bg-muted/20">
          <p className="text-base font-semibold">Agents</p>
          <p className="text-xs text-muted-foreground mt-0.5">{agents.length} active</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {agentsLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-muted-foreground text-sm justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : agents.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No active agents yet</p>
            </div>
          ) : (
            agents.map((agent: any) => {
              const isSelected = selectedAgentId === agent.id
              // Check if this agent has an active background stream in any of their conversations
              const agentStreaming = Object.values(convStreams).some(s => s.sending)
                && !isSelected
                && Object.entries(convStreams).some(([, s]) => s.sending)
              // More precise: check if any convStream bucket that belongs to this agent is active
              const hasBackgroundStream = !isSelected && Object.values(convStreams).some(s => s.sending)
              return (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgent(agent.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-b border-border/40 ${
                    isSelected ? 'bg-primary/8 border-l-[3px] border-l-primary' : 'hover:bg-accent/60 active:bg-accent'
                  }`}
                >
                  <div className="relative shrink-0">
                    {resolveAvatarUrl(agent.avatar) ? (
                      <img src={resolveAvatarUrl(agent.avatar)!} alt={agent.name} className="w-11 h-11 rounded-full object-cover" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-base font-bold text-primary">
                        {agent.name?.[0] ?? 'A'}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-background" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold truncate">{agent.name}</p>
                      {/* Pulse dot when this agent is processing in background */}
                      {!isSelected && convStreams[primaryQuery.data?.id ?? '']?.sending && selectedAgentId !== agent.id && (
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0" title="Processing..." />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.role}</p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180 shrink-0 sm:hidden" />
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Chat panel (right on desktop / full screen on mobile) ── */}
      {selectedAgentId ? (
        primaryQuery.isLoading ? (
          <div className={`flex-1 flex items-center justify-center bg-card ${mobileChatOpen ? 'flex' : 'hidden sm:flex'}`}>
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Opening chat with {selectedAgent?.name}...</p>
            </div>
          </div>
        ) : (
          <div className={`flex-1 flex flex-col min-w-0 bg-card ${mobileChatOpen ? 'flex' : 'hidden sm:flex'}`}>
            {/* Chat header */}
            <div className="border-b border-border bg-card/95 backdrop-blur-sm">
              <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
                {/* Back button — mobile only */}
                <button
                  onClick={() => setMobileChatOpen(false)}
                  className="sm:hidden p-1.5 -ml-1 rounded-full text-muted-foreground hover:bg-accent transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {resolveAvatarUrl(selectedAgent?.avatar) ? (
                  <img src={resolveAvatarUrl(selectedAgent?.avatar)!} alt={selectedAgent?.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {selectedAgent?.name?.[0] ?? 'A'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate leading-tight">{selectedAgent?.name}</p>
                  <p className="text-xs text-green-500 font-medium">Online</p>
                </div>

                {/* Clear button */}
                {!confirmClear ? (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="p-2 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    title="Clear conversation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => clearMutation.mutate()}
                      disabled={clearMutation.isPending}
                      className="text-xs px-2.5 py-1 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                    >
                      {clearMutation.isPending ? '...' : 'Clear'}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-accent transition-colors"
                    >
                      No
                    </button>
                  </div>
                )}

                <div className="hidden sm:flex items-center gap-1.5 text-xs text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Active
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex items-center gap-0.5 px-3 pb-0 overflow-x-auto">
                {FILTER_TABS.map(tab => {
                  const count = tabCounts[tab.id] ?? 0
                  const isActive = activeFilter === tab.id
                  // Hide tabs with zero messages (except All, Chat, and comingSoon tabs)
                  if (count === 0 && tab.id !== 'all' && tab.id !== 'chat' && !tab.comingSoon) return null
                  return (
                    <button
                      key={tab.id}
                      onClick={() => !tab.comingSoon && setActiveFilter(tab.id)}
                      title={tab.comingSoon ? 'Coming soon' : undefined}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                        tab.comingSoon
                          ? 'border-transparent text-muted-foreground/50 cursor-default'
                          : isActive
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                      }`}
                    >
                      {tab.icon}
                      {tab.label}
                      {tab.comingSoon ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/70 font-medium">Soon</span>
                      ) : tab.id !== 'all' && count > 0 ? (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          {count}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3 bg-muted/5">
              {messages.length === 0 && !streamingMsg && (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary mx-auto mb-4">
                    {activeFilter === 'email' ? '📧' : activeFilter === 'calls' ? '📞' : activeFilter === 'website' ? '🌐' : activeFilter === 'crm' ? '⚡' : (selectedAgent?.name?.[0] ?? 'A')}
                  </div>
                  {activeFilter === 'all' || activeFilter === 'chat' ? (
                    <>
                      <p className="text-sm font-medium">{selectedAgent?.name} is ready</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                        Ask anything, assign tasks, or wait — {selectedAgent?.name} will update you here when they handle things on your behalf.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">No {activeTab.label.toLowerCase()} updates yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activeFilter === 'email' && 'Email scan results will appear here.'}
                        {activeFilter === 'calls' && 'Inbound call briefings will appear here.'}
                        {activeFilter === 'whatsapp' && 'WhatsApp messages will appear here once integrated.'}
                        {activeFilter === 'website' && 'Website chat updates will appear here.'}
                        {activeFilter === 'crm' && 'CRM events (leads, jobs, proposals) will appear here.'}
                      </p>
                    </>
                  )}
                </div>
              )}

              {messages.map((msg) => {
                const isUser = msg.role === 'USER'
                const isBriefing = !isUser && !!msg.briefingType
                const briefingInfo = msg.briefingType ? BRIEFING_LABELS[msg.briefingType] : null

                if (isBriefing) {
                  // Proactive briefing — distinct style
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[90%] sm:max-w-[80%] space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          {briefingInfo && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${briefingInfo.color}`}>
                              {briefingInfo.label}
                            </span>
                          )}
                          {msg.briefingType === 'widget' ? (
                            <Globe className="w-3 h-3 text-muted-foreground" />
                          ) : (
                            <Zap className="w-3 h-3 text-muted-foreground" />
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="bg-muted/60 border border-border rounded-xl rounded-tl-none px-4 py-3 text-sm text-foreground space-y-1">
                          {renderMarkdown(msg.content)}
                        </div>
                      </div>
                    </div>
                  )
                }

                // When TTS is on and this is the streaming bubble, show waveform instead of text
                if (msg.streaming && ttsEnabled) {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="bg-muted rounded-xl px-4 py-3 rounded-bl-none flex items-center gap-2.5">
                        {/* Animated sound-wave bars */}
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className="inline-block w-1 rounded-full bg-primary/70"
                            style={{
                              height: `${12 + (i % 3) * 6}px`,
                              animation: `soundwave 0.9s ease-in-out infinite`,
                              animationDelay: `${i * 0.12}s`,
                            }}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">
                          {selectedAgent?.name ?? 'Agent'} is speaking…
                        </span>
                      </div>
                    </div>
                  )
                }

                const msgAttachments: Attachment[] = Array.isArray(msg.attachments) ? msg.attachments : []
                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[88%] sm:max-w-[72%] space-y-1.5">
                      {/* Attachment previews */}
                      {msgAttachments.length > 0 && (
                        <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
                          {msgAttachments.map((att, ai) => (
                            att.mimeType.startsWith('image/') ? (
                              <img
                                key={ai}
                                src={att.url}
                                alt={att.name}
                                className="max-w-xs rounded-xl object-cover border border-border cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(att.url, '_blank')}
                              />
                            ) : att.url && !att.url.startsWith('local://') ? (
                              <a
                                key={ai}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors ${
                                  isUser ? 'bg-primary/80 text-primary-foreground border-primary/50 hover:bg-primary/70' : 'bg-muted border-border hover:bg-accent'
                                }`}
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate max-w-[180px]">{att.name}</span>
                              </a>
                            ) : (
                              // local:// means the file was processed server-side (no public URL) — show as non-clickable badge
                              <div
                                key={ai}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
                                  isUser ? 'bg-primary/80 text-primary-foreground border-primary/50' : 'bg-muted border-border text-muted-foreground'
                                }`}
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate max-w-[180px]">{att.name}</span>
                                <span className="text-[10px] opacity-60 shrink-0">processed</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {/* Persisted action cards (documents, tasks) from previous sessions */}
                      {!isUser && msg.metadata?.actionCards?.map((card, ci) => (
                        <div key={`${msg.id}-card-${ci}`} className="flex justify-start pl-0">
                          <ChatActionCard
                            card={card}
                            onChoiceSelected={handleChoiceSelected}
                            onTransfer={(agentId) => setSelectedAgentId(agentId)}
                            onDeclineTransfer={handleDeclineTransfer}
                          />
                        </div>
                      ))}

                      {/* Message bubble — only render when there is actual content or streaming text */}
                      {(msg.content?.length > 0 || (msg.streaming && streamingMsg !== null && streamingMsg !== '')) && (
                        <div className={`rounded-xl px-4 py-2.5 text-sm ${
                          isUser
                            ? 'bg-primary text-primary-foreground rounded-br-none'
                            : 'bg-muted text-foreground rounded-bl-none'
                        }`}>
                          {msg.role === 'ASSISTANT' && !msg.streaming
                            ? <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                            : <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          }
                          {/* Cursor only shown while actively streaming with content */}
                          {msg.streaming && msg.content?.length > 0 && (
                            <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-text-bottom" />
                          )}
                          {!msg.streaming && (
                            <p className={`text-xs mt-1 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Speaking waveform — shown while ElevenLabs audio is playing (hear-then-read) */}
              {voiceRevealPending && isSpeaking && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-4 py-3 rounded-bl-none flex items-center gap-2.5">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <span
                        key={i}
                        className="inline-block w-1 rounded-full bg-primary"
                        style={{
                          height: `${8 + Math.sin(i) * 8 + 8}px`,
                          animation: 'soundwave 0.8s ease-in-out infinite',
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                    <span className="text-xs text-muted-foreground ml-1.5 font-medium">
                      {selectedAgent?.name ?? 'Agent'} is speaking…
                    </span>
                  </div>
                </div>
              )}

              {/* Optimistic attachment preview — shown immediately after upload, before refetch */}
              {uploadedAttachment && (
                <div className="flex justify-end">
                  <div className="max-w-[72%]">
                    {uploadedAttachment.mimeType.startsWith('image/') ? (
                      <img
                        src={uploadedAttachment.url}
                        alt={uploadedAttachment.name}
                        className="max-w-xs rounded-xl object-cover border border-border"
                      />
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-primary/80 text-primary-foreground border border-primary/50">
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[180px]">{uploadedAttachment.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress steps bubble — shown while agent is executing tools (file read, doc gen, CRM search) */}
              {sending && progressSteps.length > 0 && (
                <div className="flex justify-start">
                  <div className="rounded-xl rounded-bl-none px-4 py-3 space-y-1.5 max-w-xs"
                    style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                    {progressSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {step.status === 'active' && (
                          <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                        )}
                        {step.status === 'done' && (
                          <span className="w-3.5 h-3.5 shrink-0 text-emerald-500">✓</span>
                        )}
                        {step.status === 'error' && (
                          <span className="w-3.5 h-3.5 shrink-0 text-red-400">✕</span>
                        )}
                        <span className={`text-xs ${
                          step.status === 'active' ? 'text-indigo-400 font-medium' :
                          step.status === 'done'   ? 'text-muted-foreground line-through' :
                          'text-red-400'
                        }`}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Typing indicator — shown only while waiting for first token, disappears once streaming starts */}
              {sending && !checkingWith && progressSteps.length === 0 && (streamingMsg === '' || streamingMsg === null) && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-2 text-muted-foreground text-sm rounded-bl-none">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    {typingAgent && (
                      <span className="text-xs opacity-70">{typingAgent} is typing...</span>
                    )}
                  </div>
                </div>
              )}

              {/* "Checking with [Name]..." indicator during specialist consultation */}
              {checkingWith && (
                <div className="flex justify-start">
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-sm rounded-bl-none max-w-xs">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-amber-700 dark:text-amber-400 text-xs font-medium">
                      Checking with {checkingWith}...
                    </span>
                  </div>
                </div>
              )}

              {pendingCards.map((card, i) => (
                <div
                  key={`${card.type}-${card.id}-${i}`}
                  className={card.type === 'handoff'
                    ? 'flex justify-start pl-1 py-0.5'   // compact pill row for handoffs
                    : 'flex justify-start pl-1'           // full card row for everything else
                  }
                >
                  <ChatActionCard
                    card={card}
                    onChoiceSelected={handleChoiceSelected}
                    onTransfer={(agentId) => setSelectedAgentId(agentId)}
                    onDeclineTransfer={handleDeclineTransfer}
                  />
                </div>
              ))}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="border-t border-border bg-card px-3 pt-2 pb-3 sm:px-4 sm:py-3">
              {/* Interim STT transcript */}
              {interimText && (
                <div className="mb-1.5 text-xs text-muted-foreground italic animate-pulse flex items-center gap-1.5">
                  <Mic className="w-3 h-3 text-red-500" />
                  {interimText}
                </div>
              )}

              {/* File preview */}
              {pendingFile && (
                <div className="mb-2 flex items-center gap-2 bg-muted rounded-xl px-3 py-2 text-xs max-w-xs">
                  {pendingFile.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(pendingFile)} alt={pendingFile.name} className="h-8 w-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-orange-500 shrink-0" />
                  )}
                  <span className="truncate text-muted-foreground flex-1">{pendingFile.name}</span>
                  <button onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                {/* Left actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {fileUploadsEnabled && (
                    <>
                      <input ref={fileInputRef} type="file" className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.xlsx,.csv,.txt"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); e.target.value = '' }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sending}
                        title="Attach file"
                        className={`p-2 rounded-full transition-colors ${pendingFile ? 'text-blue-500 bg-blue-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'} disabled:opacity-50`}
                      >
                        <Paperclip className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {sttSupported && (
                    <button
                      onClick={() => { if (isSpeaking) stopSpeaking(); toggleListening() }}
                      title={isListening ? 'Stop' : 'Speak'}
                      className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    >
                      {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                  )}
                </div>

                {/* Text input */}
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(message, pendingFile) } }}
                  placeholder={isListening ? 'Listening…' : pendingFile ? 'Add a message…' : `Message ${selectedAgent?.name ?? 'agent'}…`}
                  disabled={sending}
                  className="flex-1 min-w-0 rounded-full border border-border bg-muted/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-colors disabled:opacity-50"
                />

                {/* Right actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={toggleTts}
                    title={ttsEnabled ? 'Mute voice' : 'Enable voice'}
                    className={`hidden sm:flex p-2 rounded-full transition-colors ${ttsEnabled ? (isSpeaking ? 'text-primary animate-pulse' : 'text-primary') : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={(!message.trim() && !pendingFile) || sending}
                    className="p-2.5 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-40 transition-all disabled:scale-95 active:scale-95"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="flex-1 hidden sm:flex items-center justify-center bg-muted/10">
          <div className="text-center space-y-3 max-w-sm px-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <MessageSquare className="w-8 h-8 text-primary/50" />
            </div>
            <p className="text-base font-semibold">Select an agent</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Tap an agent from the list to start chatting. Agents will also update you here automatically when they handle tasks on your behalf.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function CrmCustomerBanner({ customerId }: { customerId: string }) {
  const { data: customer } = useQuery({
    queryKey: ['crm-customer', customerId],
    queryFn: () => api.get(`/crm/contacts/${customerId}`).then(r => r.data),
    retry: false,
  })
  if (!customer) return null
  return <CRMRecordCard customer={customer} />
}
