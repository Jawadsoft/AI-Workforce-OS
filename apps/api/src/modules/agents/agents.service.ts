import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import * as path from 'path'
import * as crypto from 'crypto'

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  findAll(tenantId: string) {
    return this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    return agent
  }

  create(tenantId: string, data: {
    name: string
    role: string
    industry: string
    prompt: string
    tools?: string[]
    permissions?: string[]
    avatar?: string
    approvalRules?: any
  }) {
    return this.prisma.agent.create({
      data: {
        tenantId,
        name: data.name,
        role: data.role,
        industry: data.industry as any,
        prompt: data.prompt,
        tools: [...new Set([...(data.tools ?? []), 'create_ticket', 'update_ticket', 'get_my_tickets'])],
        permissions: data.permissions ?? [],
        avatar: data.avatar,
        approvalRules: data.approvalRules ?? {},
        status: 'ACTIVE',
      },
    })
  }

  update(tenantId: string, id: string, data: Partial<{
    name: string
    role: string
    prompt: string
    tools: string[]
    permissions: string[]
    status: string
    avatar: string
    approvalRules: any
  }>) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: data as any,
    })
  }

  activate(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'ACTIVE' },
    })
  }

  deactivate(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'INACTIVE' },
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.agent.updateMany({
      where: { id, tenantId },
      data: { status: 'INACTIVE' },
    })
  }

  getTemplates() {
    return this.prisma.agentTemplate.findMany({
      where: { isPublic: true },
      orderBy: { name: 'asc' },
    })
  }

  async installTemplate(tenantId: string, templateId: string) {
    const [template, tenant] = await Promise.all([
      this.prisma.agentTemplate.findUnique({ where: { id: templateId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } }),
    ])
    if (!template) throw new NotFoundException('Template not found')

    // Return existing active agent if already installed — prevents duplicates
    const existing = await this.prisma.agent.findFirst({
      where: { tenantId, templateId },
    })
    if (existing) {
      // Re-activate if it was deactivated
      if (existing.status !== 'ACTIVE') {
        return this.prisma.agent.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        })
      }
      return existing
    }

    // Use the tenant's own industry so RAG, CRM defaults, and brain context
    // all align correctly — fall back to the template's first industry or OTHER
    const industry = (tenant?.industry ?? template.industries[0] ?? 'OTHER') as any

    return this.prisma.agent.create({
      data: {
        tenantId,
        name: template.name,
        role: template.role,
        industry,
        prompt: template.defaultPrompt,
        tools: template.tools,
        status: 'ACTIVE',
        permissions: ['read_conversations', 'create_tasks'],
        approvalRules: { requireApprovalFor: ['crm_update', 'send_email'] },
        templateId: template.id,
      },
    })
  }

  async uploadAvatar(tenantId: string, agentId: string, file: Express.Multer.File) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    if (!file) throw new BadRequestException('No file provided')

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
    const filename = `${agentId}-${crypto.randomBytes(6).toString('hex')}${ext}`
    const avatarUrl = await this.cloudinary.upload(tenantId, 'avatars', filename, file.buffer, file.mimetype, 'image')

    if (agent.avatar) await this.cloudinary.delete(agent.avatar)

    return this.prisma.agent.update({
      where: { id: agentId },
      data: { avatar: avatarUrl },
    })
  }

  async getCRMAccess(tenantId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')
    return this.prisma.agentCRMAccess.findMany({
      where: { agentId },
      include: { connection: { select: { id: true, name: true, provider: true, isActive: true } } },
    })
  }
}
