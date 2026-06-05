import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  findAll(tenantId: string, statusFilter?: string) {
    const statuses = statusFilter ? statusFilter.split(',') : undefined
    return this.prisma.approval.findMany({
      where: {
        tenantId,
        ...(statuses ? { status: { in: statuses as any[] } } : {}),
      },
      include: { agent: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async approve(tenantId: string, id: string, approverId: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id, tenantId },
      include: { agent: { select: { name: true } } },
    })
    if (!approval) throw new NotFoundException('Approval not found')

    const updated = await this.prisma.approval.update({
      where: { id },
      data: { status: 'APPROVED', approverId, resolvedAt: new Date() },
    })

    // Notify tenant owner by email
    this.notifyApprovalResult(tenantId, approval.agent?.name || 'Agent', approval.title || approval.description || 'action', true)
      .catch((err) => this.logger.warn(`Approval email failed: ${err}`))

    return updated
  }

  async reject(tenantId: string, id: string, approverId: string, reason?: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id, tenantId },
      include: { agent: { select: { name: true } } },
    })
    if (!approval) throw new NotFoundException('Approval not found')

    const updated = await this.prisma.approval.update({
      where: { id },
      data: { status: 'REJECTED', approverId, rejectionReason: reason, resolvedAt: new Date() },
    })

    this.notifyApprovalResult(tenantId, approval.agent?.name || 'Agent', approval.title || approval.description || 'action', false, reason)
      .catch((err) => this.logger.warn(`Rejection email failed: ${err}`))

    return updated
  }

  async notifyNewApproval(tenantId: string, approvalId: string, agentName: string, action: string) {
    try {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'TENANT_OWNER' },
        select: { email: true, name: true },
      })
      if (!owner) return

      const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
      await this.email.sendApprovalRequired({
        tenantId,
        to: owner.email,
        ownerName: owner.name,
        agentName,
        action,
        approvalUrl: `${appUrl}/approvals/${approvalId}`,
      })
    } catch (err) {
      this.logger.warn(`New approval notification failed: ${err}`)
    }
  }

  getPendingCount(tenantId: string) {
    return this.prisma.approval.count({ where: { tenantId, status: 'PENDING' } })
  }

  private async notifyApprovalResult(tenantId: string, agentName: string, action: string, approved: boolean, reason?: string) {
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: 'TENANT_OWNER' },
      select: { email: true, name: true },
    })
    if (!owner) return
    await this.email.sendApprovalResult({
      tenantId,
      to: owner.email,
      agentName,
      action,
      approved,
      reason,
    })
  }
}
