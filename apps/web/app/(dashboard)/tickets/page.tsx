'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import {
  Ticket, Plus, RefreshCw, Clock, AlertCircle,
  User, ChevronDown, ChevronUp, MessageSquare, Globe, Briefcase,
  ArrowRight, X, LayoutList, CheckCircle2,
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
  createdByAgentId: string | null
  assignedAgentId: string | null
  nextAction: string | null
  followUpAt: string | null
  resolvedAt: string | null
  activityLog: ActivityEntry[]
  createdAt: string
  updatedAt: string
  createdBy: Agent | null
  assignedAgent: Agent | null
  thread?: ThreadMessage[]
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
  OPEN: 'bg-blue-900/30 text-blue-400 border-blue-800/40',
  IN_PROGRESS: 'bg-indigo-900/30 text-indigo-400 border-indigo-800/40',
  AWAITING_CUSTOMER: 'bg-amber-900/30 text-amber-400 border-amber-800/40',
  AWAITING_AGENT: 'bg-orange-900/30 text-orange-400 border-orange-800/40',
  SCHEDULED: 'bg-purple-900/30 text-purple-400 border-purple-800/40',
  COMPLETED: 'bg-green-900/30 text-green-400 border-green-800/40',
  ESCALATED: 'bg-red-900/30 text-red-400 border-red-800/40',
  CANCELLED: 'bg-gray-800/50 text-gray-500 border-gray-700/40',
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [playbookStages, setPlaybookStages] = useState<PlaybookStage[]>([])
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
      if (tab !== 'pipeline') {
        params.set('source', tab === 'internal' ? 'INTERNAL' : 'WIDGET')
      }
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
            <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border">
              <RefreshCw className="w-3 h-3" />
              Auto-refreshes every 30s
            </span>
          )}
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
    </div>
  )
}

// ── Pipeline Monitor ───────────────────────────────────────────────

function PipelineMonitor({ tickets, agents, stages, expandedId, threadData, threadLoading, onExpand }: {
  tickets: ActivityTicket[]
  agents: Agent[]
  stages: PlaybookStage[]
  expandedId: string | null
  threadData: Record<string, ThreadMessage[]>
  threadLoading: string | null
  onExpand: (t: ActivityTicket) => void
}) {
  const activeTickets = tickets.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status))
  const completedToday = tickets.filter(t => {
    if (t.status !== 'COMPLETED') return false
    const updated = new Date(t.updatedAt)
    const today = new Date()
    return updated.toDateString() === today.toDateString()
  })

  // Match a ticket to a stage based on its assigned agent's role
  function matchStage(ticket: ActivityTicket): number {
    if (!ticket.assignedAgent?.role) return -1
    const agentRole = ticket.assignedAgent.role.toLowerCase()
    return stages.findIndex(s => {
      const stageRole = s.ownerRole?.toLowerCase() ?? ''
      return agentRole.includes(stageRole) || stageRole.includes(agentRole) ||
        agentRole.split(' ').some(word => word.length > 3 && stageRole.includes(word))
    })
  }

  // Group active tickets by stage
  const stageTickets: ActivityTicket[][] = stages.map(() => [])
  const unstagedTickets: ActivityTicket[] = []

  activeTickets.forEach(ticket => {
    const idx = matchStage(ticket)
    if (idx >= 0) stageTickets[idx].push(ticket)
    else unstagedTickets.push(ticket)
  })

  // Find agent name for a stage role
  function agentForRole(role: string): Agent | undefined {
    if (!role) return undefined
    const r = role.toLowerCase()
    return agents.find(a => {
      const ar = a.role?.toLowerCase() ?? ''
      return ar.includes(r) || r.includes(ar) || ar.split(' ').some(w => w.length > 3 && r.includes(w))
    })
  }

  const urgentCount = activeTickets.filter(t => t.priority === 'URGENT').length
  const escalatedCount = activeTickets.filter(t => t.status === 'ESCALATED').length
  const awaitingCount = activeTickets.filter(t => ['AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(t.status)).length

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Jobs', value: activeTickets.length, color: 'text-foreground' },
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

      {/* No playbook configured */}
      {stages.length === 0 && (
        <div className="border border-border rounded-xl p-8 text-center text-muted-foreground">
          <LayoutList className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No playbook configured</p>
          <p className="text-sm mt-1">Go to <strong>Brain → Playbook</strong> to define your pipeline stages.</p>
        </div>
      )}

      {/* Pipeline stages */}
      {stages.map((stage, i) => {
        const stageAgent = agentForRole(stage.ownerRole)
        const stageTix = stageTickets[i] ?? []
        const urgentInStage = stageTix.filter(t => t.priority === 'URGENT' || t.status === 'ESCALATED').length
        const isLast = i === stages.length - 1

        return (
          <div key={i} className="relative">
            {/* Connector line */}
            {!isLast && (
              <div className="absolute left-5 top-full w-px h-5 bg-border z-0" />
            )}

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Stage header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
                <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{stage.name}</span>
                    {stage.sla && (
                      <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                        SLA: {stage.sla}
                      </span>
                    )}
                    {urgentInStage > 0 && (
                      <span className="text-[11px] text-red-400 bg-red-900/20 border border-red-800/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {urgentInStage} urgent
                      </span>
                    )}
                  </div>
                  {stageAgent && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-4 h-4 rounded-full bg-indigo-900/50 flex items-center justify-center text-[9px] font-bold text-indigo-300 shrink-0">
                        {stageAgent.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs text-muted-foreground">{stageAgent.name}</span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-lg font-bold tabular-nums ${stageTix.length > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                    {stageTix.length}
                  </span>
                  <p className="text-[10px] text-muted-foreground">jobs</p>
                </div>
              </div>

              {/* Trigger / completion hint */}
              {(stage.trigger || stage.completion) && (
                <div className="px-4 py-2 border-b border-border flex gap-6 text-xs text-muted-foreground bg-muted/10">
                  {stage.trigger && <span><strong className="text-foreground/60">Starts when:</strong> {stage.trigger}</span>}
                  {stage.completion && <span><strong className="text-foreground/60">Done when:</strong> {stage.completion}</span>}
                </div>
              )}

              {/* Tickets in this stage */}
              {stageTix.length > 0 ? (
                <div className="divide-y divide-border">
                  {stageTix.map(ticket => (
                    <PipelineTicketRow
                      key={ticket.id}
                      ticket={ticket}
                      isExpanded={expandedId === ticket.id}
                      thread={threadData[ticket.id]}
                      threadLoading={threadLoading === ticket.id}
                      onExpand={() => onExpand(ticket)}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-4 text-xs text-muted-foreground/50 italic">
                  No active jobs in this stage
                </div>
              )}

              {/* Handoff arrow */}
              {stage.handoffTo && !isLast && (
                <div className="px-4 py-2 border-t border-border bg-muted/10 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowRight className="w-3 h-3" />
                  On completion → {agentForRole(stage.handoffTo)?.name ?? stage.handoffTo}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Unstaged tickets */}
      {unstagedTickets.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unassigned / Outside Pipeline</span>
            <span className="text-sm font-bold text-muted-foreground ml-auto">{unstagedTickets.length}</span>
          </div>
          <div className="divide-y divide-border">
            {unstagedTickets.map(ticket => (
              <PipelineTicketRow
                key={ticket.id}
                ticket={ticket}
                isExpanded={expandedId === ticket.id}
                thread={threadData[ticket.id]}
                threadLoading={threadLoading === ticket.id}
                onExpand={() => onExpand(ticket)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed today */}
      {completedToday.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden opacity-70">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Completed Today</span>
            <span className="text-sm font-bold text-emerald-400 ml-auto">{completedToday.length}</span>
          </div>
          <div className="divide-y divide-border">
            {completedToday.map(ticket => (
              <PipelineTicketRow
                key={ticket.id}
                ticket={ticket}
                isExpanded={expandedId === ticket.id}
                thread={threadData[ticket.id]}
                threadLoading={threadLoading === ticket.id}
                onExpand={() => onExpand(ticket)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pipeline Ticket Row (compact) ─────────────────────────────────

function PipelineTicketRow({ ticket, isExpanded, thread, threadLoading, onExpand }: {
  ticket: ActivityTicket
  isExpanded: boolean
  thread?: ThreadMessage[]
  threadLoading: boolean
  onExpand: () => void
}) {
  const isOverdue = ticket.followUpAt && new Date(ticket.followUpAt) < new Date() && !['COMPLETED', 'CANCELLED'].includes(ticket.status)
  const ticketId = `#${String(ticket.ticketNumber ?? 0).padStart(4, '0')}`
  const lastActivity = ticket.activityLog?.at(-1)

  return (
    <div className={`${isOverdue ? 'border-l-2 border-l-amber-500' : ''}`}>
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent/20 transition-colors"
        onClick={onExpand}
      >
        <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${PRIORITY_DOT[ticket.priority as Priority]}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">{ticketId}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_COLORS[ticket.status as TicketStatus]}`}>
              {ticket.status.replace(/_/g, ' ')}
            </span>
            {ticket.contactRef && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                <User className="w-2.5 h-2.5" />{ticket.contactRef}
              </span>
            )}
            {ticket.followUpAt && (
              <span className={`text-[11px] flex items-center gap-0.5 ${isOverdue ? 'text-amber-400' : 'text-muted-foreground'}`}>
                <Clock className="w-2.5 h-2.5" />
                {new Date(ticket.followUpAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-0.5 truncate">{ticket.subject ?? ticket.title}</p>
          {ticket.nextAction && (
            <p className="text-xs text-indigo-400 mt-0.5 flex items-center gap-1 truncate">
              <ArrowRight className="w-3 h-3 shrink-0" />{ticket.nextAction}
            </p>
          )}
          {lastActivity && !isExpanded && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
              Last: {lastActivity.agentName} — {lastActivity.note}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1 text-muted-foreground">
          {ticket.activityLog?.length > 0 && (
            <span className="text-[10px] tabular-nums">{ticket.activityLog.length} logs</span>
          )}
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </div>

      {/* Expanded: activity log + thread summary */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 bg-muted/10 border-t border-border space-y-4">

          {/* Description */}
          {ticket.description && (
            <p className="text-xs text-muted-foreground">{ticket.description}</p>
          )}

          {/* Activity log */}
          {ticket.activityLog?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Activity Log</p>
              <div className="space-y-2">
                {[...ticket.activityLog].reverse().map((entry, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <div className="flex flex-col items-center shrink-0 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/50" />
                      {i < ticket.activityLog.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                    </div>
                    <div className="pb-2 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{entry.agentName}</span>
                        <span className="text-muted-foreground/60 text-[11px]">
                          {new Date(entry.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5">{entry.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conversation thread preview */}
          {ticket.conversationId && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" /> Conversation
              </p>
              {threadLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              ) : thread && thread.length > 0 ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {thread.slice(-6).map((msg, i) => (
                    <div key={i} className={`flex gap-2 ${msg.role === 'USER' ? 'flex-row-reverse' : ''}`}>
                      <div className={`px-2.5 py-1.5 rounded-lg text-xs max-w-[80%] ${
                        msg.role === 'USER'
                          ? 'bg-muted text-foreground'
                          : 'bg-indigo-900/20 text-foreground border border-indigo-900/30'
                      }`}>
                        <span className="text-[10px] text-muted-foreground block mb-0.5">
                          {msg.role === 'USER' ? 'User' : msg.agentName}
                        </span>
                        {msg.content.slice(0, 200)}{msg.content.length > 200 ? '…' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No messages yet</p>
              )}
            </div>
          )}
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
