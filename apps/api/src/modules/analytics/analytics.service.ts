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
