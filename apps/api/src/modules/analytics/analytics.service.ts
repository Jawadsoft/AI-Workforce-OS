import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekAgo = new Date(Date.now() - 7 * 864e5)
    const monthAgo = new Date(Date.now() - 30 * 864e5)

    const [
      tasksToday, tasksPendingApproval, totalAgents, activeAgents,
      totalDocuments, totalConversations, totalMessages,
      tasksThisWeek, tasksThisMonth, approvalsApproved, approvalsRejected,
    ] = await Promise.all([
      this.prisma.task.count({ where: { tenantId, status: 'COMPLETED', updatedAt: { gte: today } } }),
      this.prisma.approval.count({ where: { tenantId, status: 'PENDING' } }),
      this.prisma.agent.count({ where: { tenantId } }),
      this.prisma.agent.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.generatedDocument.count({ where: { tenantId } }),
      this.prisma.conversation.count({ where: { tenantId } }),
      this.prisma.message.count({ where: { conversation: { tenantId } } }),
      this.prisma.task.count({ where: { tenantId, createdAt: { gte: weekAgo } } }),
      this.prisma.task.count({ where: { tenantId, createdAt: { gte: monthAgo } } }),
      this.prisma.approval.count({ where: { tenantId, status: 'APPROVED' } }),
      this.prisma.approval.count({ where: { tenantId, status: 'REJECTED' } }),
    ])

    const totalApprovals = approvalsApproved + approvalsRejected
    return {
      tasksToday, tasksPendingApproval, totalAgents, activeAgents,
      totalDocuments, totalConversations, totalMessages,
      tasksThisWeek, tasksThisMonth,
      approvalRate: totalApprovals > 0 ? Math.round((approvalsApproved / totalApprovals) * 100) : 0,
    }
  }

  // Tasks per day for the last N days
  async getTasksOverTime(tenantId: string, days = 14) {
    const start = new Date(Date.now() - days * 864e5)
    const tasks = await this.prisma.task.findMany({
      where: { tenantId, createdAt: { gte: start } },
      select: { createdAt: true, status: true },
    })

    const byDay: Record<string, { total: number; completed: number }> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 864e5)
      const key = d.toISOString().slice(0, 10)
      byDay[key] = { total: 0, completed: 0 }
    }
    for (const t of tasks) {
      const key = t.createdAt.toISOString().slice(0, 10)
      if (byDay[key]) {
        byDay[key].total++
        if (t.status === 'COMPLETED') byDay[key].completed++
      }
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }))
  }

  // Tasks and conversations per agent
  async getAgentBreakdown(tenantId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { tenantId },
      select: {
        id: true, name: true, role: true, avatar: true, status: true,
        _count: { select: { tasks: true, conversations: true } },
      },
    })
    return agents.map(a => ({
      id: a.id, name: a.name, role: a.role, avatar: a.avatar, status: a.status,
      tasks: a._count.tasks,
      conversations: a._count.conversations,
    })).sort((a, b) => b.tasks - a.tasks)
  }

  // Approval breakdown
  async getApprovalStats(tenantId: string) {
    const approvals = await this.prisma.approval.findMany({
      where: { tenantId },
      select: { status: true, type: true, createdAt: true },
    })
    const byStatus: Record<string, number> = {}
    const byType: Record<string, number> = {}
    for (const a of approvals) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
      byType[a.type] = (byType[a.type] ?? 0) + 1
    }
    return { byStatus, byType, total: approvals.length }
  }

  // Pipeline / ticket analytics for Operations tab
  async getPipelineStats(tenantId: string) {
    const tickets = await this.prisma.activityTicket.findMany({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        priority: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        activityLog: true,
        assignedAgent: { select: { id: true, name: true, role: true } },
        metadata: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    // Status breakdown
    const byStatus: Record<string, number> = {}
    const byPriority: Record<string, number> = {}
    const byAgent: Record<string, { name: string; role: string; open: number; completed: number; escalated: number }> = {}

    // Tickets created per day (last 14)
    const byDay: Record<string, { created: number; completed: number }> = {}
    for (let i = 0; i < 14; i++) {
      const key = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)
      byDay[key] = { created: 0, completed: 0 }
    }

    // Action type breakdown from activity logs
    const actionCounts: Record<string, number> = {}
    let totalActivityEntries = 0
    let crmImported = 0
    let pipelineAdvanced = 0
    let stormLeads = 0
    let agentWakes = 0

    for (const t of tickets) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1

      const dayKey = t.createdAt.toISOString().slice(0, 10)
      if (byDay[dayKey]) {
        byDay[dayKey].created++
        if (t.status === 'COMPLETED') byDay[dayKey].completed++
      }

      if (t.assignedAgent) {
        const a = t.assignedAgent
        if (!byAgent[a.id]) byAgent[a.id] = { name: a.name, role: a.role, open: 0, completed: 0, escalated: 0 }
        if (['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT', 'SCHEDULED'].includes(t.status)) byAgent[a.id].open++
        if (t.status === 'COMPLETED') byAgent[a.id].completed++
        if (t.status === 'ESCALATED') byAgent[a.id].escalated++
      }

      // Count CRM-sourced tickets by metadata (one per ticket, no double-counting)
      const meta = t.metadata as any
      if (meta?.crmLeadId) crmImported++

      const log = Array.isArray(t.activityLog) ? t.activityLog as any[] : []
      totalActivityEntries += log.length
      for (const entry of log) {
        const action: string = entry.action ?? ''
        actionCounts[action] = (actionCounts[action] ?? 0) + 1
        if (action === 'PIPELINE_ADVANCED') pipelineAdvanced++
        if (action === 'STORM_LEAD_CREATED' || action === 'STORM_ALERT_CREATED') stormLeads++
        if (action.startsWith('STATUS_CHANGED') && entry.agentId !== 'system') agentWakes++
      }
    }

    const active = tickets.filter(t => !['COMPLETED', 'CANCELLED'].includes(t.status))
    const completed = tickets.filter(t => t.status === 'COMPLETED')

    // Avg resolution time (hours) for completed tickets
    const resolvedTimes = completed
      .filter(t => t.resolvedAt)
      .map(t => (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600000)
    const avgResolutionHours = resolvedTimes.length
      ? Math.round(resolvedTimes.reduce((a, b) => a + b, 0) / resolvedTimes.length)
      : null

    const dailyChart = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: date.slice(5), ...v }))

    return {
      totals: {
        total: tickets.length,
        active: active.length,
        completed: completed.length,
        escalated: byStatus['ESCALATED'] ?? 0,
        crmImported,
        pipelineAdvanced,
        stormLeads,
        avgResolutionHours,
        totalActivityEntries,
      },
      byStatus,
      byPriority,
      byAgent: Object.values(byAgent).sort((a, b) => (b.open + b.completed) - (a.open + a.completed)),
      dailyChart,
      topActions: Object.entries(actionCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([action, count]) => ({ action, count })),
    }
  }

  // Flat activity feed across all tickets — most recent first
  async getActivityFeed(tenantId: string, limit = 100) {
    const tickets = await this.prisma.activityTicket.findMany({
      where: { tenantId },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        status: true,
        activityLog: true,
        assignedAgent: { select: { name: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    const feed: {
      ticketNumber: number
      ticketTitle: string
      ticketId: string
      agentName: string
      action: string
      note: string
      timestamp: string
      status: string
    }[] = []

    for (const t of tickets) {
      const log = Array.isArray(t.activityLog) ? (t.activityLog as any[]) : []
      for (const entry of log) {
        feed.push({
          ticketNumber: t.ticketNumber,
          ticketTitle: t.title,
          ticketId: t.id,
          agentName: entry.agentName ?? 'System',
          action: entry.action ?? '',
          note: entry.note ?? '',
          timestamp: entry.timestamp ?? t.id,
          status: t.status,
        })
      }
    }

    return feed
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit)
  }

  // Conversations per day
  async getConversationVolume(tenantId: string, days = 14) {
    const start = new Date(Date.now() - days * 864e5)
    const convos = await this.prisma.conversation.findMany({
      where: { tenantId, createdAt: { gte: start } },
      select: { createdAt: true },
    })
    const byDay: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const key = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)
      byDay[key] = 0
    }
    for (const c of convos) {
      const key = c.createdAt.toISOString().slice(0, 10)
      if (byDay[key] !== undefined) byDay[key]++
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }
}
