'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Mail, Inbox, AlertCircle, CheckCircle2, Send, X,
  Archive, Loader2, RefreshCw,
} from 'lucide-react'

type FilterTab = 'needs_review' | 'all' | 'replied' | 'drafted' | 'flagged'

type ConnectedAccount = { id: string; accountEmail: string; provider: string }

type ProcessedEmail = {
  id: string
  fromEmail: string
  fromName?: string | null
  subject?: string | null
  classification?: string | null
  confidence?: number | null
  action?: string | null
  status: string
  receivedAt: string
  extractedData?: Record<string, unknown> | null
  connectedAccount?: { accountEmail: string; provider: string }
}

const FILTERS: { id: FilterTab; label: string; query: Record<string, string> }[] = [
  { id: 'needs_review', label: 'Needs Review', query: { needsReview: 'true' } },
  { id: 'flagged', label: 'Flagged', query: { action: 'flagged' } },
  { id: 'drafted', label: 'Drafted', query: { action: 'drafted' } },
  { id: 'replied', label: 'Replied', query: { action: 'replied' } },
  { id: 'all', label: 'All', query: {} },
]

function actionBadge(action?: string | null) {
  const a = action || 'unknown'
  const styles: Record<string, string> = {
    flagged: 'bg-amber-500/10 text-amber-700',
    drafted: 'bg-blue-500/10 text-blue-700',
    replied: 'bg-green-500/10 text-green-700',
    escalated: 'bg-red-500/10 text-red-700',
    archived: 'bg-slate-500/10 text-slate-600',
    blocked: 'bg-slate-500/10 text-slate-600',
    notified: 'bg-violet-500/10 text-violet-700',
  }
  return styles[a] || 'bg-muted text-muted-foreground'
}

function providerLabel(provider: string) {
  if (provider === 'google') return 'Gmail'
  if (provider === 'microsoft') return 'Outlook'
  return 'IMAP'
}

function formatRelative(dateStr: string) {
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

export function EmailsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<FilterTab>('needs_review')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [selected, setSelected] = useState<ProcessedEmail | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)

  const filter = FILTERS.find((f) => f.id === tab)!

  // Load connected accounts for the filter dropdown
  const accountsQuery = useQuery({
    queryKey: ['connected-accounts'],
    queryFn: () => api.get('/integrations/accounts').then(r => r.data as ConnectedAccount[]),
  })
  const accounts = accountsQuery.data ?? []

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { limit: '50', ...filter.query }
    if (selectedAccountId !== 'all') p.accountId = selectedAccountId
    return p
  }, [tab, selectedAccountId, filter.query])

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['processed-emails', tab, selectedAccountId],
    queryFn: () =>
      api
        .get('/integrations/emails', { params: queryParams })
        .then((r) => r.data as { items: ProcessedEmail[]; total: number }),
    refetchInterval: 30000,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const needsReviewCountQuery = useQuery({
    queryKey: ['processed-emails', 'needs_review_count'],
    queryFn: () =>
      api
        .get('/integrations/emails', { params: { limit: 1, needsReview: 'true' } })
        .then((r) => (r.data?.total as number) ?? 0),
    refetchInterval: 30000,
  })

  const replyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post(`/integrations/emails/${id}/reply`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processed-emails'] })
      setSelected(null)
      setReplyBody('')
      setReplyError(null)
    },
    onError: (err: any) => {
      setReplyError(err?.response?.data?.message || err?.message || 'Failed to send reply')
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/integrations/emails/${id}`, { status: 'actioned', action: 'archived' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['processed-emails'] })
      if (selected) setSelected(null)
    },
  })

  const extractedSummary = useMemo(() => {
    if (!selected?.extractedData) return null
    const ex = selected.extractedData
    const bits = [
      ex.summary,
      ex.name && `Name: ${ex.name}`,
      ex.phone && `Phone: ${ex.phone}`,
      ex.address && `Address: ${ex.address}`,
      ex.service && `Service: ${ex.service}`,
    ].filter(Boolean)
    return bits.length ? bits.map(String) : null
  }, [selected])

  function openReply(email: ProcessedEmail) {
    setSelected(email)
    setReplyError(null)
    const preview = (email.extractedData as any)?.lastReplyPreview
    setReplyBody(typeof preview === 'string' ? preview : '')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" />
            Email Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review flagged inbox mail, send replies, and clear items that need attention.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Account filter — always visible once accounts are loaded */}
          {accounts.length > 0 && (
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="text-sm rounded-md border border-border bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All accounts</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.accountEmail} ({providerLabel(a.provider)})
                </option>
              ))}
            </select>
          )}
          {(needsReviewCountQuery.data ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-700 text-sm px-3 py-1.5 rounded-full">
              <AlertCircle className="w-4 h-4" />
              {needsReviewCountQuery.data} need review
            </div>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex border-b border-border overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setTab(f.id)}
            className={`px-4 py-2 text-sm border-b-2 whitespace-nowrap transition-colors ${
              tab === f.id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
            {f.id === 'needs_review' && (needsReviewCountQuery.data ?? 0) > 0 && (
              <span className="ml-1.5 text-xs bg-amber-500/15 text-amber-700 px-1.5 py-0.5 rounded-full">
                {needsReviewCountQuery.data}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-72 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {tab === 'needs_review' ? 'No emails need review right now' : 'No emails in this filter'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Run Scan Now from Settings → Integrations to pull new mail.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{total} email{total === 1 ? '' : 's'}</p>
          {items.map((email) => (
            <div key={email.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionBadge(email.action)}`}>
                      {(email.action || 'unknown').replace(/_/g, ' ')}
                    </span>
                    {email.classification && (
                      <span className="text-xs text-muted-foreground">
                        {email.classification.replace(/_/g, ' ')}
                        {email.confidence != null ? ` · ${email.confidence}%` : ''}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatRelative(email.receivedAt)}</span>
                  </div>
                  <p className="font-medium text-sm mt-2 truncate">
                    {email.subject || '(no subject)'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    From {email.fromName || email.fromEmail}
                    {email.fromName ? ` <${email.fromEmail}>` : ''}
                  </p>
                  {email.connectedAccount?.accountEmail && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      Inbox: <span className="font-medium text-foreground">{email.connectedAccount.accountEmail}</span>
                      <span className="text-muted-foreground/60">· reply will send from this address</span>
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {email.action !== 'replied' && email.action !== 'archived' && (
                    <button
                      type="button"
                      onClick={() => dismissMutation.mutate(email.id)}
                      disabled={dismissMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" /> Done
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openReply(email)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90 transition-opacity"
                  >
                    <Send className="w-3.5 h-3.5" /> Reply
                  </button>
                </div>
              </div>

              {email.extractedData && Object.keys(email.extractedData).length > 0 && (
                <details className="text-xs">
                  <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                    Extracted details
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
                    {JSON.stringify(email.extractedData, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
              <div className="min-w-0">
                <h2 className="font-semibold text-sm">Reply</h2>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  To: <span className="font-medium text-foreground">{selected.fromName || selected.fromEmail}</span>
                  {' · '}{selected.subject || '(no subject)'}
                </p>
                {selected.connectedAccount?.accountEmail && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Mail className="w-3 h-3 shrink-0" />
                    From: <span className="font-medium text-foreground">{selected.connectedAccount.accountEmail}</span>
                    <span className="text-muted-foreground/60">({providerLabel(selected.connectedAccount.provider)})</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  setReplyError(null)
                }}
                className="p-1 rounded-md text-muted-foreground hover:bg-accent"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {extractedSummary && (
                <div className="text-xs bg-muted/60 rounded-md p-3 space-y-1">
                  {extractedSummary.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              )}
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={8}
                placeholder="Write your reply…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {replyError && (
                <p className="text-sm text-red-600">{replyError}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  setReplyError(null)
                }}
                className="px-3 py-1.5 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!replyBody.trim() || replyMutation.isPending}
                onClick={() => replyMutation.mutate({ id: selected.id, body: replyBody.trim() })}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                {replyMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
