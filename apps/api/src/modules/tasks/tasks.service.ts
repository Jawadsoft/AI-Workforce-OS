import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CrmService } from '../crm/crm.service'

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
  ) {}

  findAll(tenantId: string, filters?: { status?: string; agentId?: string; limit?: number }) {
    const statusFilter = filters?.status
      ? { status: { in: filters.status.split(',') as any[] } }
      : {}
    return this.prisma.task.findMany({
      where: {
        tenantId,
        ...(filters?.agentId ? { agentId: filters.agentId } : {}),
        ...statusFilter,
      },
      include: { agent: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
    })
  }

  async findOne(tenantId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, tenantId },
      include: { agent: true },
    })
    if (!task) throw new NotFoundException('Task not found')
    return task
  }

  async create(tenantId: string, data: {
    title: string
    description?: string
    priority?: string
    agentId?: string
    dueDate?: Date
    metadata?: any
  }) {
    const meta = data.metadata ?? {}

    // Prevent duplicate recurring automated tasks — if an active task with the
    // same automatedAction and recipientEmail already exists, update it in-place
    // rather than stacking a second one that would fire duplicate emails.
    if (meta.automatedAction && meta.automatedAction !== 'none' && meta.recipientEmail) {
      const existing = await this.prisma.task.findFirst({
        where: {
          tenantId,
          status: 'PENDING',
          metadata: { path: ['automatedAction'], equals: meta.automatedAction },
        },
      })
      if (existing) {
        const existingMeta = (existing.metadata as Record<string, any>) ?? {}
        if (existingMeta.recipientEmail === meta.recipientEmail) {
          return this.prisma.task.update({
            where: { id: existing.id },
            data: {
              title: data.title,
              description: data.description ?? existing.description,
              priority: (data.priority ?? existing.priority) as any,
              dueDate: data.dueDate ?? existing.dueDate,
              metadata: { ...existingMeta, ...meta },
            },
          })
        }
      }
    }

    return this.prisma.task.create({
      data: {
        tenantId,
        title: data.title,
        description: data.description,
        priority: (data.priority ?? 'MEDIUM') as any,
        agentId: data.agentId,
        dueDate: data.dueDate,
        metadata: meta,
        status: 'PENDING',
      },
    })
  }

  async update(tenantId: string, id: string, data: {
    status?: string
    title?: string
    description?: string
    priority?: string
    recipientEmail?: string
    timeOfDay?: string
    timezone?: string
    reportFilters?: Record<string, any>
  }) {
    const { recipientEmail, timeOfDay, timezone, reportFilters, title, description, priority, status } = data

    const hasMetaChanges = recipientEmail !== undefined || timeOfDay !== undefined || timezone !== undefined || reportFilters !== undefined
    if (!hasMetaChanges) {
      return this.prisma.task.updateMany({
        where: { id, tenantId },
        data: { status, title, description, priority } as any,
      })
    }

    // Metadata update — merge new values and recompute dueDate if schedule changed
    const task = await this.prisma.task.findFirst({ where: { id, tenantId } })
    if (!task) throw new NotFoundException('Task not found')

    const existingMeta = (task.metadata as Record<string, any>) ?? {}
    const newTimeOfDay  = timeOfDay  ?? existingMeta.timeOfDay
    const newTimezone   = timezone   ?? existingMeta.timezone
    const newMeta: Record<string, any> = {
      ...existingMeta,
      ...(recipientEmail !== undefined && { recipientEmail }),
      ...(timeOfDay      !== undefined && { timeOfDay }),
      ...(timezone       !== undefined && { timezone }),
      ...(reportFilters  !== undefined && { reportFilters }),
    }

    // If the schedule time changed and task is still active, recompute next run
    const scheduleChanged = (timeOfDay !== undefined || timezone !== undefined)
    let newDueDate: Date | undefined
    if (scheduleChanged && task.status === 'PENDING' && !existingMeta.paused) {
      const { computeNextOccurrence, DEFAULT_US_TIMEZONE } = await import('../../common/utils/schedule-time.util')
      newDueDate = computeNextOccurrence(newTimeOfDay, newTimezone ?? DEFAULT_US_TIMEZONE, new Date())
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        ...(status      !== undefined && { status: status as any }),
        ...(title       !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(priority    !== undefined && { priority: priority as any }),
        ...(newDueDate  !== undefined && { dueDate: newDueDate }),
        metadata: newMeta,
      },
    })
  }

  async pause(tenantId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, tenantId } })
    if (!task) throw new NotFoundException('Task not found')
    const meta = (task.metadata as Record<string, any>) ?? {}
    return this.prisma.task.update({
      where: { id },
      data: {
        // Push dueDate far into the future so the scheduler never picks it up
        dueDate: new Date('2099-01-01T00:00:00.000Z'),
        metadata: { ...meta, paused: true, pausedAt: new Date().toISOString() },
      },
    })
  }

  async resume(tenantId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, tenantId } })
    if (!task) throw new NotFoundException('Task not found')
    const meta = (task.metadata as Record<string, any>) ?? {}
    const { computeNextOccurrence, DEFAULT_US_TIMEZONE } = await import('../../common/utils/schedule-time.util')
    const nextDue = computeNextOccurrence(meta.timeOfDay, meta.timezone ?? DEFAULT_US_TIMEZONE, new Date())
    return this.prisma.task.update({
      where: { id },
      data: {
        status: 'PENDING',
        dueDate: nextDue,
        metadata: { ...meta, paused: false, pausedAt: null },
      },
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.task.updateMany({
      where: { id, tenantId },
      data: { status: 'CANCELLED' },
    })
  }

  async pushToCRM(tenantId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, tenantId } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.pushedToCRM) throw new BadRequestException('Task already pushed to CRM')

    // find active CRM connection
    const connection = await this.prisma.cRMConnection.findFirst({
      where: { tenantId, isActive: true },
    })
    if (!connection) throw new BadRequestException('No active CRM connection found')

    let crmTaskId: string | null = null

    try {
      const result = await this.crm.createCRMTask(tenantId, {
        title: task.title,
        description: task.description ?? '',
      })
      crmTaskId = (result as any)?.id ?? null
    } catch (err: any) {
      throw new BadRequestException(`CRM push failed: ${err.message}`)
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        pushedToCRM: true,
        pushedToCRMAt: new Date(),
        crmTaskId: crmTaskId ?? undefined,
        crmProvider: connection.provider,
      },
    })
  }
}
