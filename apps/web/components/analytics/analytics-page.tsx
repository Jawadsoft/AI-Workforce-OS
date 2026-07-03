'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  BarChart3, CheckSquare, MessageSquare, FileText, Users, ThumbsUp,
  Activity, Zap, AlertTriangle, TrendingUp, Clock, ArrowRight,
} from 'lucide-react'
import { resolveAvatarUrl } from '@/lib/utils'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2']

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600', purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  CRM_LEAD_IMPORTED:    'CRM Lead Imported',
  PIPELINE_ADVANCED:    'Pipeline Advanced',
  STORM_LEAD_CREATED:   'Storm Lead Created',
  STORM_ALERT_CREATED:  'Storm Alert',
  FOLLOW_UP_OVERDUE:    'Follow-up Overdue',
  NO_RESPONSE_ESCALATION: 'No-Response Escalation',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

const STATUS_COLOR: Record<string, string> = {
  OPEN:              '#3b82f6',
  IN_PROGRESS:       '#6366f1',
  AWAITING_CUSTOMER: '#f59e0b',
  AWAITING_AGENT:    '#f97316',
  SCHEDULED:         '#8b5cf6',
  COMPLETED:         '#22c55e',
  ESCALATED:         '#ef4444',
  CANCELLED:         '#6b7280',
}

export function AnalyticsPage() {
  const [tab, setTab] = useState<'ai' | 'ops'>('ops')

  const { data: summary } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => api.get('/analytics/summary').then(r => r.data),
    refetchInterval: 30000,
  })
  const { data: taskData = [] } = useQuery({
    queryKey: ['analytics-tasks'],
    queryFn: () => api.get('/analytics/tasks?days=14').then(r => r.data),
  })
  const { data: agentData = [] } = useQuery({
    queryKey: ['analytics-agents'],
    queryFn: () => api.get('/analytics/agents').then(r => r.data),
  })
  const { data: approvalData } = useQuery({
    queryKey: ['analytics-approvals'],
    queryFn: () => api.get('/analytics/approvals').then(r => r.data),
  })
  const { data: convoData = [] } = useQuery({
    queryKey: ['analytics-conversations'],
    queryFn: () => api.get('/analytics/conversations?days=14').then(r => r.data),
  })
  const { data: pipelineData } = useQuery({
    queryKey: ['analytics-pipeline'],
    queryFn: () => api.get('/analytics/pipeline').then(r => r.data),
    refetchInterval: 30000,
  })
  const { data: activityFeed = [] } = useQuery({
    queryKey: ['analytics-activity'],
    queryFn: () => api.get('/analytics/activity?limit=150').then(r => r.data),
    refetchInterval: 30000,
  })

  const approvalPieData = Object.entries(approvalData?.byStatus ?? {}).map(([name, value]) => ({ name, value }))
  const statusPieData = Object.entries(pipelineData?.byStatus ?? {}).map(([name, value]) => ({ name, value }))
  const priorityData = Object.entries(pipelineData?.byPriority ?? {}).map(([name, value]) => ({ name, value }))

  const formatDate = (d: string) => {
    const date = new Date(d)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  const totals = pipelineData?.totals ?? {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6" /> Analytics</h1>
          <p className="text-muted-foreground mt-1">AI workforce performance metrics</p>
        </div>
        <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
          <button onClick={() => setTab('ops')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'ops' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Activity className="w-4 h-4" /> Operations
          </button>
          <button onClick={() => setTab('ai')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'ai' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            <Zap className="w-4 h-4" /> AI Workforce
          </button>
        </div>
      </div>

      {/* ── OPERATIONS TAB ─────────────────────────────────────────── */}
      {tab === 'ops' && (
        <div className="space-y-6">
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Total Jobs',       value: totals.total          ?? 0, icon: CheckSquare,   color: 'text-foreground' },
              { label: 'Active',           value: totals.active         ?? 0, icon: TrendingUp,    color: 'text-blue-400' },
              { label: 'Completed',        value: totals.completed      ?? 0, icon: CheckSquare,   color: 'text-emerald-400' },
              { label: 'Escalated',        value: totals.escalated      ?? 0, icon: AlertTriangle, color: totals.escalated > 0 ? 'text-red-400' : 'text-muted-foreground' },
              { label: 'CRM Leads In',     value: totals.crmImported    ?? 0, icon: Users,         color: 'text-indigo-400' },
              { label: 'Pipeline Moves',   value: totals.pipelineAdvanced ?? 0, icon: ArrowRight,  color: 'text-violet-400' },
              { label: 'Avg Resolution',   value: totals.avgResolutionHours != null ? `${totals.avgResolutionHours}h` : '—', icon: Clock, color: 'text-muted-foreground' },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-xl px-3 py-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
                </div>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Daily ticket flow */}
            <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
              <p className="font-semibold mb-4 text-sm">Jobs Created vs Completed — Last 14 Days</p>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={(pipelineData?.dailyChart ?? [])}>
                  <defs>
                    <linearGradient id="cG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="dG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="created"   stroke="#3b82f6" fill="url(#cG)" name="Created" />
                  <Area type="monotone" dataKey="completed" stroke="#22c55e" fill="url(#dG)" name="Completed" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Status donut */}
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="font-semibold mb-4 text-sm">Jobs by Status</p>
              {statusPieData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">No tickets yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2} dataKey="value">
                      {statusPieData.map((entry, i) => (
                        <Cell key={i} fill={STATUS_COLOR[entry.name] ?? '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v, name.replace(/_/g, ' ')]} />
                    <Legend formatter={(v) => v.replace(/_/g, ' ')} iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Agent workload + top actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Agent workload */}
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="font-semibold mb-4 text-sm">Agent Workload</p>
              {(pipelineData?.byAgent ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No agent data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={(pipelineData?.byAgent ?? []).slice(0, 8).map((a: any) => ({ name: a.name.split(' ')[0], open: a.open, done: a.completed, esc: a.escalated }))}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={70} />
                    <Tooltip />
                    <Legend iconSize={8} />
                    <Bar dataKey="open"  fill="#3b82f6" name="Active"    radius={[0, 3, 3, 0]} stackId="a" />
                    <Bar dataKey="done"  fill="#22c55e" name="Completed" radius={[0, 3, 3, 0]} stackId="a" />
                    <Bar dataKey="esc"   fill="#ef4444" name="Escalated" radius={[0, 3, 3, 0]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Top system actions */}
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="font-semibold mb-4 text-sm">Top Automated Actions</p>
              {(pipelineData?.topActions ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No automated actions yet</p>
              ) : (
                <div className="space-y-2">
                  {(pipelineData?.topActions ?? []).map((a: any, i: number) => {
                    const max = pipelineData.topActions[0]?.count ?? 1
                    const pct = Math.round((a.count / max) * 100)
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium truncate">{actionLabel(a.action)}</span>
                            <span className="text-xs text-muted-foreground tabular-nums ml-2 shrink-0">{a.count}×</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Live Activity Feed */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <p className="font-semibold text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Live Activity Feed
              </p>
              <span className="text-xs text-muted-foreground">Last {(activityFeed as any[]).length} events · auto-refreshes</span>
            </div>
            {(activityFeed as any[]).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10">No activity yet — agents will log events here as they work</p>
            ) : (
              <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
                {(activityFeed as any[]).map((e: any, i: number) => {
                  const isSystem = e.agentName === 'System'
                  const ts = new Date(e.timestamp)
                  const ago = (() => {
                    const diff = (Date.now() - ts.getTime()) / 1000
                    if (diff < 60) return `${Math.round(diff)}s ago`
                    if (diff < 3600) return `${Math.round(diff / 60)}m ago`
                    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
                    return ts.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  })()

                  return (
                    <div key={i} className="flex items-start gap-3 px-5 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${isSystem ? 'bg-muted text-muted-foreground' : 'bg-indigo-900/50 text-indigo-300'}`}>
                        {isSystem ? '⚙' : e.agentName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold">{e.agentName}</span>
                          <span className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{actionLabel(e.action)}</span>
                          <span className="text-[11px] text-muted-foreground/60">#{String(e.ticketNumber).padStart(4, '0')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.note}</p>
                      </div>
                      <span className="text-[11px] text-muted-foreground/60 shrink-0 tabular-nums">{ago}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI WORKFORCE TAB ───────────────────────────────────────── */}
      {tab === 'ai' && (
        <div className="space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={CheckSquare} label="Tasks Today" value={summary?.tasksToday ?? 0} sub="completed" color="green" />
        <StatCard icon={CheckSquare} label="Tasks This Week" value={summary?.tasksThisWeek ?? 0} color="blue" />
        <StatCard icon={MessageSquare} label="Conversations" value={summary?.totalConversations ?? 0} sub="all time" color="purple" />
        <StatCard icon={FileText} label="Documents" value={summary?.totalDocuments ?? 0} sub="generated" color="orange" />
        <StatCard icon={Users} label="Active Agents" value={`${summary?.activeAgents ?? 0} / ${summary?.totalAgents ?? 0}`} sub="agents" color="blue" />
        <StatCard icon={ThumbsUp} label="Approval Rate" value={`${summary?.approvalRate ?? 0}%`} sub="of all approvals" color="green" />
      </div>

      {/* Tasks over time */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Tasks — Last 14 Days</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={(taskData as any[]).map(d => ({ ...d, date: formatDate(d.date) }))}>
            <defs>
              <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="total" stroke="#2563eb" fill="url(#totalGrad)" name="Created" />
            <Area type="monotone" dataKey="completed" stroke="#16a34a" fill="url(#completedGrad)" name="Completed" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent performance */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Tasks by Agent</h2>
          {(agentData as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No agent data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(agentData as any[]).slice(0, 8).map(a => ({ name: a.name.split(' ')[0], tasks: a.tasks, convos: a.conversations }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="tasks" fill="#2563eb" name="Tasks" radius={[0, 4, 4, 0]} />
                <Bar dataKey="convos" fill="#7c3aed" name="Chats" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Approval breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Approvals by Status</h2>
          {approvalPieData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No approvals yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={approvalPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                  paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {approvalPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Conversation volume */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Conversation Volume — Last 14 Days</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={(convoData as any[]).map(d => ({ ...d, date: formatDate(d.date) }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#7c3aed" name="Conversations" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Agent table */}
      {(agentData as any[]).length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Agent Leaderboard</h2>
          </div>
          <div className="divide-y divide-border">
            {(agentData as any[]).map((agent: any, idx: number) => (
              <div key={agent.id} className="flex items-center gap-4 px-4 py-3">
                <span className="text-sm font-bold text-muted-foreground w-6">{idx + 1}</span>
                {resolveAvatarUrl(agent.avatar)
                  ? <img src={resolveAvatarUrl(agent.avatar)!} alt={agent.name} className="w-8 h-8 rounded-full object-cover" />
                  : <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{agent.name[0]}</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.role}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold">{agent.tasks} tasks</p>
                  <p className="text-xs text-muted-foreground">{agent.conversations} chats</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  )
}
