'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { BarChart3, CheckSquare, MessageSquare, FileText, Users, ThumbsUp } from 'lucide-react'
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

export function AnalyticsPage() {
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

  const approvalPieData = Object.entries(approvalData?.byStatus ?? {}).map(([name, value]) => ({ name, value }))

  const formatDate = (d: string) => {
    const date = new Date(d)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6" /> Analytics</h1>
        <p className="text-muted-foreground mt-1">AI workforce performance metrics</p>
      </div>

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
                {agent.avatar
                  ? <img src={agent.avatar} alt={agent.name} className="w-8 h-8 rounded-full object-cover" />
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
  )
}
