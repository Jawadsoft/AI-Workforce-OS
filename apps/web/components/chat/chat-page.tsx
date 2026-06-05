'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Send, Plus, MessageSquare, Phone, Mail, User } from 'lucide-react'
import { CRMRecordCard } from './crm-record-card'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
  streaming?: boolean
}

export function ChatPage() {
  const qc = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingMsg, setStreamingMsg] = useState<string | null>(null)
  const [showNewConv, setShowNewConv] = useState(false)
  const [newConvAgentId, setNewConvAgentId] = useState('')
  const [callerPhone, setCallerPhone] = useState('')
  const [callerEmail, setCallerEmail] = useState('')
  const [crmCustomer, setCrmCustomer] = useState<any>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get('/chat').then((r) => r.data?.data ?? r.data ?? []),
    refetchInterval: 5000,
  })

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  const { data: dbMessages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['messages', selectedConvId],
    queryFn: () => api.get(`/chat/${selectedConvId}/messages`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!selectedConvId,
  })

  // Combine real messages with in-progress stream
  const messages: Message[] = [
    ...dbMessages,
    ...(streamingMsg !== null ? [{ id: '__stream__', role: 'ASSISTANT' as const, content: streamingMsg, createdAt: new Date().toISOString(), streaming: true }] : []),
  ]

  const createConvMutation = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      api.post('/chat', {
        agentId,
        channel: 'INTERNAL',
        title: 'New conversation',
        callerPhone: callerPhone || undefined,
        callerEmail: callerEmail || undefined,
      }),
    onSuccess: (res) => {
      setSelectedConvId(res.data.id)
      setShowNewConv(false)
      setNewConvAgentId('')
      setCallerPhone('')
      setCallerEmail('')
      setCrmCustomer(null)
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const lookupCRMCustomer = async () => {
    if (!callerPhone && !callerEmail) return
    setLookingUp(true)
    setCrmCustomer(null)
    try {
      const q = callerPhone || callerEmail
      const r = await api.get(`/crm/contacts?q=${encodeURIComponent(q)}`)
      const results = r.data?.data ?? r.data ?? []
      if (results.length > 0) setCrmCustomer(results[0])
    } catch { /* no CRM */ }
    finally { setLookingUp(false) }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingMsg])

  const handleSend = useCallback(async () => {
    if (!message.trim() || !selectedConvId || sending) return
    const text = message.trim()
    setMessage('')
    setSending(true)
    setStreamingMsg('')

    // Cancel any existing stream
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    const url = `${API_BASE}/chat/${selectedConvId}/stream?content=${encodeURIComponent(text)}`

    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
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
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if (payload.token) {
              accumulated += payload.token
              setStreamingMsg(accumulated)
            }
            if (payload.done) {
              setStreamingMsg(null)
              await refetchMessages()
              qc.invalidateQueries({ queryKey: ['conversations'] })
            }
            if (payload.error) {
              setStreamingMsg(`Error: ${payload.error}`)
            }
          } catch { /* partial line */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStreamingMsg(null)
        // Fallback to non-streaming on fetch error
        try {
          await api.post(`/chat/${selectedConvId}/messages`, { content: text })
          await refetchMessages()
        } catch (e: any) {
          console.error('Fallback also failed:', e)
        }
      }
    } finally {
      setSending(false)
    }
  }, [message, selectedConvId, sending, refetchMessages, qc])

  const selectedConv = conversations.find((c: any) => c.id === selectedConvId)

  return (
    <div className="flex h-[calc(100vh-112px)] border border-border rounded-lg overflow-hidden bg-card">
      {/* Sidebar */}
      <div className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Conversations</span>
          <button onClick={() => setShowNewConv(true)} className="p-1 rounded hover:bg-accent transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {showNewConv && (
          <div className="p-3 border-b border-border space-y-2 bg-muted/40">
            <p className="text-xs font-medium text-muted-foreground">Select agent</p>
            <select
              value={newConvAgentId}
              onChange={(e) => setNewConvAgentId(e.target.value)}
              className="w-full text-sm rounded border border-border bg-background px-2 py-1 focus:outline-none"
            >
              <option value="">-- choose --</option>
              {agents.filter((a: any) => a.status === 'ACTIVE').map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Caller info (optional)</p>
              <div className="relative">
                <Phone className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <input value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} onBlur={lookupCRMCustomer}
                  placeholder="Phone" className="w-full text-xs rounded border border-border bg-background pl-6 pr-2 py-1 focus:outline-none" />
              </div>
              <div className="relative">
                <Mail className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <input value={callerEmail} onChange={(e) => setCallerEmail(e.target.value)} onBlur={lookupCRMCustomer}
                  placeholder="Email" className="w-full text-xs rounded border border-border bg-background pl-6 pr-2 py-1 focus:outline-none" />
              </div>
              {lookingUp && <p className="text-xs text-muted-foreground">Looking up in CRM...</p>}
              {crmCustomer && (
                <div className="flex items-center gap-1.5 p-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
                  <User className="w-3 h-3 text-blue-600" />
                  <span className="text-blue-700 font-medium truncate">{crmCustomer.name}</span>
                </div>
              )}
            </div>

            <div className="flex gap-1">
              <button onClick={() => createConvMutation.mutate({ agentId: newConvAgentId })}
                disabled={!newConvAgentId || createConvMutation.isPending}
                className="flex-1 bg-primary text-primary-foreground text-xs py-1.5 rounded hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {createConvMutation.isPending ? 'Creating...' : 'Start Chat'}
              </button>
              <button onClick={() => { setShowNewConv(false); setCrmCustomer(null) }}
                className="px-2 text-xs border border-border rounded hover:bg-accent transition-colors">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No conversations yet</p>
            </div>
          ) : (
            conversations.map((conv: any) => (
              <button key={conv.id} onClick={() => { setSelectedConvId(conv.id); setStreamingMsg(null) }}
                className={`w-full text-left px-3 py-3 border-b border-border transition-colors ${selectedConvId === conv.id ? 'bg-accent' : 'hover:bg-accent/50'}`}>
                <p className="text-sm font-medium truncate">{conv.title ?? 'Conversation'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {conv.channel === 'WEBHOOK' ? '⚡ ' : ''}{conv.agent?.name ?? 'Unknown'}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat window */}
      {selectedConvId ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-3">
            {selectedConv?.agent?.avatar ? (
              <img src={selectedConv.agent.avatar} alt={selectedConv.agent.name} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                {selectedConv?.agent?.name?.[0] ?? 'A'}
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold">{selectedConv?.agent?.name ?? 'AI Agent'}</p>
              <p className="text-xs text-muted-foreground">{selectedConv?.agent?.role ?? ''}</p>
            </div>
            {selectedConv?.channel === 'WEBHOOK' && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">⚡ Webhook</span>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selectedConv?.metadata?.crmCustomerId && (
              <CrmCustomerBanner customerId={selectedConv.metadata.crmCustomerId} />
            )}

            {messages.length === 0 && !streamingMsg && (
              <div className="text-center py-16 text-sm text-muted-foreground">Start the conversation below</div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === 'USER'
              return (
                <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[72%] rounded-xl px-4 py-2.5 text-sm ${isUser ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted text-foreground rounded-bl-none'}`}>
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
                <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-1.5 text-muted-foreground text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Message the agent..."
              disabled={sending}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button onClick={handleSend} disabled={!message.trim() || sending}
              className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Select a conversation or start a new one</p>
            <button onClick={() => setShowNewConv(true)}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm mx-auto hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> New Conversation
            </button>
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
