import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { AgentGrid } from '@/components/dashboard/agent-grid'
import { RecentActivity } from '@/components/dashboard/recent-activity'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your AI workforce at a glance</p>
      </div>
      <DashboardStats />
      <AgentGrid />
      <RecentActivity />
    </div>
  )
}
