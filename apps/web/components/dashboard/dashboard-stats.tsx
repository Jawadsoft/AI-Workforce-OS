'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CheckSquare, Clock, FileText, Users } from 'lucide-react'

export function DashboardStats() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => api.get('/analytics/summary').then((r) => r.data),
    refetchInterval: 30000,
  })

  const stats = [
    { label: 'Tasks Today', value: data?.tasksToday ?? 0, icon: CheckSquare, color: 'text-primary' },
    { label: 'Pending Approvals', value: data?.pendingApprovals ?? 0, icon: Clock, color: 'text-yellow-500' },
    { label: 'Documents Generated', value: data?.totalDocuments ?? 0, icon: FileText, color: 'text-primary/70' },
    { label: 'Active Agents', value: data?.activeAgents ?? 0, icon: Users, color: 'text-primary/50' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => {
        const Icon = s.icon
        return (
          <div key={s.label} className="rounded-lg border border-border bg-card p-4">
            {isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-7 w-16 bg-muted rounded" />
                <div className="h-4 w-24 bg-muted rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-bold">{s.value}</p>
                  <Icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
