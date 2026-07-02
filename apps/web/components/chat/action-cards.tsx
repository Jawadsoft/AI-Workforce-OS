'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  CheckCircle, Clock, AlertCircle, Upload, Loader2,
  ThumbsUp, ThumbsDown, ClipboardList, ShieldCheck,
  ChevronDown, ChevronUp, ExternalLink, FileText, Download,
  ArrowRight, MessageCircleQuestion, Send, Facebook, Instagram,
  Linkedin, Twitter, Edit2,
} from 'lucide-react'

export interface ActionCard {
  type: 'task' | 'approval' | 'document' | 'handoff' | 'ask_user' | 'transfer' | 'social_post'
  id?: string
  title?: string
  description?: string
  priority?: string
  status?: string
  approvalType?: string
  docType?: string
  format?: string
  fileUrl?: string
  // handoff fields
  fromAgent?: { id: string; name: string; role: string }
  toAgent?: { id: string; name: string; role: string }
  reason?: string
  // ask_user fields
  question?: string
  choices?: string[]
  agentName?: string
  // transfer fields
  agentId?: string
  agentDisplayName?: string
  // social_post fields
  platform?: string
  content?: string
  imageUrl?: string | null
  contentType?: string
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'text-slate-600 bg-slate-100',
  MEDIUM: 'text-blue-600 bg-blue-100',
  HIGH: 'text-orange-600 bg-orange-100',
  URGENT: 'text-red-600 bg-red-100',
}

// ── Task Action Card ──────────────────────────────────────────────

function TaskCard({ card }: { card: ActionCard }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [pushed, setPushed] = useState(false)

  const completeMutation = useMutation({
    mutationFn: () => api.patch(`/tasks/${card.id}`, { status: 'COMPLETED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const pushCRMMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${card.id}/push-to-crm`, {}),
    onSuccess: () => { setPushed(true); qc.invalidateQueries({ queryKey: ['tasks'] }) },
  })

  const isDone = completeMutation.isSuccess

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden shadow-sm max-w-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-500/5 border-b border-border">
        <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <ClipboardList className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{card.title}</p>
          <p className="text-[10px] text-muted-foreground">Task created</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {card.priority && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[card.priority] ?? PRIORITY_STYLES.MEDIUM}`}>
              {card.priority}
            </span>
          )}
          <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Description */}
      {expanded && card.description && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
          {card.description}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        {isDone ? (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle className="w-3.5 h-3.5" /> Completed
          </span>
        ) : (
          <button
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
            className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-500/10 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
          >
            {completeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            Complete
          </button>
        )}

        {pushed ? (
          <span className="flex items-center gap-1 text-xs text-primary font-medium ml-auto">
            <CheckCircle className="w-3.5 h-3.5" /> Synced to CRM
          </span>
        ) : (
          <button
            onClick={() => pushCRMMutation.mutate()}
            disabled={pushCRMMutation.isPending}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors disabled:opacity-50 ml-auto"
          >
            {pushCRMMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Push to CRM
          </button>
        )}

        <a href="/tasks" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md transition-colors">
          <ExternalLink className="w-3 h-3" />
          View
        </a>
      </div>
    </div>
  )
}

// ── Approval Action Card ──────────────────────────────────────────

function ApprovalCard({ card }: { card: ActionCard }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/approvals/${card.id}`, { status: 'APPROVED' }),
    onSuccess: () => { setDecision('approved'); qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.patch(`/approvals/${card.id}`, { status: 'REJECTED' }),
    onSuccess: () => { setDecision('rejected'); qc.invalidateQueries({ queryKey: ['approvals'] }) },
  })

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden shadow-sm max-w-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-yellow-500/5 border-b border-border">
        <div className="w-6 h-6 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-yellow-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{card.title}</p>
          <p className="text-[10px] text-muted-foreground">Approval requested · {card.approvalType ?? 'general'}</p>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && card.description && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
          {card.description}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2">
        {decision === 'approved' && (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <ThumbsUp className="w-3.5 h-3.5" /> Approved
          </span>
        )}
        {decision === 'rejected' && (
          <span className="flex items-center gap-1 text-xs text-destructive font-medium">
            <ThumbsDown className="w-3.5 h-3.5" /> Rejected
          </span>
        )}
        {!decision && (
          <>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-500/10 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
            >
              {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={() => rejectMutation.mutate()}
              disabled={approveMutation.isPending || rejectMutation.isPending}
              className="flex items-center gap-1 text-xs text-destructive hover:bg-destructive/10 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
            >
              {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5" />}
              Reject
            </button>
          </>
        )}
        <a href="/approvals" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md transition-colors ml-auto">
          <ExternalLink className="w-3 h-3" />
          View
        </a>
      </div>
    </div>
  )
}

// ── Document Action Card ──────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

const DOC_TYPE_LABELS: Record<string, string> = {
  estimate: 'Estimate / Proposal',
  inspection: 'Inspection Report',
  sow: 'Statement of Work',
  invoice: 'Invoice',
  supplement: 'Supplement Request',
}

function DocumentCard({ card }: { card: ActionCard }) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  const downloadUrl = `${API_BASE}/documents/download/${card.id}`

  const handleDownload = () => {
    fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => {
        if (!r.ok) throw new Error('Download failed')
        return r.blob()
      })
      .then(blob => {
        const ext = card.format === 'PDF' ? 'pdf' : 'html'
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${(card.title ?? 'document').replace(/[^a-z0-9]/gi, '_')}.${ext}`
        link.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => alert('Download failed. Please try from the Documents page.'))
  }

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden shadow-sm max-w-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-500/5 border-b border-border">
        <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <FileText className="w-3.5 h-3.5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{card.title}</p>
          <p className="text-[10px] text-muted-foreground">
            {DOC_TYPE_LABELS[card.docType ?? ''] ?? card.docType ?? 'Document'} · {card.format ?? 'PDF'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1 text-xs text-emerald-600 hover:bg-emerald-500/10 px-2 py-1 rounded-md transition-colors font-medium"
        >
          <Download className="w-3.5 h-3.5" />
          Download {card.format ?? 'PDF'}
        </button>
        <a
          href="/documents"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md transition-colors ml-auto"
        >
          <ExternalLink className="w-3 h-3" />
          View All
        </a>
      </div>
    </div>
  )
}

// ── Agent Handoff Card — compact collapsible pill ─────────────────

function HandoffCard({ card }: { card: ActionCard }) {
  const [expanded, setExpanded] = useState(false)
  const toFirstName = card.toAgent?.name?.split('—')[0]?.trim().split(' ')[0] ?? card.toAgent?.name ?? 'specialist'
  const toRole = card.toAgent?.role ?? ''

  return (
    <button
      onClick={() => setExpanded(p => !p)}
      className="flex items-start gap-1.5 group text-left"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/8 border border-purple-200/60 dark:border-purple-800/60 hover:bg-purple-500/15 transition-colors">
        <ArrowRight className="w-3 h-3 text-purple-500 shrink-0" />
        <span className="text-[11px] text-purple-700 dark:text-purple-400 font-medium">
          Consulted {toFirstName}
        </span>
        <ChevronDown className={`w-3 h-3 text-purple-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>
      {expanded && (
        <div className="mt-1 ml-1 px-2.5 py-2 rounded-lg border border-purple-200/60 dark:border-purple-800/60 bg-purple-500/5 text-[11px] text-muted-foreground space-y-0.5 min-w-[180px]">
          <p><span className="font-medium text-foreground">{card.fromAgent?.name}</span> → <span className="font-medium text-purple-700 dark:text-purple-400">{card.toAgent?.name}</span></p>
          {toRole && <p className="text-[10px]">{toRole}</p>}
          {card.reason && <p className="italic mt-1">"{card.reason}"</p>}
        </div>
      )}
    </button>
  )
}

// ── Ask User Card ─────────────────────────────────────────────────

function AskUserCard({ card, onChoiceSelected }: { card: ActionCard; onChoiceSelected?: (choice: string) => void }) {
  const [chosen, setChosen] = useState<string | null>(null)

  const handleChoiceClick = (choice: string) => {
    if (chosen) return // already answered
    setChosen(choice)
    onChoiceSelected?.(choice)
  }

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden shadow-sm max-w-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/5 border-b border-border">
        <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <MessageCircleQuestion className="w-3.5 h-3.5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">{card.agentName ?? 'Agent'} is asking</p>
          <p className="text-[10px] text-muted-foreground">Input needed to proceed</p>
        </div>
      </div>
      <div className="px-3 py-3 space-y-3">
        <p className="text-sm text-foreground">{card.question}</p>
        {card.choices && card.choices.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.choices.map((choice) => (
              <button
                key={choice}
                onClick={() => handleChoiceClick(choice)}
                disabled={!!chosen}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors font-medium disabled:cursor-default
                  ${chosen === choice
                    ? 'border-primary bg-primary text-primary-foreground'
                    : chosen
                      ? 'border-border text-muted-foreground opacity-50'
                      : 'border-border hover:border-primary hover:bg-primary/5 text-foreground'}`}
              >
                {chosen === choice && <CheckCircle className="w-3 h-3 inline mr-1" />}
                {choice}
              </button>
            ))}
          </div>
        )}
        {chosen && (
          <p className="text-[11px] text-green-600 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Sent: <strong>{chosen}</strong>
          </p>
        )}
      </div>
    </div>
  )
}

// ── Transfer to Specialist Card ───────────────────────────────────

function TransferCard({ card, onTransfer, onDeclineTransfer }: { card: ActionCard; onTransfer?: (agentId: string) => void; onDeclineTransfer?: () => void }) {
  const [decision, setDecision] = useState<'none' | 'accepted' | 'declined'>('none')
  return (
    <div className="my-2 rounded-xl border border-purple-200 bg-purple-50 dark:bg-purple-900/10 dark:border-purple-800 overflow-hidden shadow-sm max-w-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-purple-200 dark:border-purple-800">
        <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
          <ArrowRight className="w-3.5 h-3.5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">Talk directly with {card.agentDisplayName ?? 'specialist'}?</p>
          <p className="text-[10px] text-muted-foreground">Switch to a direct conversation</p>
        </div>
      </div>
      <div className="px-3 py-3 flex items-center gap-2">
        {decision === 'none' ? (
          <>
            <button
              onClick={() => { setDecision('accepted'); onTransfer?.(card.agentId!) }}
              className="text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-colors font-medium"
            >
              Yes, switch over
            </button>
            <button
              onClick={() => { setDecision('declined'); onDeclineTransfer?.() }}
              className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent transition-colors"
            >
              No, keep chatting here
            </button>
          </>
        ) : decision === 'accepted' ? (
          <p className="text-[11px] text-green-600 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Switched over!
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Continuing here...
          </p>
        )}
      </div>
    </div>
  )
}

// ── Social Post Action Card ───────────────────────────────────────

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  facebook:  <Facebook className="w-4 h-4 text-blue-500" />,
  instagram: <Instagram className="w-4 h-4 text-pink-500" />,
  linkedin:  <Linkedin className="w-4 h-4 text-blue-400" />,
  x:         <Twitter className="w-4 h-4 text-gray-400" />,
}

function SocialPostCard({ card }: { card: ActionCard }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const publishMutation = useMutation({
    mutationFn: () => api.post(`/social/posts/${card.id}/publish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-posts'] })
    },
  })

  const content = card.content ?? ''
  const truncated = content.length > 160 && !expanded

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden text-sm w-full">
      {/* Header — platform icon + action buttons */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          {card.platform ? PLATFORM_ICONS[card.platform] : <Send className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold capitalize">{card.platform ?? 'Social'}</p>
          {card.contentType && (
            <p className="text-xs text-muted-foreground capitalize">{card.contentType}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a href="/social" title="Edit in Social Media"
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </a>
          {publishMutation.isSuccess ? (
            <span className="flex items-center gap-1 text-xs text-green-400 px-2">
              <CheckCircle className="w-3.5 h-3.5" /> Published!
            </span>
          ) : (
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {publishMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Send className="w-3.5 h-3.5" />}
              Publish
            </button>
          )}
        </div>
      </div>

      {/* Post text */}
      <div className="px-3 pb-3">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {truncated ? content.slice(0, 160) : content}
          {truncated && (
            <>
              {'... '}
              <button onClick={() => setExpanded(true)} className="text-blue-400 hover:underline text-xs">more</button>
            </>
          )}
        </p>
      </div>

      {/* Full-width image at bottom — edge to edge, locked to 16:9 */}
      {card.imageUrl && (
        <div className="w-full aspect-video overflow-hidden">
          <img src={card.imageUrl} alt="post image" className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────

export function ChatActionCard({
  card,
  onChoiceSelected,
  onTransfer,
  onDeclineTransfer,
}: {
  card: ActionCard
  onChoiceSelected?: (choice: string) => void
  onTransfer?: (agentId: string) => void
  onDeclineTransfer?: () => void
}) {
  if (card.type === 'task') return <TaskCard card={card} />
  if (card.type === 'approval') return <ApprovalCard card={card} />
  if (card.type === 'document') return <DocumentCard card={card} />
  if (card.type === 'handoff') return <HandoffCard card={card} />
  if (card.type === 'ask_user') return <AskUserCard card={card} onChoiceSelected={onChoiceSelected} />
  if (card.type === 'transfer') return <TransferCard card={card} onTransfer={onTransfer} onDeclineTransfer={onDeclineTransfer} />
  if (card.type === 'social_post') return <SocialPostCard card={card} />
  return null
}
