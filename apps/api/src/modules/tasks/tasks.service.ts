import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

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
}
