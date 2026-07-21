'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import {
  Ticket, Plus, RefreshCw, Clock, AlertCircle,
  User, ChevronDown, ChevronUp, MessageSquare, Globe, Briefcase,
  ArrowRight, X, LayoutList, CheckCircle2, Play, Zap, Mail,
  Route, ChevronRight, Send, FlaskConical, Terminal, SkipForward, Trash2, Square,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────

interface Agent { id: string; name: string; role: string; avatar?: string }

interface ThreadMessage {
  role: string
  content: string
  agentName: string
  createdAt: string
}

interface ActivityEntry {
  agentName: string
  agentId: string
  action: string
  note: string
  timestamp: string
}

interface ActivityTicket {
  id: string
  ticketNumber: number
  source: string
  conversationId: string | null
  title: string
  subject: string | null
  description: string | null
  type: string
  status: TicketStatus
  priority: Priority
  contactRef: string | null
  contactPhone: string | null
  contactEmail: string | null
  leadId: string | null
  createdByAgentId: string | null
  assignedAgentId: string | null
  nextAction: string | null
  followUpAt: string | null
  resolvedAt: string | null
  activityLog: ActivityEntry[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  createdBy: Agent | null
  assignedAgent: Agent | null
  thread?: ThreadMessage[]
}

interface JourneyStage {
  id: string
  shortId: string
  ticketNumber: number
  stageIndex: number | null
  stageName: string
  status: TicketStatus
  assignedAgent: Agent | null
  nextAction: string | null
  followUpAt: string | null
  followUpAttempts: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

interface LeadJourney {
  leadId: string
  contactRef: string | null
  contactEmail: string | null
  contactPhone: string | null
  currentStage: number | null
  currentStatus: TicketStatus | null
  pendingReason: string | null
  stages: JourneyStage[]
  timeline: (ActivityEntry & { ticketId: string; ticketTitle: string; stageIndex: number | null })[]
  totalStages: number
  completedStages: number
}

interface PlaybookStage {
  name: string
  ownerRole: string
  trigger: string
  completion: string
  handoffTo: string | null
  sla: string
}

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'AWAITING_AGENT' | 'SCHEDULED' | 'COMPLETED' | 'ESCALATED' | 'CANCELLED'
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type Tab = 'internal' | 'widget' | 'pipeline'

// ── Constants ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-500 text-white border-blue-600',
  IN_PROGRESS: 'bg-indigo-500 text-white border-indigo-600',
  AWAITING_CUSTOMER: 'bg-amber-400 text-black border-amber-500',
  AWAITING_AGENT: 'bg-orange-400 text-black border-orange-500',
  SCHEDULED: 'bg-purple-500 text-white border-purple-600',
  COMPLETED: 'bg-emerald-500 text-white border-emerald-600',
  ESCALATED: 'bg-red-500 text-white border-red-600',
  CANCELLED: 'bg-gray-400 text-black border-gray-500',
}

const PRIORITY_DOT: Record<Priority, string> = {
  LOW: 'bg-gray-500',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-amber-500',
  URGENT: 'bg-red-500 animate-pulse',
}

const TYPE_LABELS: Record<string, string> = {
  ESTIMATE_SENT: 'Estimate',
  JOB_BOOKED: 'Job Booked',
  FOLLOW_UP: 'Follow-up',
  COMPLAINT: 'Complaint',
  HR: 'HR',
  INVOICE: 'Invoice',
  HANDYMAN: 'Handyman',
  GENERAL: 'General',
}

const ALL_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT', 'SCHEDULED', 'ESCALATED', 'COMPLETED', 'CANCELLED']

// ── Main Page ──────────────────────────────────────────────────────

export default function TicketsPage() {
  const [tab, setTab] = useState<Tab>('internal')
  const [tickets, setTickets] = useState<ActivityTicket[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAgent, setFilterAgent] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [threadData, setThreadData] = useState<Record<string, ThreadMessage[]>>({})
  const [threadLoading, setThreadLoading] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [triggerLoading, setTriggerLoading] = useState<string | null>(null)
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [playbookStages, setPlaybookStages] = useState<PlaybookStage[]>([])
  const [journeyLeadId, setJourneyLeadId] = useState<string | null>(null)
  const [journeyData, setJourneyData] = useState<LeadJourney | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [showDevJourney, setShowDevJourney] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [createForm, setCreateForm] = useState({
    title: '', description: '', type: 'GENERAL', priority: 'MEDIUM',
    contactRef: '', contactPhone: '', contactEmail: '',
    assignedAgentId: '', nextAction: '', followUpAt: '',
  })

  const [updateForm, setUpdateForm] = useState({
    status: '', nextAction: '', note: '', assignedAgentId: '', followUpAt: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('source', tab === 'internal' ? 'INTERNAL' : tab === 'widget' ? 'WIDGET' : 'PIPELINE')
      if (filterStatus) params.set('status', filterStatus)
      if (filterAgent) params.set('assignedAgentId', filterAgent)
      const [ticketsRes, agentsRes] = await Promise.all([
        api.get(`/tickets?${params}`),
        api.get('/agents'),
      ])
      setTickets(ticketsRes.data)
      setAgents(agentsRes.data)
      if (tab !== 'pipeline') setExpandedId(null)
    } finally {
      setLoading(false)
    }
  }, [tab, filterStatus, filterAgent])

  const runOperation = async (action: string, label: string) => {
    setTriggerLoading(action)
    setTriggerMsg(null)
    try {
      const res = await api.post(`/operations/run/${action}`)
      setTriggerMsg(res.data?.message ?? `${label} triggered.`)
      setTimeout(() => { setTriggerMsg(null); load() }, 3000)
    } catch (e: any) {
      setTriggerMsg(`Failed: ${e?.response?.data?.message ?? e.message}`)
      setTimeout(() => setTriggerMsg(null), 4000)
    } finally {
      setTriggerLoading(null)
    }
  }

  // Load playbook stages once
  useEffect(() => {
    api.get('/brain/profile').then(r => {
      const stages = r.data?.settings?.brain?.operationalPlaybook?.pipelineStages ?? []
      setPlaybookStages(stages)
    }).catch(() => {})
  }, [])

  // Auto-refresh every 30s when on pipeline tab
  useEffect(() => {
    if (tab === 'pipeline') {
      autoRefreshRef.current = setInterval(() => load(), 30_000)
    } else {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [tab, load])

  useEffect(() => { load() }, [load])

  async function expandTicket(ticket: ActivityTicket) {
    if (expandedId === ticket.id) { setExpandedId(null); return }
    setExpandedId(ticket.id)
    if (!threadData[ticket.id] && ticket.conversationId) {
      setThreadLoading(ticket.id)
      try {
        const res = await api.get(`/tickets/${ticket.id}/thread`)
        setThreadData(prev => ({ ...prev, [ticket.id]: res.data.thread ?? [] }))
      } finally {
        setThreadLoading(null)
      }
    }
  }

  async function createTicket() {
    setSaving(true)
    try {
      const payload: any = {
        title: createForm.title,
        type: createForm.type,
        priority: createForm.priority,
      }
      if (createForm.description) payload.description = createForm.description
      if (createForm.contactRef) payload.contactRef = createForm.contactRef
      if (createForm.contactPhone) payload.contactPhone = createForm.contactPhone
      if (createForm.contactEmail) payload.contactEmail = createForm.contactEmail
      if (createForm.assignedAgentId) payload.assignedAgentId = createForm.assignedAgentId
      if (createForm.nextAction) payload.nextAction = createForm.nextAction
      if (createForm.followUpAt) payload.followUpAt = new Date(createForm.followUpAt).toISOString()
      await api.post('/tickets', payload)
      setShowCreate(false)
      setCreateForm({ title: '', description: '', type: 'GENERAL', priority: 'MEDIUM', contactRef: '', contactPhone: '', contactEmail: '', assignedAgentId: '', nextAction: '', followUpAt: '' })
      load()
    } finally {
      setSaving(false)
    }
  }

  async function updateTicket(id: string) {
    setSaving(true)
    try {
      const payload: any = {}
      if (updateForm.status) payload.status = updateForm.status
      if (updateForm.nextAction) payload.nextAction = updateForm.nextAction
      if (updateForm.note) payload.note = updateForm.note
      if (updateForm.assignedAgentId) payload.assignedAgentId = updateForm.assignedAgentId
      if (updateForm.followUpAt) payload.followUpAt = new Date(updateForm.followUpAt).toISOString()
      await api.patch(`/tickets/${id}`, payload)
      setEditingId(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteTicket(id: string) {
    if (!confirm('Delete this ticket?')) return
    await api.delete(`/tickets/${id}`)
    load()
  }

  async function resetAllTickets() {
    setResetting(true)
    try {
      await api.delete('/tickets/reset/all')
      setShowResetConfirm(false)
      load()
    } finally {
      setResetting(false)
    }
  }

  async function openJourney(leadId: string) {
    setJourneyLeadId(leadId)
    setJourneyData(null)
    setJourneyLoading(true)
    try {
      const res = await api.get(`/tickets/lead/${leadId}/journey`)
      setJourneyData(res.data)
    } catch {
      setJourneyData(null)
    } finally {
      setJourneyLoading(false)
    }
  }

  function closeJourney() {
    setJourneyLeadId(null)
    setJourneyData(null)
  }

  const internalCount = tickets.filter(t => t.source === 'INTERNAL' && !['COMPLETED', 'CANCELLED'].includes(t.status)).length
  const widgetCount = tickets.filter(t => t.source === 'WIDGET' && !['COMPLETED', 'CANCELLED'].includes(t.status)).length
  const activeTickets = tickets.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status))
  const closedTickets = tickets.filter(t => ['COMPLETED', 'CANCELLED'].includes(t.status))
  const pipelineActiveCount = tickets.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status)).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ticket className="w-6 h-6 text-indigo-400" />
            Tickets
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track jobs, customer enquiries, and agent pipeline activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'pipeline' && (
            <div className="flex items-center gap-2 flex-wrap">
              {triggerMsg && (
                <span className="text-xs px-3 py-1.5 rounded-lg bg-green-500/10 text-green-600 border border-green-500/20 max-w-xs truncate">
                  {triggerMsg}
                </span>
              )}
              {[
                { action: 'crm-scan',         label: 'CRM Scan',       icon: <RefreshCw className="w-3 h-3" /> },
                { action: 'process-tickets',  label: 'Wake Agents',    icon: <Zap className="w-3 h-3" /> },
                { action: 'email-scan',       label: 'Scan Emails',    icon: <Mail className="w-3 h-3" /> },
                { action: 'follow-up-check',  label: 'Follow-ups',     icon: <Send className="w-3 h-3" /> },
                { action: 'flip-scheduled',   label: 'Flip Scheduled', icon: <Play className="w-3 h-3" /> },
                { action: 'escalation-check', label: 'Escalate Check', icon: <AlertCircle className="w-3 h-3" /> },
              ].map(({ action, label, icon }) => (
                <button
                  key={action}
                  onClick={() => runOperation(action, label)}
                  disabled={triggerLoading !== null}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {triggerLoading === action ? <RefreshCw className="w-3 h-3 animate-spin" /> : icon}
                  {label}
                </button>
              ))}
              <button
                onClick={() => setShowDevJourney(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-800/40 text-amber-400 hover:bg-amber-900/20 transition-colors"
                title="Dev: simulate a full 8-stage test journey"
              >
                <FlaskConical className="w-3 h-3" />
                Test Journey
              </button>
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 opacity-60">
                <RefreshCw className="w-3 h-3" /> 30s
              </span>
            </div>
          )}
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
            title="Dev only — delete all tickets"
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset All
          </button>
          <button onClick={load} className="w-9 h-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          {tab === 'internal' && (
            <button
              onClick={() => setShowCreate(v => !v)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Ticket
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('pipeline')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'pipeline'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <LayoutList className="w-4 h-4" />
          Pipeline Monitor
          {pipelineActiveCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {pipelineActiveCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('internal')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'internal'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          Internal Jobs
          {internalCount > 0 && (
            <span className="bg-indigo-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {internalCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('widget')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'widget'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe className="w-4 h-4" />
          Customer Enquiries
          {widgetCount > 0 && (
            <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {widgetCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab description */}
      <p className="text-xs text-muted-foreground -mt-3">
        {tab === 'pipeline'
          ? 'Live view of all jobs grouped by your operational playbook stages — updates every 30 seconds'
          : tab === 'internal'
          ? 'Jobs and tasks created by your AI agents during internal staff conversations'
          : 'Customer enquiries received via the website chat widget'}
      </p>

      {/* Stats bar — hidden on pipeline tab */}
      {tab !== 'pipeline' && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Open', count: tickets.filter(t => t.status === 'OPEN').length, color: 'text-blue-400' },
            { label: 'In Progress', count: tickets.filter(t => t.status === 'IN_PROGRESS').length, color: 'text-indigo-400' },
            { label: 'Awaiting', count: tickets.filter(t => ['AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(t.status)).length, color: 'text-amber-400' },
            { label: 'Scheduled', count: tickets.filter(t => t.status === 'SCHEDULED').length, color: 'text-purple-400' },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters — hidden on pipeline tab */}
      {tab !== 'pipeline' && (
        <div className="flex gap-3">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {/* Create form (internal only) */}
      {showCreate && tab === 'internal' && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold">Create Internal Ticket</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Title *</label>
              <input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="e.g. Quote for John Smith — 2-bed clean" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Type</label>
              <select value={createForm.type} onChange={e => setCreateForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Priority</label>
              <select value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring">
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Customer Name</label>
              <input value={createForm.contactRef} onChange={e => setCreateForm(f => ({ ...f, contactRef: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="John Smith" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Customer Phone</label>
              <input value={createForm.contactPhone} onChange={e => setCreateForm(f => ({ ...f, contactPhone: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="07700900123" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Assign to Agent</label>
              <select value={createForm.assignedAgentId} onChange={e => setCreateForm(f => ({ ...f, assignedAgentId: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring">
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Follow-up Date</label>
              <input type="datetime-local" value={createForm.followUpAt} onChange={e => setCreateForm(f => ({ ...f, followUpAt: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Next Action</label>
              <input value={createForm.nextAction} onChange={e => setCreateForm(f => ({ ...f, nextAction: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="Follow up if no response by Friday" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Description</label>
              <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder="Full context of what happened..." />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={createTicket} disabled={saving || !createForm.title}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? 'Creating...' : 'Create Ticket'}
            </button>
            <button onClick={() => setShowCreate(false)} className="bg-muted text-muted-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'pipeline' ? (
        <PipelineMonitor
          tickets={tickets}
          agents={agents}
          stages={playbookStages}
          expandedId={expandedId}
          threadData={threadData}
          threadLoading={threadLoading}
          onExpand={expandTicket}
          onJourney={openJourney}
        />
      ) : (
        <div className="space-y-6">
          {activeTickets.length > 0 && (
            <TicketGroup
              title="Active"
              tickets={activeTickets}
              agents={agents}
              expandedId={expandedId}
              editingId={editingId}
              updateForm={updateForm}
              saving={saving}
              threadData={threadData}
              threadLoading={threadLoading}
              onExpand={expandTicket}
              onEditStart={(t) => {
                setEditingId(t.id)
                setUpdateForm({ status: t.status, nextAction: t.nextAction ?? '', note: '', assignedAgentId: t.assignedAgentId ?? '', followUpAt: '' })
              }}
              onEditCancel={() => setEditingId(null)}
              onEditSave={updateTicket}
              onDelete={deleteTicket}
              onUpdateFormChange={setUpdateForm}
            />
          )}

          {closedTickets.length > 0 && (
            <TicketGroup
              title="Closed"
              tickets={closedTickets}
              agents={agents}
              expandedId={expandedId}
              editingId={editingId}
              updateForm={updateForm}
              saving={saving}
              threadData={threadData}
              threadLoading={threadLoading}
              onExpand={expandTicket}
              onEditStart={(t) => {
                setEditingId(t.id)
                setUpdateForm({ status: t.status, nextAction: t.nextAction ?? '', note: '', assignedAgentId: t.assignedAgentId ?? '', followUpAt: '' })
              }}
              onEditCancel={() => setEditingId(null)}
              onEditSave={updateTicket}
              onDelete={deleteTicket}
              onUpdateFormChange={setUpdateForm}
              muted
            />
          )}

          {tickets.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              {tab === 'internal' ? (
                <>
                  <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No internal jobs yet</p>
                  <p className="text-sm mt-1">Your AI agents will create tickets here during staff conversations.</p>
                </>
              ) : (
                <>
                  <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No customer enquiries yet</p>
                  <p className="text-sm mt-1">Tickets will appear here when customers chat via the website widget.</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {/* Lead Journey Drawer */}
      {journeyLeadId && (
        <LeadJourneyDrawer
          leadId={journeyLeadId}
          journey={journeyData}
          loading={journeyLoading}
          onClose={closeJourney}
          onRefresh={() => openJourney(journeyLeadId)}
        />
      )}

      {/* Dev Test Journey Modal */}
      {showDevJourney && (
        <DevJourneyModal onClose={() => { setShowDevJourney(false); load() }} />
      )}

      {/* Reset All Confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card rounded-xl border border-border p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-semibold">Reset All Tickets</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Permanently deletes every ticket in your workspace.</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2">
              <strong>{tickets.length}</strong> ticket{tickets.length !== 1 ? 's' : ''} will be deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={resetAllTickets}
                disabled={resetting}
                className="px-4 py-2 bg-destructive text-destructive-foreground text-sm rounded-lg hover:bg-destructive/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {resetting
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
                  : <><Trash2 className="w-3.5 h-3.5" /> Delete All</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pipeline Monitor ───────────────────────────────────────────────

function PipelineMonitor({ tickets, agents, stages, expandedId, threadData, threadLoading, onExpand, onJourney }: {
  tickets: ActivityTicket[]
  agents: Agent[]
  stages: PlaybookStage[]
  expandedId: string | null
  threadData: Record<string, ThreadMessage[]>
  threadLoading: string | null
  onExpand: (t: ActivityTicket) => void
  onJourney: (leadId: string) => void
}) {
  const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set())

  function toggleLead(key: string) {
    setExpandedLeads(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Exclude dev test-journey tickets from the live pipeline view
  const allTickets = tickets.filter(t => t.status !== 'CANCELLED' && !(t.metadata as any)?.testJourney)
  const activeTickets = allTickets.filter(t => t.status !== 'COMPLETED')
  const completedToday = allTickets.filter(t => {
    if (t.status !== 'COMPLETED') return false
    return new Date(t.updatedAt).toDateString() === new Date().toDateString()
  })

  // ── Group all tickets by lead ──────────────────────────────────────
  // A "lead group" is either a leadId (CRM lead) or the ticket's own id (no leadId).
  type LeadGroup = {
    key: string          // leadId or ticket.id
    leadId: string | null
    contactRef: string | null
    tickets: ActivityTicket[]  // sorted by pipelineStageIndex asc then createdAt
    currentTicket: ActivityTicket  // the active (non-complete) stage ticket, or last ticket
    totalStages: number
    completedStages: number
  }

  const leadMap = new Map<string, ActivityTicket[]>()
  for (const t of allTickets) {
    const key = t.leadId ?? t.id
    if (!leadMap.has(key)) leadMap.set(key, [])
    leadMap.get(key)!.push(t)
  }

  const leadGroups: LeadGroup[] = []
  for (const [key, tix] of leadMap.entries()) {
    const sorted = [...tix].sort((a, b) => {
      const ai = (a.metadata as any)?.pipelineStageIndex ?? 999
      const bi = (b.metadata as any)?.pipelineStageIndex ?? 999
      if (ai !== bi) return ai - bi
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
    const current = sorted.find(t => !['COMPLETED', 'CANCELLED'].includes(t.status)) ?? sorted[sorted.length - 1]
    leadGroups.push({
      key,
      leadId: tix[0].leadId ?? null,
      contactRef: tix[0].contactRef ?? null,
      tickets: sorted,
      currentTicket: current,
      totalStages: sorted.length,
      completedStages: sorted.filter(t => t.status === 'COMPLETED').length,
    })
  }

  // Sort: escalated first, then by updatedAt desc
  leadGroups.sort((a, b) => {
    const aEsc = a.currentTicket.status === 'ESCALATED' ? 0 : 1
    const bEsc = b.currentTicket.status === 'ESCALATED' ? 0 : 1
    if (aEsc !== bEsc) return aEsc - bEsc
    return new Date(b.currentTicket.updatedAt).getTime() - new Date(a.currentTicket.updatedAt).getTime()
  })

  const activeLeadGroups = leadGroups.filter(g => !['COMPLETED', 'CANCELLED'].includes(g.currentTicket.status))
  const completedLeadGroups = leadGroups.filter(g => g.currentTicket.status === 'COMPLETED' && completedToday.some(t => t.id === g.currentTicket.id))

  const escalatedCount = activeLeadGroups.filter(g => g.currentTicket.status === 'ESCALATED').length
  const awaitingCount = activeLeadGroups.filter(g => ['AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(g.currentTicket.status)).length

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Leads', value: activeLeadGroups.length, color: 'text-foreground' },
          { label: 'Escalated', value: escalatedCount, color: escalatedCount > 0 ? 'text-red-400' : 'text-muted-foreground' },
          { label: 'Awaiting Reply', value: awaitingCount, color: awaitingCount > 0 ? 'text-amber-400' : 'text-muted-foreground' },
          { label: 'Completed Today', value: completedToday.length, color: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {leadGroups.length === 0 && (
        <div className="border border-border rounded-xl p-8 text-center text-muted-foreground">
          <LayoutList className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No pipeline leads yet</p>
          <p className="text-sm mt-1">Run <strong>CRM Scan</strong> above to import leads, or create a ticket manually.</p>
        </div>
      )}

      {/* Active leads */}
      {activeLeadGroups.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Leads</span>
            <span className="text-xs font-bold text-foreground">{activeLeadGroups.length}</span>
          </div>
          <div className="divide-y divide-border">
            {activeLeadGroups.map(group => (
              <LeadRow
                key={group.key}
                group={group}
                stages={stages}
                isExpanded={expandedLeads.has(group.key)}
                expandedTicketId={expandedId}
                threadData={threadData}
                threadLoading={threadLoading}
                onToggle={() => toggleLead(group.key)}
                onExpand={onExpand}
                onJourney={group.leadId ? () => onJourney(group.leadId!) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed today */}
      {completedLeadGroups.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden opacity-70">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Completed Today</span>
            <span className="text-xs font-bold text-emerald-400 ml-auto">{completedLeadGroups.length}</span>
          </div>
          <div className="divide-y divide-border">
            {completedLeadGroups.map(group => (
              <LeadRow
                key={group.key}
                group={group}
                stages={stages}
                isExpanded={expandedLeads.has(group.key)}
                expandedTicketId={expandedId}
                threadData={threadData}
                threadLoading={threadLoading}
                onToggle={() => toggleLead(group.key)}
                onExpand={onExpand}
                onJourney={group.leadId ? () => onJourney(group.leadId!) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Lead Row — one row per customer, expandable stage tree ─────────

function LeadRow({ group, stages, isExpanded, expandedTicketId, threadData, threadLoading, onToggle, onExpand, onJourney }: {
  group: {
    key: string
    leadId: string | null
    contactRef: string | null
    tickets: ActivityTicket[]
    currentTicket: ActivityTicket
    totalStages: number
    completedStages: number
  }
  stages: PlaybookStage[]
  isExpanded: boolean
  expandedTicketId: string | null
  threadData: Record<string, ThreadMessage[]>
  threadLoading: string | null
  onToggle: () => void
  onExpand: (t: ActivityTicket) => void
  onJourney?: () => void
}) {
  const { currentTicket: cur, tickets, completedStages, totalStages } = group

  const isOverdue = cur.followUpAt && new Date(cur.followUpAt) < new Date() && !['COMPLETED', 'CANCELLED'].includes(cur.status)
  const progressPct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0
  const initials = (group.contactRef ?? 'UN').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className={isOverdue ? 'border-l-2 border-l-amber-500' : ''}>
      {/* Lead summary row — click to expand */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/20 transition-colors select-none"
        onClick={onToggle}
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-indigo-900/40 border border-indigo-800/40 flex items-center justify-center text-[11px] font-bold text-indigo-300 shrink-0">
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          {/* Row 1: name + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{group.contactRef ?? 'Unknown Lead'}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_COLORS[cur.status as TicketStatus]}`}>
              {cur.status.replace(/_/g, ' ')}
            </span>
            {cur.status === 'ESCALATED' && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
            {cur.contactEmail && (
              <span className="text-[11px] text-muted-foreground hidden sm:inline truncate max-w-[160px]">{cur.contactEmail}</span>
            )}
          </div>

          {/* Row 2: stage progress dots + current stage name */}
          <div className="flex items-center gap-2 mt-1">
            {/* Dots */}
            <div className="flex items-center gap-0.5">
              {tickets.map((t, i) => {
                const isComplete = t.status === 'COMPLETED'
                const isActive = !['COMPLETED', 'CANCELLED'].includes(t.status)
                return (
                  <div
                    key={t.id}
                    title={`Stage ${i + 1}: ${(t.metadata as any)?.pipelineStageName ?? t.title}`}
                    className={`w-2 h-2 rounded-full ${
                      isComplete ? 'bg-emerald-500' :
                      isActive ? 'bg-indigo-500' :
                      'bg-gray-700'
                    }`}
                  />
                )
              })}
            </div>
            <span className="text-[11px] text-muted-foreground">
              Stage {(completedStages) + (tickets.some(t => !['COMPLETED','CANCELLED'].includes(t.status)) ? 1 : 0)}/{totalStages}
              {cur.nextAction && (
                <span className="hidden sm:inline"> · <span className="text-indigo-400 truncate">{cur.nextAction.slice(0, 60)}{cur.nextAction.length > 60 ? '…' : ''}</span></span>
              )}
            </span>
          </div>

          {/* Row 3: followUpAt or last activity */}
          {isOverdue && cur.followUpAt && (
            <p className="text-[11px] text-amber-400 flex items-center gap-1 mt-0.5">
              <Clock className="w-2.5 h-2.5" />
              Follow-up overdue: {new Date(cur.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>

        {/* Right side: journey button + chevron */}
        <div className="shrink-0 flex items-center gap-1.5">
          {onJourney && (
            <button
              onClick={e => { e.stopPropagation(); onJourney() }}
              className="hidden sm:flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-indigo-800/40 text-indigo-400 hover:bg-indigo-900/30 transition-colors"
              title="Full lead journey"
            >
              <Route className="w-2.5 h-2.5" />
              Journey
            </button>
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded: stage tree */}
      {isExpanded && (
        <div className="border-t border-border bg-muted/5">
          {tickets.map((ticket, stageIdx) => {
            const isComplete = ticket.status === 'COMPLETED'
            const isCancelled = ticket.status === 'CANCELLED'
            const isCurrent = !isComplete && !isCancelled
            const isLast = stageIdx === tickets.length - 1
            const stageNum = (ticket.metadata as any)?.pipelineStageIndex ?? stageIdx
            const stageName = (ticket.metadata as any)?.pipelineStageName ?? stages[stageNum]?.name ?? ticket.title

            return (
              <div key={ticket.id} className="flex gap-0 pl-4">
                {/* Tree spine */}
                <div className="flex flex-col items-center w-6 shrink-0 pt-3">
                  <div className={`w-3 h-3 rounded-full border-2 shrink-0 z-10 ${
                    isComplete ? 'bg-emerald-500 border-emerald-400' :
                    isCurrent ? 'bg-indigo-500 border-indigo-400' :
                    'bg-gray-700 border-gray-600'
                  }`} />
                  {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                </div>

                {/* Stage card */}
                <div className={`flex-1 py-3 pr-4 pl-3 ${!isLast ? 'border-b border-border/50' : ''}`}>
                  <div
                    className={`rounded-xl border p-3 cursor-pointer transition-colors hover:bg-accent/10 ${
                      isCurrent
                        ? 'border-indigo-800/40 bg-indigo-950/20'
                        : isComplete
                        ? 'border-emerald-900/30 bg-emerald-950/10'
                        : 'border-border bg-muted/10'
                    }`}
                    onClick={() => onExpand(ticket)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Stage label + status */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold text-muted-foreground/60 shrink-0">
                            S{stageNum + 1}
                          </span>
                          <span className="text-xs font-semibold truncate">{stageName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_COLORS[ticket.status as TicketStatus]}`}>
                            {ticket.status.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {/* Agent + ticket number */}
                        <div className="flex items-center gap-2 mt-0.5">
                          {ticket.assignedAgent && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <User className="w-2.5 h-2.5" />
                              {ticket.assignedAgent.name}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground/50 font-mono">
                            #{String(ticket.ticketNumber ?? 0).padStart(4, '0')}
                          </span>
                          {ticket.followUpAt && (
                            <span className={`text-[10px] flex items-center gap-0.5 ${
                              new Date(ticket.followUpAt) < new Date() && isCurrent ? 'text-amber-400' : 'text-muted-foreground/60'
                            }`}>
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(ticket.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>

                        {/* Next action */}
                        {ticket.nextAction && isCurrent && (
                          <p className="text-[11px] text-indigo-400 mt-1 flex items-start gap-1">
                            <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{ticket.nextAction}</span>
                          </p>
                        )}

                        {/* Last activity note */}
                        {ticket.activityLog?.length > 0 && !isCurrent && (
                          <p className="text-[10px] text-muted-foreground/50 mt-1 truncate">
                            {ticket.activityLog[ticket.activityLog.length - 1]?.note ?? ''}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {ticket.status === 'ESCALATED' && <AlertCircle className="w-4 h-4 text-red-400" />}
                        {expandedTicketId === ticket.id
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        }
                      </div>
                    </div>

                    {/* Inline expanded detail (activity log) */}
                    {expandedTicketId === ticket.id && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                        {ticket.description && (
                          <p className="text-[11px] text-muted-foreground mb-2">{ticket.description}</p>
                        )}
                        {ticket.activityLog?.length > 0 && (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {[...ticket.activityLog].reverse().map((entry, i) => (
                              <div key={i} className="flex gap-2 text-[11px]">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                                <div>
                                  <span className="font-medium text-foreground/80">{entry.agentName}</span>
                                  <span className="text-muted-foreground/60 mx-1">·</span>
                                  <span className="font-mono text-muted-foreground/60">{entry.action}</span>
                                  <p className="text-muted-foreground mt-0.5">{entry.note}</p>
                                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                                    {new Date(entry.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {threadData[ticket.id]?.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/30">
                            <p className="text-[10px] text-muted-foreground/50 mb-1.5">Conversation thread</p>
                            {threadData[ticket.id].slice(-3).map((msg, i) => (
                              <div key={i} className={`text-[11px] px-2 py-1.5 rounded-lg mb-1 ${
                                msg.role === 'user' ? 'bg-slate-800/50 text-foreground' : 'bg-indigo-900/20 text-indigo-200'
                              }`}>
                                <span className="font-medium mr-1">{msg.agentName}:</span>
                                {msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Ticket Group ───────────────────────────────────────────────────

function TicketGroup({ title, tickets, agents, expandedId, editingId, updateForm, saving, threadData, threadLoading, onExpand, onEditStart, onEditCancel, onEditSave, onDelete, onUpdateFormChange, muted = false }: {
  title: string
  tickets: ActivityTicket[]
  agents: Agent[]
  expandedId: string | null
  editingId: string | null
  updateForm: any
  saving: boolean
  threadData: Record<string, ThreadMessage[]>
  threadLoading: string | null
  onExpand: (t: ActivityTicket) => void
  onEditStart: (t: ActivityTicket) => void
  onEditCancel: () => void
  onEditSave: (id: string) => void
  onDelete: (id: string) => void
  onUpdateFormChange: (f: any) => void
  muted?: boolean
}) {
  return (
    <div>
      <h2 className={`text-sm font-semibold mb-3 ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
        {title} <span className="text-muted-foreground font-normal">({tickets.length})</span>
      </h2>
      <div className="space-y-2">
        {tickets.map(ticket => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            agents={agents}
            isExpanded={expandedId === ticket.id}
            isEditing={editingId === ticket.id}
            updateForm={updateForm}
            saving={saving}
            thread={threadData[ticket.id]}
            threadLoading={threadLoading === ticket.id}
            onExpand={() => onExpand(ticket)}
            onEditStart={() => onEditStart(ticket)}
            onEditCancel={onEditCancel}
            onEditSave={() => onEditSave(ticket.id)}
            onDelete={() => onDelete(ticket.id)}
            onUpdateFormChange={onUpdateFormChange}
          />
        ))}
      </div>
    </div>
  )
}

// ── Ticket Card ────────────────────────────────────────────────────

function TicketCard({ ticket, agents, isExpanded, isEditing, updateForm, saving, thread, threadLoading, onExpand, onEditStart, onEditCancel, onEditSave, onDelete, onUpdateFormChange }: {
  ticket: ActivityTicket
  agents: Agent[]
  isExpanded: boolean
  isEditing: boolean
  updateForm: any
  saving: boolean
  thread?: ThreadMessage[]
  threadLoading: boolean
  onExpand: () => void
  onEditStart: () => void
  onEditCancel: () => void
  onEditSave: () => void
  onDelete: () => void
  onUpdateFormChange: (f: any) => void
}) {
  const isOverdue = ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['COMPLETED', 'CANCELLED'].includes(ticket.status)
  const ticketId = `#${String(ticket.ticketNumber ?? 0).padStart(4, '0')}`

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-all ${isOverdue ? 'border-amber-800/60' : 'border-border'}`}>
      {/* Card header */}
      <div
        className="flex items-start gap-4 p-4 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onExpand}
      >
        <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${PRIORITY_DOT[ticket.priority as Priority]}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold text-muted-foreground">{ticketId}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[ticket.status as TicketStatus]}`}>
              {ticket.status.replace(/_/g, ' ')}
            </span>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {TYPE_LABELS[ticket.type] ?? ticket.type}
            </span>
            {isOverdue && (
              <span className="text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Overdue
              </span>
            )}
            {ticket.conversationId && (
              <span className="text-xs bg-indigo-900/20 text-indigo-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Thread
              </span>
            )}
          </div>
          <p className="font-medium text-sm mt-1">{ticket.subject ?? ticket.title}</p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {ticket.contactRef && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" /> {ticket.contactRef}
                {ticket.contactPhone && <span className="ml-1 opacity-60">{ticket.contactPhone}</span>}
              </span>
            )}
            {ticket.createdBy && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Created by {ticket.createdBy.name}
              </span>
            )}
            {ticket.assignedAgent && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowRight className="w-3 h-3" /> {ticket.assignedAgent.name}
              </span>
            )}
            {ticket.followUpAt && (
              <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-amber-400' : 'text-muted-foreground'}`}>
                <Clock className="w-3 h-3" />
                {new Date(ticket.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(ticket.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          {ticket.nextAction && (
            <p className="text-xs text-indigo-400 mt-1 flex items-center gap-1">
              <ArrowRight className="w-3 h-3 shrink-0" />
              <span className="truncate">{ticket.nextAction}</span>
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">

          {/* ── Assignment banner ── */}
          <div className="px-4 py-3 bg-muted/20 border-b border-border flex flex-wrap items-start gap-4">
            {/* Assigned to */}
            <div className="flex-1 min-w-[180px]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Assigned To</p>
              {ticket.assignedAgent ? (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-indigo-900/50 flex items-center justify-center text-[10px] font-bold text-indigo-300 shrink-0">
                    {ticket.assignedAgent.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">{ticket.assignedAgent.name}</p>
                    <p className="text-[10px] text-muted-foreground">{ticket.assignedAgent.role}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Unassigned</p>
              )}
            </div>

            {/* Next action */}
            {ticket.nextAction && (
              <div className="flex-[2] min-w-[200px]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Next Action Required</p>
                <p className="text-sm text-amber-400 font-medium flex items-start gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {ticket.nextAction}
                </p>
              </div>
            )}

            {/* Follow-up */}
            {ticket.followUpAt && (
              <div className="shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Follow Up By</p>
                <p className={`text-sm font-medium flex items-center gap-1 ${isOverdue ? 'text-red-400' : 'text-foreground'}`}>
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(ticket.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
          </div>

          {/* Conversation thread */}
          {ticket.conversationId && (
            <div className="px-4 pt-4 pb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Conversation Thread
              </p>
              {threadLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <div className="w-4 h-4 border border-primary border-t-transparent rounded-full animate-spin" />
                  Loading conversation...
                </div>
              ) : thread && thread.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {thread.map((msg, i) => (
                    <ThreadBubble key={i} msg={msg} source={ticket.source} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No messages in this conversation yet.</p>
              )}
            </div>
          )}

          {/* Description */}
          {ticket.description && !ticket.conversationId && (
            <div className="px-4 pt-4">
              <p className="text-sm text-muted-foreground">{ticket.description}</p>
            </div>
          )}

          {/* Activity log */}
          {ticket.activityLog?.length > 0 && (
            <div className="px-4 pt-4 pb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Activity Log</p>
              <div className="space-y-1.5">
                {ticket.activityLog.map((entry, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-medium">{entry.agentName}</span>
                      <span className="text-muted-foreground"> · {new Date(entry.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <p className="text-muted-foreground mt-0.5">{entry.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edit form */}
          <div className="px-4 pb-4 pt-3">
            {isEditing ? (
              <div className="space-y-3 bg-muted/30 rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Update Ticket</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Status</label>
                    <select value={updateForm.status} onChange={e => onUpdateFormChange((f: any) => ({ ...f, status: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs outline-none">
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Assign to Agent</label>
                    <select value={updateForm.assignedAgentId} onChange={e => onUpdateFormChange((f: any) => ({ ...f, assignedAgentId: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs outline-none">
                      <option value="">Unassigned</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Next Action</label>
                    <input value={updateForm.nextAction} onChange={e => onUpdateFormChange((f: any) => ({ ...f, nextAction: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs outline-none"
                      placeholder="What needs to happen next..." />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-muted-foreground mb-1">Progress Note</label>
                    <input value={updateForm.note} onChange={e => onUpdateFormChange((f: any) => ({ ...f, note: e.target.value }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs outline-none"
                      placeholder="Add a note to the activity log..." />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={onEditSave} disabled={saving}
                    className="bg-primary text-primary-foreground px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={onEditCancel} className="bg-muted text-muted-foreground px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-accent transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={onEditStart} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-900/30 text-indigo-400 hover:bg-indigo-900/50 transition-colors font-medium">
                  Update
                </button>
                <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors font-medium">
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Thread Bubble ──────────────────────────────────────────────────

function ThreadBubble({ msg, source }: { msg: ThreadMessage; source: string }) {
  const isUser = msg.role === 'USER'
  const isWidget = source === 'WIDGET'

  // For widget: USER = customer (right), ASSISTANT = AI agent (left)
  // For internal: USER = staff (right), ASSISTANT = AI agent (left)
  const isRight = isUser

  const initials = (msg.agentName ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const label = isUser
    ? (isWidget ? 'Customer' : 'Staff')
    : msg.agentName

  return (
    <div className={`flex gap-2 ${isRight ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
        isUser
          ? 'bg-slate-700 text-slate-300'
          : 'bg-indigo-900/60 text-indigo-300'
      }`}>
        {isUser ? <User className="w-3 h-3" /> : initials}
      </div>

      <div className={`flex flex-col gap-0.5 max-w-[75%] ${isRight ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground/60">
            {new Date(msg.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed ${
          isUser
            ? 'bg-slate-800/60 text-foreground rounded-tr-sm'
            : 'bg-indigo-900/20 text-foreground border border-indigo-900/30 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>
      </div>
    </div>
  )
}

// ── Dev Test Journey Modal ─────────────────────────────────────────

interface DevJourneyTicket {
  id: string
  ticketNumber: number
  status: TicketStatus
  stageIndex: number | null
  stageName: string
  assignedAgent: { id: string; name: string; role: string } | null
  nextAction: string | null
  followUpAt: string | null
  activityLog: any[]
  createdAt: string
  updatedAt: string
  suggestedReply: string | null
}

interface JourneyLogEntry {
  time: string
  icon: string
  label: string
  msg: string
}

function DevJourneyModal({ onClose }: { onClose: () => void }) {
  const [logs, setLogs]           = useState<JourneyLogEntry[]>([])
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'complete' | 'error' | 'cancelled'>('idle')
  const [busy, setBusy]           = useState(false)
  const [activeTab, setActiveTab] = useState<'terminal' | 'tickets'>('terminal')
  const [tickets, setTickets]     = useState<DevJourneyTicket[]>([])
  const [msg, setMsg]             = useState<{ text: string; ok: boolean } | null>(null)
  const [replyOverrides, setReplyOverrides] = useState<Record<string, string>>({})
  const [customerEmail, setCustomerEmail] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000) }

  const fetchLogs = async () => {
    try {
      const res = await api.get('/operations/test-journey/logs')
      setLogs(res.data.logs ?? [])
      setRunStatus(res.data.status ?? 'idle')
    } catch { /* ignore */ }
  }

  const fetchTickets = async () => {
    try {
      const res = await api.get('/operations/test-journey/tickets')
      setTickets(res.data ?? [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchLogs(); fetchTickets()
    pollRef.current = setInterval(() => { fetchLogs(); fetchTickets() }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs.length])

  const runFull = async () => {
    setBusy(true)
    try {
      const payload: Record<string, string> = {}
      if (customerEmail.trim()) payload.customerEmail = customerEmail.trim()
      const res = await api.post('/operations/test-journey/run-full', payload)
      flash(res.data.message); setActiveTab('terminal')
    } catch (e: any) { flash(`Error: ${e?.response?.data?.message ?? e.message}`, false) }
    finally { setBusy(false) }
  }

  const stopJourney = async () => {
    setBusy(true)
    try {
      const res = await api.post('/operations/test-journey/stop')
      flash(res.data.message, res.data.ok !== false)
      await fetchLogs()
      await fetchTickets()
    } catch (e: any) { flash(`Error: ${e?.response?.data?.message ?? e.message}`, false) }
    finally { setBusy(false) }
  }

  const forceResetJourney = async () => {
    setBusy(true)
    try {
      const res = await api.post('/operations/test-journey/reset')
      flash(res.data.message, res.data.ok !== false)
      await fetchLogs()
      await fetchTickets()
    } catch (e: any) { flash(`Error: ${e?.response?.data?.message ?? e.message}`, false) }
    finally { setBusy(false) }
  }

  const simulateReply = async (ticketId: string) => {
    setBusy(true)
    try {
      const reply = replyOverrides[ticketId] ?? undefined
      const res = await api.post(`/operations/test-journey/reply/${ticketId}`, { reply })
      flash(res.data.message); await fetchTickets()
    } catch (e: any) { flash(`Error: ${e?.response?.data?.message ?? e.message}`, false) }
    finally { setBusy(false) }
  }

  const forceAdvance = async (ticketId: string) => {
    setBusy(true)
    try {
      const res = await api.post(`/operations/test-journey/advance/${ticketId}`)
      flash(res.data.message); await fetchTickets()
    } catch (e: any) { flash(`Error: ${e?.response?.data?.message ?? e.message}`, false) }
    finally { setBusy(false) }
  }

  const STATUS_DOT: Record<string, string> = {
    idle: 'text-muted-foreground', running: 'text-amber-500',
    complete: 'text-emerald-600', error: 'text-red-500', cancelled: 'text-orange-500',
  }
  const STATUS_LABEL: Record<string, string> = {
    idle: 'Idle', running: '● Running…', complete: '✓ Complete', error: '✕ Error', cancelled: '■ Stopped',
  }

  const activeTickets = tickets.filter(t => !['COMPLETED','CANCELLED'].includes(t.status))
  const doneTickets   = tickets.filter(t => t.status === 'COMPLETED')
  const devTabs: Array<'terminal' | 'tickets'> = ['terminal', 'tickets']

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-[540px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-amber-50/60 dark:bg-amber-950/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-300 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-foreground">Test Journey — Dev Panel</h2>
              <p className="text-[11px] text-muted-foreground">Full 22-stage simulation · {customerEmail.trim() ? `→ ${customerEmail.trim()}` : 'auto-detects lead from CRM'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold ${STATUS_DOT[runStatus]}`}>{STATUS_LABEL[runStatus]}</span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2 shrink-0 flex-wrap">
          <input
            type="email"
            placeholder="Lead email (leave blank to auto-detect from CRM)"
            value={customerEmail}
            onChange={e => setCustomerEmail(e.target.value)}
            disabled={runStatus === 'running'}
            className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-40"
          />
          <button
            onClick={runFull}
            disabled={busy || runStatus === 'running'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors disabled:opacity-40"
          >
            {busy && runStatus !== 'running' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
            {runStatus === 'running' ? 'Running…' : 'Run Full Journey'}
          </button>
          {runStatus === 'running' && (
            <button
              onClick={stopJourney}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors disabled:opacity-40"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3 fill-current" />}
              Stop Journey
            </button>
          )}
          {(runStatus === 'running' || logs.length > 0) && (
            <button
              onClick={forceResetJourney}
              disabled={busy}
              title="Force-clear stuck journey state and cancel all open test tickets"
              className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold transition-colors disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" />
              Force Reset
            </button>
          )}
          <span className="text-[10px] text-muted-foreground hidden sm:block font-mono">node test-full-journey.js</span>
          <div className="flex gap-0.5 ml-auto">
            {devTabs.map(tabName => (
              <button key={tabName} onClick={() => setActiveTab(tabName)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded transition-colors ${
                  activeTab === tabName
                    ? 'bg-background text-foreground shadow border border-border font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}>
                {tabName === 'terminal'
                  ? <><Terminal className="w-3 h-3" />Terminal</>
                  : <><LayoutList className="w-3 h-3" />Tickets ({tickets.filter(t => t.status !== 'CANCELLED').length})</>
                }
              </button>
            ))}
          </div>
        </div>

        {/* ── Message banner ── */}
        {msg && (
          <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
            msg.ok
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {msg.text}
          </div>
        )}

        {/* ══════════════ TERMINAL TAB ══════════════ */}
        {activeTab === 'terminal' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* idle start screen */}
            {logs.length === 0 && runStatus === 'idle' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5">
                <FlaskConical className="w-10 h-10 text-amber-400" />
                <div className="text-center">
                  <p className="text-base font-bold text-foreground mb-1">Press <span className="text-amber-600">Run Full Journey</span> — then do nothing</p>
                  <p className="text-sm text-muted-foreground">Everything is fully automatic. No clicking required.</p>
                </div>

                {/* Auto-script preview table */}
                <div className="w-full max-w-md border border-border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-muted border-b border-border">
                    <p className="text-xs font-semibold text-foreground">What happens automatically:</p>
                  </div>
                  {[
                    { who: 'Charlie',       icon: '🤖', what: 'Sends outreach email to ronaldo@mitiesoft.com',     ronaldo: false },
                    { who: 'Ronaldo ✓',     icon: '👤', what: 'Auto-reply: "Interested, tell me more"',            ronaldo: true  },
                    { who: 'Charlie',       icon: '🤖', what: 'Answers and qualifies the lead',                    ronaldo: false },
                    { who: 'Ronaldo ✓',     icon: '👤', what: 'Auto-reply: "I am fully on board"',               ronaldo: true  },
                    { who: 'Will',          icon: '🤖', what: 'Sales consultation email',                          ronaldo: false },
                    { who: 'Ronaldo ✓',     icon: '👤', what: 'Auto-reply: "Insurance help sounds great"',         ronaldo: true  },
                    { who: 'Hanna',         icon: '🤖', what: 'Sends available inspection dates',                  ronaldo: false },
                    { who: 'Ronaldo ✓',     icon: '👤', what: 'Auto-reply: "July 10th at 10am works" → SCHEDULED', ronaldo: true },
                    { who: 'System',        icon: '✉️', what: 'Sends confirmation email to Ronaldo',               ronaldo: false },
                    { who: 'Jared → Linda', icon: '🤖', what: 'Stages 3–7 internal work auto-completes',      ronaldo: false },
                  ].map((row, i) => (
                    <div key={i} className={`flex items-start gap-3 px-3 py-2 border-b border-border/60 last:border-0 ${row.ronaldo ? 'bg-pink-50/60 dark:bg-pink-950/10' : ''}`}>
                      <span className="text-base shrink-0">{row.icon}</span>
                      <span className={`text-xs font-semibold w-[80px] shrink-0 ${row.ronaldo ? 'text-pink-700' : 'text-foreground'}`}>{row.who}</span>
                      <span className="text-xs text-muted-foreground leading-relaxed">{row.what}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live log output */}
            {(logs.length > 0 || runStatus !== 'idle') && (
              <div className="flex-1 overflow-y-auto bg-zinc-950 font-mono text-[11px] leading-relaxed px-4 py-3 space-y-0.5">
                {logs.map((entry, i) => {
                  const isDivider = entry.label === '\u2500\u2500\u2500\u2500\u2500'
                  const lc =
                    entry.label.includes('ERROR')    ? 'text-red-400' :
                    entry.label.includes('COMPLETE') || entry.label === 'DONE' ? 'text-emerald-400' :
                    entry.label.includes('WAKE')     ? 'text-amber-300' :
                    entry.label.startsWith('STAGE')  ? 'text-indigo-300' :
                    entry.label === 'CHARLIE' || entry.label === 'WILL' || entry.label === 'HANNA' ? 'text-cyan-300' :
                    entry.label === 'EMAIL' || entry.label === 'CUSTOMER' ? 'text-pink-300' :
                    entry.label === 'TICKET' || entry.label === 'CREATE'  ? 'text-green-300' :
                    'text-zinc-400'
                  return isDivider ? (
                    <div key={i} className="text-zinc-600 py-0.5 select-none">
                      {'─'.repeat(6)} <span className="text-zinc-400">{entry.msg}</span> {'─'.repeat(6)}
                    </div>
                  ) : (
                    <div key={i} className="flex gap-2 hover:bg-white/5 rounded px-1 -mx-1">
                      <span className="text-zinc-600 shrink-0 w-[54px] tabular-nums">{entry.time}</span>
                      <span className="shrink-0 w-5 text-center">{entry.icon}</span>
                      <span className={`shrink-0 w-[86px] truncate font-semibold ${lc}`}>[{entry.label.slice(0,10)}]</span>
                      <span className="text-zinc-200 break-all leading-snug">{entry.msg}</span>
                    </div>
                  )
                })}

                {runStatus === 'running' && (
                  <div className="flex gap-2 text-amber-400 animate-pulse pl-1 mt-1">
                    <span className="w-[54px]"> </span>
                    <span className="w-5 text-center">●</span>
                    <span className="text-zinc-500">[WAIT]</span>
                    <span>agents processing…</span>
                  </div>
                )}
                {runStatus === 'complete' && (
                  <div className="mt-3 text-emerald-400 font-bold text-center text-xs py-2 border-t border-zinc-800">
                    ✓ All 8 stages complete — check Pipeline tab and ronaldo@mitiesoft.com inbox
                  </div>
                )}
                {runStatus === 'error' && (
                  <div className="mt-3 text-red-400 font-bold text-center text-xs py-2 border-t border-zinc-800">
                    ✕ Journey failed — check log above for the error
                  </div>
                )}
                {runStatus === 'cancelled' && (
                  <div className="mt-3 text-orange-400 font-bold text-center text-xs py-2 border-t border-zinc-800">
                    ■ Journey stopped — open test tickets were cancelled
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}

        {/* ══════════════ TICKETS TAB ══════════════ */}
        {activeTab === 'tickets' && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

            {/* Auto-pilot banner */}
            {runStatus === 'running' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <p className="text-sm font-bold text-emerald-800 flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4" /> Full auto-pilot active
                </p>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  Ronaldo&apos;s replies are being injected automatically after each agent responds.
                  No action needed — watch the <span className="font-semibold">Terminal</span> tab for live output.
                </p>
              </div>
            )}

            {/* Ronaldo replies reference */}
            {runStatus !== 'idle' && (
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-muted border-b border-border flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-pink-500" />
                  <span className="text-xs font-bold text-foreground">Ronaldo&apos;s auto-replies (pre-scripted, injected automatically)</span>
                </div>
                {[
                  { stage: 'Stage 0 — Reply 1', text: 'Interested in the free inspection — tell me more about the process.' },
                  { stage: 'Stage 0 — Reply 2', text: 'I am fully on board — let us move forward with the inspection.' },
                  { stage: 'Stage 1 — Sales',   text: 'Insurance assistance sounds great — what are the next steps?' },
                  { stage: 'Stage 2 — Date',    text: 'July 10th at 10am works perfectly → confirms inspection date.' },
                ].map((r, i) => (
                  <div key={i} className="flex gap-3 px-3 py-2.5 border-b border-border/60 last:border-0">
                    <span className="text-xs font-semibold text-pink-600 shrink-0 w-[110px]">{r.stage}</span>
                    <span className="text-xs text-muted-foreground leading-relaxed">{r.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {tickets.filter(t => t.status !== 'CANCELLED').length === 0 && runStatus === 'idle' && (
              <div className="text-center py-10">
                <p className="text-sm text-muted-foreground">No test tickets yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Click <strong className="text-amber-600">Run Full Journey</strong> — everything runs automatically.</p>
              </div>
            )}

            {/* Active tickets */}
            {activeTickets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Active ({activeTickets.length})
                  {runStatus === 'running' && <span className="ml-2 text-emerald-600 normal-case font-normal">auto-handling…</span>}
                </p>
                {activeTickets.map(t => (
                  <div key={t.id} className={`border rounded-xl p-3.5 space-y-2.5 bg-card ${
                    t.status === 'AWAITING_CUSTOMER'
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-indigo-200 bg-indigo-50/30'
                  }`}>
                    {/* Stage header */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-muted-foreground font-mono">S{(t.stageIndex ?? 0) + 1}</span>
                      <span className="text-sm font-bold text-foreground">{t.stageName}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}>
                        {t.status.replace(/_/g, ' ')}
                      </span>
                      {t.assignedAgent && (
                        <span className="text-xs text-muted-foreground ml-auto font-medium">{t.assignedAgent.name}</span>
                      )}
                    </div>

                    {/* Next action */}
                    {t.nextAction && (
                      <p className="text-xs text-indigo-700 flex items-start gap-1.5 font-medium">
                        <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{t.nextAction}</span>
                      </p>
                    )}

                    {/* Auto-pilot badge OR manual override */}
                    {runStatus === 'running' ? (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                        <Zap className="w-3 h-3" />
                        Auto-pilot handling this stage — no action needed
                      </div>
                    ) : (
                      <div className="space-y-2 pt-1 border-t border-border/60">
                        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Manual override</p>
                        {['AWAITING_CUSTOMER', 'OPEN'].includes(t.status) && (
                          <textarea
                            value={replyOverrides[t.id] ?? t.suggestedReply ?? ''}
                            onChange={e => setReplyOverrides(r => ({ ...r, [t.id]: e.target.value }))}
                            rows={2}
                            placeholder={t.suggestedReply ?? 'Customer reply…'}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none resize-none focus:ring-1 focus:ring-amber-500 placeholder:text-muted-foreground"
                          />
                        )}
                        <div className="flex gap-2">
                          {['AWAITING_CUSTOMER', 'OPEN'].includes(t.status) && (
                            <button onClick={() => simulateReply(t.id)} disabled={busy}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 disabled:opacity-40 font-medium transition-colors">
                              <Mail className="w-3 h-3" /> Inject Reply
                            </button>
                          )}
                          <button onClick={() => forceAdvance(t.id)} disabled={busy}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-100 border border-indigo-300 text-indigo-800 hover:bg-indigo-200 disabled:opacity-40 font-medium transition-colors">
                            <SkipForward className="w-3 h-3" /> Force Advance
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Completed */}
            {doneTickets.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-foreground uppercase tracking-wider">Completed ({doneTickets.length})</p>
                {doneTickets.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-xs font-semibold text-emerald-900">S{(t.stageIndex ?? 0) + 1} — {t.stageName}</span>
                    <span className="text-[10px] text-emerald-700 ml-auto font-mono">#{String(t.ticketNumber).padStart(4,'0')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="border-t border-border px-5 py-3 shrink-0 flex items-center justify-between bg-muted/20">
          <p className="text-xs text-muted-foreground font-mono">ronaldo@mitiesoft.com ← info@stormbuddy.co</p>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-accent transition-colors font-medium">
            Close
          </button>
        </div>
      </div>
    </>
  )
}
// ── Lead Journey Drawer ────────────────────────────────────────────

const JOURNEY_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-500',
  IN_PROGRESS: 'bg-indigo-500',
  AWAITING_CUSTOMER: 'bg-amber-500',
  AWAITING_AGENT: 'bg-orange-500',
  SCHEDULED: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  ESCALATED: 'bg-red-500',
  CANCELLED: 'bg-gray-600',
}

const JOURNEY_STATUS_TEXT: Record<string, string> = {
  OPEN: 'text-blue-400',
  IN_PROGRESS: 'text-indigo-400',
  AWAITING_CUSTOMER: 'text-amber-400',
  AWAITING_AGENT: 'text-orange-400',
  SCHEDULED: 'text-purple-400',
  COMPLETED: 'text-emerald-400',
  ESCALATED: 'text-red-400',
  CANCELLED: 'text-gray-500',
}

function LeadJourneyDrawer({ leadId, journey, loading, onClose, onRefresh }: {
  leadId: string
  journey: LeadJourney | null
  loading: boolean
  onClose: () => void
  onRefresh: () => void
}) {
  const [showTimeline, setShowTimeline] = useState(false)

  const progressPct = journey
    ? Math.round((journey.completedStages / Math.max(journey.totalStages, 1)) * 100)
    : 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="font-semibold text-sm">Lead Journey</h2>
              {journey?.contactRef && (
                <p className="text-xs text-muted-foreground">{journey.contactRef}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading journey...
            </div>
          )}

          {!loading && !journey && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-sm">
              <Route className="w-8 h-8 mb-3 opacity-30" />
              <p>No journey data found</p>
              <p className="text-xs mt-1 text-muted-foreground/60">Lead ID: {leadId}</p>
            </div>
          )}

          {!loading && journey && (
            <div className="p-5 space-y-5">
              {/* Contact + status summary */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{journey.contactRef ?? 'Unknown Contact'}</p>
                    {journey.contactEmail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{journey.contactEmail}</p>
                    )}
                    {journey.contactPhone && (
                      <p className="text-xs text-muted-foreground">{journey.contactPhone}</p>
                    )}
                  </div>
                  {journey.currentStatus && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${STATUS_COLORS[journey.currentStatus as TicketStatus] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                      {journey.currentStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                    <span>Pipeline progress</span>
                    <span>{journey.completedStages} / {journey.totalStages} stages</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                {/* Pending reason */}
                {journey.pendingReason && (
                  <div className="flex items-start gap-2 bg-amber-900/10 border border-amber-800/20 rounded-lg px-3 py-2">
                    <Clock className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-300">{journey.pendingReason}</p>
                  </div>
                )}
              </div>

              {/* Stage steps */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Stages</p>
                <div className="relative space-y-0">
                  {journey.stages.map((stage, i) => {
                    const isComplete = stage.status === 'COMPLETED'
                    const isCancelled = stage.status === 'CANCELLED'
                    const isCurrent = !isComplete && !isCancelled
                    const dotColor = JOURNEY_STATUS_COLORS[stage.status] ?? 'bg-gray-600'
                    const isLast = i === journey.stages.length - 1

                    return (
                      <div key={stage.id} className="flex gap-3">
                        {/* Timeline spine */}
                        <div className="flex flex-col items-center shrink-0">
                          <div className={`w-3 h-3 rounded-full border-2 ${isComplete ? 'bg-emerald-500 border-emerald-400' : isCurrent ? dotColor + ' border-white/20' : 'bg-gray-700 border-gray-600'} z-10 mt-2`} />
                          {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>

                        {/* Stage card */}
                        <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                          <div className={`border rounded-xl p-3 ${isCurrent ? 'border-indigo-800/40 bg-indigo-900/10' : isComplete ? 'border-emerald-800/30 bg-emerald-900/5' : 'border-border bg-muted/10'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {stage.stageIndex !== null && (
                                    <span className="text-[10px] font-bold text-muted-foreground/60">S{stage.stageIndex + 1}</span>
                                  )}
                                  <span className="text-xs font-semibold truncate">{stage.stageName}</span>
                                  <span className={`text-[10px] font-medium ${JOURNEY_STATUS_TEXT[stage.status] ?? 'text-muted-foreground'}`}>
                                    {stage.status.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                {stage.assignedAgent && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Agent: {stage.assignedAgent.name}
                                  </p>
                                )}
                                {stage.nextAction && isCurrent && (
                                  <p className="text-[11px] text-indigo-400 mt-1 flex items-start gap-1">
                                    <ChevronRight className="w-3 h-3 shrink-0 mt-0.5" />
                                    <span className="line-clamp-2">{stage.nextAction}</span>
                                  </p>
                                )}
                                {stage.followUpAt && (
                                  <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${new Date(stage.followUpAt) < new Date() && isCurrent ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                    <Clock className="w-2.5 h-2.5 shrink-0" />
                                    {stage.status === 'AWAITING_CUSTOMER' ? 'Follow-up: ' : 'Scheduled: '}
                                    {new Date(stage.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    {stage.followUpAttempts > 0 && (
                                      <span className="text-amber-400 ml-1">({stage.followUpAttempts}/3 attempts)</span>
                                    )}
                                  </p>
                                )}
                                <p className="text-[10px] text-muted-foreground/50 mt-1">
                                  #{String(stage.ticketNumber ?? 0).padStart(4, '0')} · Created {new Date(stage.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                  {stage.resolvedAt && ` · Done ${new Date(stage.resolvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                                </p>
                              </div>
                              {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
                              {stage.status === 'ESCALATED' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Timeline toggle */}
              <div>
                <button
                  onClick={() => setShowTimeline(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {showTimeline ? 'Hide' : 'Show'} full activity timeline ({journey.timeline.length} events)
                  {showTimeline ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showTimeline && (
                  <div className="mt-3 space-y-2">
                    {journey.timeline.map((event, i) => (
                      <div key={i} className="flex gap-2.5 text-xs">
                        <div className="flex flex-col items-center shrink-0 mt-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                          {i < journey.timeline.length - 1 && <div className="w-px flex-1 bg-border/40 mt-1" />}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-foreground/80">{event.agentName}</span>
                            <span className="text-muted-foreground/60">·</span>
                            <span className="text-muted-foreground/60 font-mono">{event.action}</span>
                            {event.stageIndex !== null && (
                              <span className="text-[10px] bg-muted px-1 py-0.5 rounded text-muted-foreground">S{(event.stageIndex ?? 0) + 1}</span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-0.5 leading-relaxed">{event.note}</p>
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                            {new Date(event.timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground/60">Lead ID: {leadId.slice(0, 16)}</p>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
