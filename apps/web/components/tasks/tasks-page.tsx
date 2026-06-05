'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CheckCircle, Clock, AlertCircle, XCircle, Plus, Loader2 } from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  PENDING: { label: 'Pending', icon: Clock, color: 'text-muted-foreground' },
  IN_PROGRESS: { label: 'In Progress', icon: Loader2, color: 'text-blue-500' },
  PENDING_APPROVAL: { label: 'Needs Approval', icon: AlertCircle, color: 'text-yellow-500' },
  COMPLETED: { label: 'Completed', icon: CheckCircle, color: 'text-green-500' },
  FAILED: { label: 'Failed', icon: XCircle, color: 'text-destructive' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, color: 'text-muted-foreground' },
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-muted-foreground bg-muted',
  MEDIUM: 'text-blue-600 bg-blue-500/10',
  HIGH: 'text-orange-600 bg-orange-500/10',
  URGENT: 'text-red-600 bg-red-500/10',
}

export function TasksPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<string>('ALL')
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'MEDIUM' })

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', filter],
    queryFn: () => api.get(`/tasks${filter !== 'ALL' ? `?status=${filter}` : ''}`).then((r) => r.data?.data ?? r.data ?? []),
    refetchInterval: 10000,
  })

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/tasks', newTask),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setShowCreate(false)
      setNewTask({ title: '', description: '', priority: 'MEDIUM' })
    },
  })

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/tasks/${id}`, { status: 'COMPLETED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const tasks: any[] = Array.isArray(data) ? data : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-card rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-semibold">Create Task</h2>
            <input
              autoFocus
              value={newTask.title}
              onChange={(e) => setNewTask((t) => ({ ...t, title: e.target.value }))}
              placeholder="Task title"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              value={newTask.description}
              onChange={(e) => setNewTask((t) => ({ ...t, description: e.target.value }))}
              placeholder="Description (optional)"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <select
              value={newTask.priority}
              onChange={(e) => setNewTask((t) => ({ ...t, priority: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none"
            >
              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newTask.title || createMutation.isPending}
                className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit bg-muted/30">
        {['ALL', 'PENDING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${filter === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {s === 'ALL' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Task list */}
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
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">No tasks found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {tasks.map((task: any) => {
            const s = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.PENDING
            const Icon = s.icon
            return (
              <div key={task.id} className="flex items-center gap-3 p-4">
                <Icon className={`w-4 h-4 shrink-0 ${s.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {task.priority && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.MEDIUM}`}>
                      {task.priority}
                    </span>
                  )}
                  {task.agent?.name && (
                    <span className="text-xs text-muted-foreground">{task.agent.name}</span>
                  )}
                  {task.status !== 'COMPLETED' && (
                    <button
                      onClick={() => completeMutation.mutate(task.id)}
                      className="text-xs text-muted-foreground hover:text-green-500 transition-colors px-2 py-1 rounded hover:bg-green-500/10"
                    >
                      Complete
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
