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

  create(tenantId: string, data: {
    title: string
    description?: string
    priority?: string
    agentId?: string
    dueDate?: Date
    metadata?: any
  }) {
    return this.prisma.task.create({
      data: {
        tenantId,
        title: data.title,
        description: data.description,
        priority: (data.priority ?? 'MEDIUM') as any,
        agentId: data.agentId,
        dueDate: data.dueDate,
        metadata: data.metadata ?? {},
        status: 'PENDING',
      },
    })
  }

  update(tenantId: string, id: string, data: { status?: string; description?: string }) {
    return this.prisma.task.updateMany({
      where: { id, tenantId },
      data: data as any,
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.task.updateMany({
      where: { id, tenantId },
      data: { status: 'FAILED' },
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
