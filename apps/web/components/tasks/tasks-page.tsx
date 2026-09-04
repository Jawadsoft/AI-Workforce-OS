'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { resolveAvatarUrl } from '@/lib/utils'
import {
  CheckCircle, Clock, AlertCircle, XCircle, Plus, Loader2, Upload,
  RefreshCw, Mail, Ban, Pause, Pencil, Users,
} from 'lucide-react'

// ── Status display config ──────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  PENDING:          { label: 'Pending',        icon: Clock,        color: 'text-muted-foreground' },
  IN_PROGRESS:      { label: 'In Progress',    icon: Loader2,      color: 'text-blue-500' },
  PENDING_APPROVAL: { label: 'Needs Approval', icon: AlertCircle,  color: 'text-yellow-500' },
  COMPLETED:        { label: 'Completed',      icon: CheckCircle,  color: 'text-green-500' },
  FAILED:           { label: 'Failed',         icon: XCircle,      color: 'text-destructive' },
  CANCELLED:        { label: 'Cancelled',      icon: Ban,          color: 'text-muted-foreground' },
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW:    'text-muted-foreground bg-muted',
  MEDIUM: 'text-blue-600 bg-blue-500/10',
  HIGH:   'text-orange-600 bg-orange-500/10',
  URGENT: 'text-red-600 bg-red-500/10',
}

const US_TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (ET)' },
  { value: 'America/Chicago',     label: 'Central (CT)' },
  { value: 'America/Denver',      label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage',   label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HT)' },
]

// Status group → which DB statuses it covers
const STATUS_GROUPS: { key: string; label: string; statuses: string[]; isEmail?: boolean }[] = [
  { key: 'ALL',      label: 'All',     statuses: [] },
  { key: 'TODO',     label: 'To Do',   statuses: ['PENDING', 'PENDING_APPROVAL'] },
  { key: 'EMAIL',    label: 'Email',   statuses: ['PENDING'], isEmail: true },
  { key: 'RUNNING',  label: 'Running', statuses: ['IN_PROGRESS', 'PROCESSING'] },
  { key: 'DONE',     label: 'Done',    statuses: ['COMPLETED'] },
  { key: 'FAILED',   label: 'Failed',  statuses: ['FAILED', 'CANCELLED'] },
]

// ── Helpers ────────────────────────────────────────────────────────────────
function formatNextRun(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null
  const d = new Date(dueDate)
  if (isNaN(d.getTime())) return null
  const diffMs = d.getTime() - Date.now()
  if (diffMs < 0) return 'overdue'
  const diffH = Math.floor(diffMs / 3600000)
  const diffM = Math.floor((diffMs % 3600000) / 60000)
  if (diffH >= 24) return `in ${Math.floor(diffH / 24)}d`
  if (diffH > 0) return `in ${diffH}h ${diffM}m`
  return `in ${diffM}m`
}

function isEmailTask(task: any) {
  const meta = task.metadata ?? {}
  return meta.automatedAction === 'email_storm_report'
}

function matchesStatusGroup(task: any, groupKey: string): boolean {
  if (groupKey === 'ALL') return true
  const group = STATUS_GROUPS.find(g => g.key === groupKey)
  if (!group) return false
  if (!group.statuses.includes(task.status)) return false
  if (group.isEmail) return isEmailTask(task)
  // For TODO: exclude automated email tasks (they appear under EMAIL)
  if (groupKey === 'TODO') return !isEmailTask(task)
  return true
}

// ── Edit modal state ───────────────────────────────────────────────────────
type EditState = {
  id: string; isAutomated: boolean; title: string; description: string
  priority: string; recipientEmail: string; timeOfDay: string; timezone: string
  state: string; minSize: string; days: string
}

function buildEditState(task: any): EditState {
  const meta = task.metadata ?? {}
  const filters = meta.reportFilters ?? {}
  return {
    id:             task.id,
    isAutomated:    !!(meta.automatedAction && meta.automatedAction !== 'none'),
    title:          task.title ?? '',
    description:    task.description ?? '',
    priority:       task.priority ?? 'MEDIUM',
    recipientEmail: meta.recipientEmail ?? '',
    timeOfDay:      meta.timeOfDay ?? '08:00',
    timezone:       meta.timezone ?? 'America/Chicago',
    state:          filters.state ?? '',
    minSize:        filters.minSize != null ? String(filters.minSize) : '',
    days:           filters.days    != null ? String(filters.days)    : '1',
  }
}

// ── Agent avatar chip ──────────────────────────────────────────────────────
function AgentChip({ agent, count, selected, onClick }: {
  agent: any | null; count: number; selected: boolean; onClick: () => void
}) {
  const avatarUrl = agent ? resolveAvatarUrl(agent.avatar) : null
  const initials  = agent ? agent.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : 'AL'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border ${
        selected
          ? 'bg-foreground text-background border-foreground'
          : 'bg-background text-foreground border-border hover:border-foreground/40'
      }`}
    >
      {agent ? (
        avatarUrl
          ? <img src={avatarUrl} alt={agent.name} className="w-5 h-5 rounded-full object-cover object-top shrink-0" />
          : <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${selected ? 'bg-background/20' : 'bg-primary/10 text-primary'}`}>{initials}</span>
      ) : (
        <Users className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>{agent ? agent.name : 'All'}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${selected ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'}`}>
        {count}
      </span>
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export function TasksPage() {
  const qc = useQueryClient()

  const [agentFilter, setAgentFilter]   = useState<string>('ALL')  // 'ALL' or agentId
  const [statusFilter, setStatusFilter] = useState<string>('ALL')  // group key

  const [showCreate,    setShowCreate]    = useState(false)
  const [newTask,       setNewTask]       = useState({ title: '', description: '', priority: 'MEDIUM' })
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [editTask,      setEditTask]      = useState<EditState | null>(null)

  // Fetch ALL tasks (no server-side filter) — counts are computed client-side
  const { data: rawTasks, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get('/tasks?limit=200').then((r) => r.data?.data ?? r.data ?? []),
    refetchInterval: 15000,
  })

  const { data: agentsRaw = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  const allTasks: any[]    = Array.isArray(rawTasks) ? rawTasks : []
  const activeAgents: any[] = (agentsRaw as any[]).filter((a: any) => a.status === 'ACTIVE')

  // ── Compute counts ──────────────────────────────────────────────────────
  const agentCounts = useMemo(() => {
    const map: Record<string, number> = { ALL: allTasks.length }
    for (const task of allTasks) {
      if (task.agent?.id) map[task.agent.id] = (map[task.agent.id] ?? 0) + 1
    }
    return map
  }, [allTasks])

  const statusGroupCounts = useMemo(() => {
    const baseTasks = agentFilter === 'ALL' ? allTasks : allTasks.filter(t => t.agent?.id === agentFilter)
    const map: Record<string, number> = {}
    for (const group of STATUS_GROUPS) {
      map[group.key] = group.key === 'ALL'
        ? baseTasks.length
        : baseTasks.filter(t => matchesStatusGroup(t, group.key)).length
    }
    return map
  }, [allTasks, agentFilter])

  // ── Apply filters ───────────────────────────────────────────────────────
  const visibleTasks = useMemo(() => {
    return allTasks
      .filter(t => agentFilter === 'ALL' || t.agent?.id === agentFilter)
      .filter(t => matchesStatusGroup(t, statusFilter))
  }, [allTasks, agentFilter, statusFilter])

  // ── Mutations ───────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => api.post('/tasks', newTask),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setShowCreate(false)
      setNewTask({ title: '', description: '', priority: 'MEDIUM' })
    },
  })

  const editMutation = useMutation({
    mutationFn: (e: EditState) => {
      const body: Record<string, any> = {
        title: e.title || undefined, description: e.description || undefined, priority: e.priority || undefined,
      }
      if (e.isAutomated) {
        body.recipientEmail = e.recipientEmail || undefined
        body.timeOfDay      = e.timeOfDay      || undefined
        body.timezone       = e.timezone       || undefined
        body.reportFilters  = {
          ...(e.state   && { state: e.state.toUpperCase() }),
          ...(e.minSize && { minSize: parseFloat(e.minSize) }),
          ...(e.days    && { days:   parseInt(e.days) }),
        }
      }
      return api.patch(`/tasks/${e.id}`, body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setEditTask(null) },
  })

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/tasks/${id}`, { status: 'COMPLETED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); setCancelConfirm(null) },
  })

  const pauseMutation  = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/pause`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/resume`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const pushCRMMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/push-to-crm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
  const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

  return (
    <div className="space-y-4">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">View all tasks created by your AI employees</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-foreground text-background px-3.5 py-2 rounded-full text-sm font-medium hover:bg-foreground/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" /> Add task
        </button>
      </div>

      {/* ── Agent filter row ────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
        <AgentChip
          agent={null}
          count={agentCounts['ALL'] ?? 0}
          selected={agentFilter === 'ALL'}
          onClick={() => { setAgentFilter('ALL'); setStatusFilter('ALL') }}
        />
        {activeAgents.map((agent: any) => (
          <AgentChip
            key={agent.id}
            agent={agent}
            count={agentCounts[agent.id] ?? 0}
            selected={agentFilter === agent.id}
            onClick={() => { setAgentFilter(agent.id); setStatusFilter('ALL') }}
          />
        ))}
      </div>

      {/* ── Status group pills ──────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30 overflow-x-auto scrollbar-hide">
        {STATUS_GROUPS.map(({ key, label }) => {
          const count = statusGroupCounts[key] ?? 0
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                statusFilter === key ? 'bg-muted text-foreground' : 'bg-muted/60 text-muted-foreground'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Create modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-card rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-semibold">Create Task</h2>
            <input autoFocus value={newTask.title} onChange={(e) => setNewTask(t => ({ ...t, title: e.target.value }))} placeholder="Task title" className={inputCls} />
            <textarea value={newTask.description} onChange={(e) => setNewTask(t => ({ ...t, description: e.target.value }))} placeholder="Description (optional)" rows={3} className={`${inputCls} resize-none`} />
            <select value={newTask.priority} onChange={(e) => setNewTask(t => ({ ...t, priority: e.target.value }))} className={inputCls}>
              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => createMutation.mutate()} disabled={!newTask.title || createMutation.isPending} className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────── */}
      {editTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-card rounded-xl border border-border p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-base">Edit Task</h2>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Title</label>
                <input value={editTask.title} onChange={(e) => setEditTask(t => t && ({ ...t, title: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea value={editTask.description} onChange={(e) => setEditTask(t => t && ({ ...t, description: e.target.value }))} rows={2} className={`${inputCls} resize-none`} />
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select value={editTask.priority} onChange={(e) => setEditTask(t => t && ({ ...t, priority: e.target.value }))} className={inputCls}>
                  {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            {editTask.isAutomated && (
              <>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Automated Email Settings</p>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>Recipient Email</label>
                      <input type="email" value={editTask.recipientEmail} onChange={(e) => setEditTask(t => t && ({ ...t, recipientEmail: e.target.value }))} placeholder="email@example.com" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Send Time (24h)</label>
                        <input type="time" value={editTask.timeOfDay} onChange={(e) => setEditTask(t => t && ({ ...t, timeOfDay: e.target.value }))} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Timezone</label>
                        <select value={editTask.timezone} onChange={(e) => setEditTask(t => t && ({ ...t, timezone: e.target.value }))} className={inputCls}>
                          {US_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Report Filters</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>State (e.g. TX)</label>
                      <input value={editTask.state} onChange={(e) => setEditTask(t => t && ({ ...t, state: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="TX" maxLength={2} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Min Hail (in.)</label>
                      <input type="number" min="0" step="0.25" value={editTask.minSize} onChange={(e) => setEditTask(t => t && ({ ...t, minSize: e.target.value }))} placeholder="1.0" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Days back</label>
                      <input type="number" min="1" max="30" value={editTask.days} onChange={(e) => setEditTask(t => t && ({ ...t, days: e.target.value }))} placeholder="1" className={inputCls} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Leave State blank for all US states.</p>
                </div>
                <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-600">
                  If you change the send time, the next run will be automatically rescheduled.
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditTask(null)} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
              <button onClick={() => editMutation.mutate(editTask)} disabled={!editTask.title || editMutation.isPending} className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {editMutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel confirmation ──────────────────────────────────────── */}
      {cancelConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-sm bg-card rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-semibold">Cancel this task?</h2>
            <p className="text-sm text-muted-foreground">This will permanently stop any recurring automated emails. You can re-create it by asking the agent again.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCancelConfirm(null)} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Keep it</button>
              <button onClick={() => cancelMutation.mutate(cancelConfirm)} disabled={cancelMutation.isPending} className="px-3 py-2 bg-destructive text-destructive-foreground text-sm rounded-md hover:bg-destructive/90 disabled:opacity-50 transition-colors">
                {cancelMutation.isPending ? 'Cancelling...' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task list ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">No tasks found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {visibleTasks.map((task: any) => {
            const s    = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.PENDING
            const Icon = s.icon
            const meta = task.metadata ?? {}
            const isAutomated = !!(meta.automatedAction && meta.automatedAction !== 'none')
            const isRecurring = meta.recurring === 'daily'
            const nextRun     = isRecurring && task.status === 'PENDING' ? formatNextRun(task.dueDate) : null
            const isPaused    = meta.paused === true
            const isTerminal  = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(task.status)
            const canCancel   = !isTerminal
            const canEdit     = !isTerminal

            const agentAvatarUrl = task.agent?.avatar ? resolveAvatarUrl(task.agent.avatar) : null
            const agentInitials  = task.agent?.name
              ? task.agent.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
              : null

            return (
              <div key={task.id} className="flex items-start gap-3 p-3 sm:p-4">
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.color} ${task.status === 'IN_PROGRESS' ? 'animate-spin' : ''}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    {isRecurring && (
                      <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-500/10 px-2 py-0.5 rounded-full font-medium shrink-0">
                        <RefreshCw className="w-3 h-3" /> Daily
                      </span>
                    )}
                  </div>

                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
                  )}

                  {/* Automated task metadata */}
                  {isAutomated && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {meta.recipientEmail && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="w-3 h-3" />{meta.recipientEmail}
                        </span>
                      )}
                      {meta.timeOfDay && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {meta.timeOfDay} {US_TIMEZONES.find(t => t.value === meta.timezone)?.label ?? 'CT'}
                        </span>
                      )}
                      {nextRun && (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Next: {nextRun}</span>
                      )}
                      {isPaused && (
                        <span className="text-xs text-yellow-600 bg-yellow-500/10 px-2 py-0.5 rounded-full font-medium">Paused</span>
                      )}
                      {meta.lastSentAt && (
                        <span className="text-xs text-muted-foreground">
                          Last sent {new Date(meta.lastSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {task.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.MEDIUM}`}>
                        {task.priority}
                      </span>
                    )}
                    {/* Agent chip with avatar */}
                    {task.agent?.name && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {agentAvatarUrl
                          ? <img src={agentAvatarUrl} alt={task.agent.name} className="w-3.5 h-3.5 rounded-full object-cover object-top" />
                          : agentInitials && <span className="w-3.5 h-3.5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[8px] font-bold">{agentInitials}</span>
                        }
                        {task.agent.name}
                      </span>
                    )}
                    {task.pushedToCRM ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-medium">
                        <CheckCircle className="w-3 h-3" /> Synced
                      </span>
                    ) : (
                      <button
                        onClick={() => pushCRMMutation.mutate(task.id)}
                        disabled={pushCRMMutation.isPending && pushCRMMutation.variables === task.id}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-0.5 rounded-full hover:bg-primary/10 disabled:opacity-50 border border-border"
                        title="Push to CRM"
                      >
                        {pushCRMMutation.isPending && pushCRMMutation.variables === task.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Upload className="w-3 h-3" />}
                        <span className="hidden sm:inline">Push to CRM</span>
                        <span className="sm:hidden">CRM</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {canEdit && (
                    <button onClick={() => setEditTask(buildEditState(task))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-full hover:bg-muted" title="Edit task">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isAutomated && !isTerminal && !isPaused && (
                    <button onClick={() => pauseMutation.mutate(task.id)} disabled={pauseMutation.isPending && pauseMutation.variables === task.id} className="text-muted-foreground hover:text-yellow-500 transition-colors p-1.5 rounded-full hover:bg-yellow-500/10" title="Pause">
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {isAutomated && isPaused && (
                    <button onClick={() => resumeMutation.mutate(task.id)} disabled={resumeMutation.isPending && resumeMutation.variables === task.id} className="text-muted-foreground hover:text-green-500 transition-colors p-1.5 rounded-full hover:bg-green-500/10" title="Resume">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                  {!isAutomated && !isTerminal && (
                    <button onClick={() => completeMutation.mutate(task.id)} className="text-muted-foreground hover:text-green-500 transition-colors p-1.5 rounded-full hover:bg-green-500/10" title="Mark complete">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                  {canCancel && (
                    <button onClick={() => setCancelConfirm(task.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-full hover:bg-destructive/10" title="Cancel task">
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
