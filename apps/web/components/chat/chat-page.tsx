'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Send, MessageSquare, Loader2, Zap, Globe, Mail, Phone, LayoutList, MessageCircle } from 'lucide-react'
import { CRMRecordCard } from './crm-record-card'
import { ChatActionCard, type ActionCard } from './action-cards'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

type FilterTab = 'all' | 'chat' | 'email' | 'calls' | 'whatsapp' | 'website' | 'crm'

const FILTER_TABS: { id: FilterTab; label: string; icon: React.ReactNode; match: (b?: string | null) => boolean; comingSoon?: boolean }[] = [
  { id: 'all',      label: 'All',        icon: <LayoutList className="w-3.5 h-3.5" />,    match: () => true },
  { id: 'chat',     label: 'Agent Chat', icon: <MessageSquare className="w-3.5 h-3.5" />, match: (b) => !b },
  { id: 'email',    label: 'Emails',     icon: <Mail className="w-3.5 h-3.5" />,          match: (b) => b === 'email_briefing' },
  { id: 'calls',    label: 'Calls',      icon: <Phone className="w-3.5 h-3.5" />,         match: (b) => b === 'call_briefing',             comingSoon: true },
  { id: 'whatsapp', label: 'WhatsApp',   icon: <MessageCircle className="w-3.5 h-3.5" />, match: (b) => b === 'whatsapp_briefing', comingSoon: true },
  { id: 'website',  label: 'Website',    icon: <Globe className="w-3.5 h-3.5" />,         match: (b) => b === 'widget' },
  { id: 'crm',      label: 'CRM',        icon: <Zap className="w-3.5 h-3.5" />,           match: (b) => !!b && !['email_briefing','call_briefing','whatsapp_briefing','widget'].includes(b) },
]

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  briefingType?: string | null
  createdAt: string
  streaming?: boolean
}

// ── Markdown-lite renderer ─────────────────────────────────────────
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    // Bold **text**
    const parsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic *text*
    const parsed2 = parsed.replace(/\*(.*?)\*/g, '<em>$1</em>')
    if (line.startsWith('---')) return <hr key={i} className="my-2 border-border" />
    return (
      <p key={i} className={line === '' ? 'h-2' : 'leading-relaxed'}
        dangerouslySetInnerHTML={{ __html: parsed2 }} />
    )
  })
}

// ── Briefing badge ─────────────────────────────────────────────────
const BRIEFING_LABELS: Record<string, { label: string; color: string }> = {
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
  const [sending, setSending] = useState(false)
  const [streamingMsg, setStreamingMsg] = useState<string | null>(null)
  const [pendingCards, setPendingCards] = useState<ActionCard[]>([])
  const [activeFilter, setActiveFilter] = useState<FilterTab>('chat')
  const abortRef = useRef<AbortController | null>(null)

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
  const handleSend = useCallback(async () => {
    if (!message.trim() || !conversationId || sending) return
    const text = message.trim()
    setMessage('')
    setSending(true)
    setStreamingMsg('')
    setPendingCards([])

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const authToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    const url = `${API_BASE}/chat/${conversationId}/stream?content=${encodeURIComponent(text)}`

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
            if (payload.token) { accumulated += payload.token; setStreamingMsg(accumulated) }
            if (payload.action_card) setPendingCards(prev => [...prev, payload.action_card as ActionCard])
            if (payload.done) { setStreamingMsg(null); await refetchMessages(); qc.invalidateQueries({ queryKey: ['messages', conversationId] }) }
            if (payload.error) setStreamingMsg(`Error: ${payload.error}`)
          } catch { /* partial */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStreamingMsg(null)
        try {
          await api.post(`/chat/${conversationId}/messages`, { content: text })
          await refetchMessages()
        } catch { /* ignore */ }
      }
    } finally {
      setSending(false)
    }
  }, [message, conversationId, sending, refetchMessages, qc])

  const selectedAgent = agents.find((a: any) => a.id === selectedAgentId)

  return (
    <div className="flex h-[calc(100vh-112px)] border border-border rounded-lg overflow-hidden bg-card">

      {/* ── Agent sidebar ──────────────────────────────────────────── */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-muted/20">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Your Agents</p>
          <p className="text-xs text-muted-foreground mt-0.5">Select an agent to chat</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {agentsLoading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading agents...
            </div>
          ) : agents.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No active agents yet</p>
            </div>
          ) : (
            agents.map((agent: any) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/50 ${
                  selectedAgentId === agent.id
                    ? 'bg-primary/10 border-l-2 border-l-primary'
                    : 'hover:bg-accent/50'
                }`}
              >
                {agent.avatar ? (
                  <img src={agent.avatar} alt={agent.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {agent.name?.[0] ?? 'A'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{agent.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
                </div>
                <div className="w-2 h-2 rounded-full bg-green-500 shrink-0 ml-auto" title="Active" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat window ────────────────────────────────────────────── */}
      {selectedAgentId ? (
        primaryQuery.isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Opening conversation with {selectedAgent?.name}...
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="border-b border-border">
              <div className="px-4 py-3 flex items-center gap-3">
                {selectedAgent?.avatar ? (
                  <img src={selectedAgent.avatar} alt={selectedAgent.name} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {selectedAgent?.name?.[0] ?? 'A'}
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-semibold">{selectedAgent?.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedAgent?.role}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                      <div className="max-w-[80%] space-y-1.5">
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

                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[72%] rounded-xl px-4 py-2.5 text-sm ${
                      isUser
                        ? 'bg-primary text-primary-foreground rounded-br-none'
                        : 'bg-muted text-foreground rounded-bl-none'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      {msg.streaming && (
                        <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-text-bottom" />
                      )}
                      {!msg.streaming && (
                        <p className={`text-xs mt-1 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}

              {sending && streamingMsg === '' && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-1.5 text-muted-foreground text-sm rounded-bl-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {pendingCards.map((card, i) => (
                <div key={`${card.type}-${card.id}-${i}`} className="flex justify-start pl-1">
                  <ChatActionCard card={card} />
                </div>
              ))}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={`Message ${selectedAgent?.name ?? 'agent'}...`}
                disabled={sending}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3 max-w-sm">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-base font-medium">Select an agent to get started</p>
            <p className="text-sm text-muted-foreground">
              Each agent has one persistent conversation thread. They'll also update you here automatically when they handle customers, webhook events, or tasks on your behalf.
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
