'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

function getApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001/api/v1`
  }
  return 'http://localhost:3001/api/v1'
}

interface Message {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt?: string
}

interface Config {
  agentName: string
  agentRole: string
  agentAvatar: string | null
  companyName: string
  welcomeMessage: string
  primaryColor: string
  placeholder: string
  collectName: boolean
  collectEmail: boolean
  collectPhone: boolean
}

export default function WidgetPage() {
  const params = useParams()
  const tenantId = params.tenantId as string
  const agentId = params.agentId as string

  const [config, setConfig] = useState<Config | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [visitorInfo, setVisitorInfo] = useState({ name: '', email: '', phone: '' })
  const [collectingInfo, setCollectingInfo] = useState(false)
  const [infoSubmitted, setInfoSubmitted] = useState(false)
  const [streamingText, setStreamingText] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const apiBase = getApiBase()

  // Load config
  useEffect(() => {
    if (!tenantId || !agentId) return
    fetch(`${apiBase}/public/widget/${tenantId}/${agentId}/config`)
      .then(r => r.json())
      .then(data => {
        if (data.statusCode) { setError('This widget is not available.'); return }
        setConfig(data)
        if (data.collectName || data.collectEmail || data.collectPhone) {
          setCollectingInfo(true)
        } else {
          startSession()
        }
      })
      .catch(() => setError('Could not load widget configuration.'))
  }, [tenantId, agentId])

  const startSession = useCallback(async (info?: { name?: string; email?: string; phone?: string }) => {
    const stored = sessionStorage.getItem(`aiw_session_${tenantId}_${agentId}`)
    const body: any = { sessionId: stored ?? undefined }
    if (info?.name) body.visitorName = info.name
    if (info?.email) body.visitorEmail = info.email
    if (info?.phone) body.visitorPhone = info.phone

    const res = await fetch(`${apiBase}/public/widget/${tenantId}/${agentId}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.sessionId) {
      setSessionId(data.sessionId)
      sessionStorage.setItem(`aiw_session_${tenantId}_${agentId}`, data.sessionId)
      // Load existing messages
      const msgRes = await fetch(`${apiBase}/public/widget/${tenantId}/session/${data.sessionId}/messages`)
      const msgs = await msgRes.json()
      if (Array.isArray(msgs)) setMessages(msgs)
    }
  }, [tenantId, agentId, apiBase])

  // Poll for new messages every 4 seconds (picks up operator replies injected server-side)
  useEffect(() => {
    if (!sessionId) return
    const interval = setInterval(async () => {
      if (streaming) return // don't poll while a stream is active
      try {
        const res = await fetch(`${apiBase}/public/widget/${tenantId}/session/${sessionId}/messages`)
        const msgs = await res.json()
        if (Array.isArray(msgs)) {
          setMessages(prev => {
            // Only update if there are more messages than we currently have
            if (msgs.length > prev.length) return msgs
            return prev
          })
        }
      } catch { /* ignore poll errors */ }
    }, 4000)
    return () => clearInterval(interval)
  }, [sessionId, streaming, tenantId, apiBase])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  function submitVisitorInfo(e: React.FormEvent) {
    e.preventDefault()
    setCollectingInfo(false)
    setInfoSubmitted(true)
    startSession(visitorInfo)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || streaming || !sessionId) return

    const userMsg: Message = { id: Date.now().toString(), role: 'USER', content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setStreamingText('')

    const url = `${apiBase}/public/widget/${tenantId}/session/${sessionId}/stream?content=${encodeURIComponent(userMsg.content)}`
    const es = new EventSource(url)

    let accum = ''
    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.token) {
        accum += data.token
        setStreamingText(accum)
      }
      if (data.done || data.error) {
        es.close()
        setMessages(prev => [...prev, {
          id: data.messageId ?? Date.now().toString(),
          role: 'ASSISTANT',
          content: accum || (data.error ? 'Something went wrong. Please try again.' : ''),
        }])
        setStreamingText('')
        setStreaming(false)
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    }

    es.onerror = () => {
      es.close()
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ASSISTANT', content: 'Connection lost. Please try again.' }])
      setStreamingText('')
      setStreaming(false)
    }
  }

  const primary = config?.primaryColor ?? '#6366f1'

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-6">
        <p className="text-gray-500 text-sm text-center">{error}</p>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 rounded-full border-2 border-gray-200 animate-spin" style={{ borderTopColor: primary }} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white font-sans text-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ background: primary }}>
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-base flex-shrink-0 overflow-hidden">
          {config.agentAvatar
            ? <img src={config.agentAvatar} alt="" className="w-full h-full object-cover" />
            : <span className="text-white text-base">🤖</span>}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white leading-tight truncate">{config.agentName}</p>
          <p className="text-white/70 text-xs truncate">{config.companyName}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70 text-xs">Online</span>
        </div>
      </div>

      {/* Visitor info collection */}
      {collectingInfo && !infoSubmitted ? (
        <form onSubmit={submitVisitorInfo} className="flex-1 flex flex-col justify-center px-5 gap-3">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-2 mb-1">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-2xl border-2" style={{ borderColor: primary }}>
              {config.agentAvatar
                ? <img src={config.agentAvatar} alt="" className="w-full h-full object-cover" />
                : '🤖'}
            </div>
            <p className="font-semibold text-gray-800 text-center">{config.agentName}</p>
            <p className="text-xs text-gray-500 text-center">{config.welcomeMessage}</p>
          </div>

          <div className="text-xs font-medium text-gray-500 text-center mb-1">
            Quick intro before we chat 👋
          </div>

          {config.collectName && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Your name <span className="text-red-400">*</span></label>
              <input
                value={visitorInfo.name}
                onChange={e => setVisitorInfo(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. John Smith"
                required
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 transition-all"
                style={{ ['--tw-ring-color' as any]: primary }}
              />
            </div>
          )}
          {config.collectEmail && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Email <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="email"
                value={visitorInfo.email}
                onChange={e => setVisitorInfo(f => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 transition-all"
                style={{ ['--tw-ring-color' as any]: primary }}
              />
            </div>
          )}
          {config.collectPhone && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="tel"
                value={visitorInfo.phone}
                onChange={e => setVisitorInfo(f => ({ ...f, phone: e.target.value }))}
                placeholder="+1 (555) 000-0000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 transition-all"
                style={{ ['--tw-ring-color' as any]: primary }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={config.collectName && !visitorInfo.name.trim()}
            className="w-full py-2.5 rounded-lg text-white font-medium mt-1 disabled:opacity-50 transition-opacity"
            style={{ background: primary }}
          >
            Start Chat →
          </button>
          <p className="text-center text-xs text-gray-300">We respect your privacy</p>
        </form>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {/* Welcome message bubble */}
            {messages.length === 0 && !streaming && (
              <div className="flex gap-2 items-start">
                <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center text-sm">
                  {config.agentAvatar ? <img src={config.agentAvatar} alt="" className="w-full h-full object-cover" /> : '🤖'}
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-none px-3 py-2 max-w-[80%] text-gray-700 leading-relaxed">
                  {visitorInfo.name
                    ? `Hi ${visitorInfo.name}! ${config.welcomeMessage}`
                    : config.welcomeMessage}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 items-end ${msg.role === 'USER' ? 'flex-row-reverse' : 'flex-row'}`}>
                {msg.role === 'ASSISTANT' && (
                  <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center text-sm mb-1">
                    {config.agentAvatar ? <img src={config.agentAvatar} alt="" className="w-full h-full object-cover" /> : '🤖'}
                  </div>
                )}
                <div
                  className={`px-3 py-2 rounded-2xl max-w-[80%] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'USER'
                      ? 'text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-800 rounded-bl-none'
                  }`}
                  style={msg.role === 'USER' ? { background: primary } : {}}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Streaming bubble */}
            {streaming && (
              <div className="flex gap-2 items-end">
                <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden bg-gray-100 flex items-center justify-center text-sm mb-1">
                  {config.agentAvatar ? <img src={config.agentAvatar} alt="" className="w-full h-full object-cover" /> : '🤖'}
                </div>
                <div className="bg-gray-100 text-gray-800 px-3 py-2 rounded-2xl rounded-bl-none max-w-[80%] leading-relaxed whitespace-pre-wrap">
                  {streamingText || (
                    <span className="flex gap-1 items-center py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} className="border-t px-3 py-3 flex gap-2 items-end bg-white">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={config.placeholder}
              disabled={streaming || !sessionId}
              className="flex-1 border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 resize-none disabled:opacity-50"
              style={{ ['--tw-ring-color' as any]: primary }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any) } }}
            />
            <button
              type="submit"
              disabled={streaming || !input.trim() || !sessionId}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition-opacity"
              style={{ background: primary }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>

          {/* Powered by */}
          <div className="text-center pb-2 text-gray-300 text-xs">
            Powered by AI Workforce
          </div>
        </>
      )}
    </div>
  )
}
