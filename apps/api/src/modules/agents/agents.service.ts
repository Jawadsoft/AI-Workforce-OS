import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import {
  buildMergedPrompt,
  mergeApprovalRules,
  mergePermissions,
  mergeTools,
  suggestMergedName,
  suggestMergedRole,
} from './agent-merge.util'
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
    voiceId: string
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

  async remove(tenantId: string, id: string) {
    const agent = await this.prisma.agent.findFirst({ where: { id, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')

    const mergePrimaryId = ((agent.approvalRules as Record<string, any>)?.mergeSource?.primaryAgentId as string | undefined) || null
    const preferred = mergePrimaryId && mergePrimaryId !== id
      ? await this.prisma.agent.findFirst({ where: { id: mergePrimaryId, tenantId } })
      : null
    const fallback =
      preferred ??
      (await this.prisma.agent.findFirst({
        where: { tenantId, id: { not: id }, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await this.prisma.agent.findFirst({
        where: { tenantId, id: { not: id } },
        orderBy: { createdAt: 'asc' },
      }))

    if (!fallback) {
      throw new BadRequestException('Cannot delete the last agent. Create another agent first, or set this one inactive.')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { tenantId, agentId: id },
        data: { agentId: fallback.id },
      })
      await tx.task.updateMany({
        where: { tenantId, agentId: id },
        data: { agentId: null },
      })
      await tx.approval.updateMany({
        where: { tenantId, agentId: id },
        data: { agentId: null },
      })

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      })
      const settings = { ...((tenant?.settings as Record<string, unknown>) ?? {}) }
      let settingsChanged = false
      for (const key of ['whatsappAgentId', 'smsAgentId', 'voiceAgentId'] as const) {
        if (settings[key] === id) {
          settings[key] = fallback.id
          settingsChanged = true
        }
      }
      if (settingsChanged) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { settings: settings as any },
        })
      }

      await tx.agent.delete({ where: { id } })
    })

    return { deleted: true, id, reassignedTo: fallback.id, reassignedName: fallback.name }
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

  /**
   * Create a new tenant agent by merging one primary + optional secondary agent.
   * Source agents are left unchanged (presets / installed copies stay intact).
   */
  async mergeAgents(
    tenantId: string,
    opts: {
      primaryAgentId: string
      secondaryAgentId?: string
      name?: string
      role?: string
      setAsWhatsappAgent?: boolean
      deactivateSources?: boolean
    },
  ) {
    const primary = await this.prisma.agent.findFirst({
      where: { id: opts.primaryAgentId, tenantId },
    })
    if (!primary) throw new NotFoundException('Primary agent not found')

    if (opts.secondaryAgentId && opts.secondaryAgentId === opts.primaryAgentId) {
      throw new BadRequestException('Primary and secondary agent must be different')
    }

    const secondary = opts.secondaryAgentId
      ? await this.prisma.agent.findFirst({
          where: { id: opts.secondaryAgentId, tenantId },
        })
      : null
    if (opts.secondaryAgentId && !secondary) {
      throw new NotFoundException('Secondary agent not found')
    }

    const mergeMeta = {
      primaryAgentId: primary.id,
      primaryName: primary.name,
      secondaryAgentId: secondary?.id ?? null,
      secondaryName: secondary?.name ?? null,
      mergedAt: new Date().toISOString(),
    }

    const name = opts.name?.trim() || suggestMergedName(primary as any, secondary as any)
    const role = opts.role?.trim() || suggestMergedRole(primary as any, secondary as any)
    const prompt = buildMergedPrompt(primary as any, secondary as any)
    const tools = mergeTools(primary as any, secondary as any)
    const permissions = mergePermissions(primary as any, secondary as any)
    const approvalRules = mergeApprovalRules(primary as any, secondary as any, mergeMeta)

    const created = await this.prisma.agent.create({
      data: {
        tenantId,
        name,
        role,
        industry: primary.industry,
        prompt,
        tools,
        permissions,
        approvalRules: approvalRules as any,
        avatar: primary.avatar,
        voiceId: primary.voiceId,
        status: 'ACTIVE',
      },
    })

    // Copy knowledge doc assignments (union)
    const sourceIds = [primary.id, ...(secondary ? [secondary.id] : [])]
    const knowledgeLinks = await this.prisma.agentKnowledge.findMany({
      where: { agentId: { in: sourceIds } },
      select: { documentId: true },
    })
    const docIds = [...new Set(knowledgeLinks.map((k) => k.documentId))]
    if (docIds.length) {
      await this.prisma.agentKnowledge.createMany({
        data: docIds.map((documentId) => ({ agentId: created.id, documentId })),
        skipDuplicates: true,
      })
    }

    // Merge CRM access per connection (union permissions)
    const crmRows = await this.prisma.agentCRMAccess.findMany({
      where: { agentId: { in: sourceIds } },
    })
    const byConn = new Map<string, Set<string>>()
    for (const row of crmRows) {
      const set = byConn.get(row.connectionId) ?? new Set<string>()
      for (const p of row.permissions) set.add(p)
      byConn.set(row.connectionId, set)
    }
    for (const [connectionId, perms] of byConn) {
      await this.prisma.agentCRMAccess.upsert({
        where: {
          agentId_connectionId: { agentId: created.id, connectionId },
        },
        create: {
          agentId: created.id,
          connectionId,
          permissions: [...perms],
        },
        update: {
          permissions: [...perms],
        },
      })
    }

    if (opts.deactivateSources) {
      const deactivateIds = secondary ? [secondary.id] : []
      // Only deactivate secondary by default pattern; primary stays unless both requested
      if (deactivateIds.length) {
        await this.prisma.agent.updateMany({
          where: { id: { in: deactivateIds }, tenantId },
          data: { status: 'INACTIVE' },
        })
      }
    }

    if (opts.setAsWhatsappAgent) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      })
      const settings = { ...((tenant?.settings as Record<string, unknown>) ?? {}) }
      settings.whatsappAgentId = created.id
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { settings: settings as any },
      })
    }

    return {
      ...created,
      mergeSource: mergeMeta,
      whatsappAgentSet: Boolean(opts.setAsWhatsappAgent),
    }
  }

  /** Rewrite prompts for existing merged agents using current merge rules (skills, not second identity). */
  async rebuildMergedPrompts(tenantId: string) {
    const agents = await this.prisma.agent.findMany({ where: { tenantId } })
    const updated: { id: string; name: string }[] = []

    for (const agent of agents) {
      const rules = (agent.approvalRules as Record<string, any>) || {}
      const src = rules.mergeSource
      if (!src?.primaryAgentId) continue

      const primary = await this.prisma.agent.findFirst({
        where: { id: src.primaryAgentId, tenantId },
      })
      if (!primary) continue

      const secondary = src.secondaryAgentId
        ? await this.prisma.agent.findFirst({
            where: { id: src.secondaryAgentId, tenantId },
          })
        : null

      const prompt = buildMergedPrompt(primary as any, secondary as any)
      await this.prisma.agent.update({
        where: { id: agent.id },
        data: { prompt },
      })
      updated.push({ id: agent.id, name: agent.name })
    }

    return { rebuilt: updated.length, agents: updated }
  }
}
