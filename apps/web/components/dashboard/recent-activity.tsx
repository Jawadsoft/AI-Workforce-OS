'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CheckCircle, Clock, AlertCircle } from 'lucide-react'

export function RecentActivity() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks-recent'],
    queryFn: () => api.get('/tasks?limit=5').then((r) => r.data?.data ?? r.data ?? []),
  })

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-48 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
              </div>
            </div>
          ))
        ) : !tasks?.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No activity yet. Start chatting with your agents to see tasks here.
          </div>
        ) : (
          tasks.map((task: any) => {
            const Icon =
              task.status === 'COMPLETED' ? CheckCircle :
              task.status === 'PENDING_APPROVAL' ? AlertCircle : Clock
            const iconColor =
              task.status === 'COMPLETED' ? 'text-green-500' :
              task.status === 'PENDING_APPROVAL' ? 'text-yellow-500' : 'text-muted-foreground'
            return (
              <div key={task.id} className="p-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Icon className={`w-4 h-4 ${iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{task.status?.replace('_', ' ')}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {task.agent?.name ?? 'System'}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
