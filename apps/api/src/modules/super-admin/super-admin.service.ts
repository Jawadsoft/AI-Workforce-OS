import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { Industry, CRMProvider } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { INDUSTRY_CRM_DEFAULTS } from '../crm/crm.interface'
import * as bcrypt from 'bcryptjs'

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Platform stats ────────────────────────────────────────────────

  async getStats() {
    const [tenants, agents, conversations, users] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.agent.count(),
      this.prisma.conversation.count(),
      this.prisma.user.count(),
    ])
    return { tenants, agents, conversations, users }
  }

  // ── Tenant management ─────────────────────────────────────────────

  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { agents: true, conversations: true, users: true } },
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { id: true, name: true, email: true, isActive: true },
          take: 1,
        },
      },
    })

    return tenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      industry: t.industry,
      isActive: t.isActive,
      isApproved: t.isApproved,
      createdAt: t.createdAt,
      owner: t.users[0] ?? null,
      stats: {
        agents: t._count.agents,
        conversations: t._count.conversations,
        users: t._count.users,
      },
    }))
  }

  async listPendingTenants() {
    const tenants = await this.prisma.tenant.findMany({
      where: { isApproved: false },
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { id: true, name: true, email: true },
          take: 1,
        },
      },
    })

    return tenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      industry: t.industry,
      createdAt: t.createdAt,
      owner: t.users[0] ?? null,
    }))
  }

  async approveTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    await this.prisma.tenant.update({ where: { id }, data: { isApproved: true, isActive: true } })
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: true } })
    return { success: true, message: 'Tenant approved and activated' }
  }

  async rejectTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: false } })
    await this.prisma.tenant.delete({ where: { id } })
    return { success: true, message: 'Tenant rejected and removed' }
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } },
        agents: { select: { id: true, name: true, role: true, status: true } },
        _count: { select: { conversations: true, tasks: true } },
      },
    })
    if (!tenant) throw new NotFoundException('Tenant not found')
    return tenant
  }

  async suspendTenant(id: string) {
    await this.prisma.tenant.update({ where: { id }, data: { isActive: false } })
    // Deactivate all users of this tenant
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: false } })
    return { success: true, message: 'Tenant suspended' }
  }

  async activateTenant(id: string) {
    await this.prisma.tenant.update({ where: { id }, data: { isActive: true } })
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: true } })
    return { success: true, message: 'Tenant activated' }
  }

  async deleteTenant(id: string) {
    await this.prisma.tenant.delete({ where: { id } })
    return { success: true, message: 'Tenant deleted' }
  }

  async updateTenantConfig(id: string, data: {
    industry?: string
    crmProvider?: string
    crmName?: string
    crmBaseUrl?: string
    crmApiKey?: string
  }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant not found')

    // Update industry if provided
    if (data.industry) {
      const validIndustry = Object.values(Industry).includes(data.industry as Industry)
      await this.prisma.tenant.update({
        where: { id },
        data: { industry: validIndustry ? (data.industry as Industry) : undefined },
      })
    }

    // Create or update CRM connection if provider+apiKey provided
    if (data.crmProvider && data.crmApiKey) {
      const validProvider = Object.values(CRMProvider).includes(data.crmProvider as CRMProvider)
      if (!validProvider) throw new BadRequestException(`Invalid CRM provider: ${data.crmProvider}`)

      const existing = await this.prisma.cRMConnection.findFirst({
        where: { tenantId: id, provider: data.crmProvider as CRMProvider },
      })

      if (existing) {
        await this.prisma.cRMConnection.update({
          where: { id: existing.id },
          data: {
            name: data.crmName ?? existing.name,
            apiKey: data.crmApiKey,
            baseUrl: data.crmBaseUrl ?? existing.baseUrl,
            isActive: true,
          },
        })
      } else {
        await this.prisma.cRMConnection.create({
          data: {
            tenantId: id,
            provider: data.crmProvider as CRMProvider,
            name: data.crmName ?? `${data.crmProvider} (Admin Setup)`,
            apiKey: data.crmApiKey,
            baseUrl: data.crmBaseUrl,
            isActive: true,
          },
        })
      }
    }

    // Auto-apply industry CRM defaults to this tenant's agents
    if (data.industry) {
      await this.applyIndustryDefaults(id, data.industry)
    }

    return { success: true, message: 'Tenant config updated' }
  }

  private async applyIndustryDefaults(tenantId: string, industry: string) {
    const defaults = INDUSTRY_CRM_DEFAULTS[industry]
    if (!defaults) return

    const agents = await this.prisma.agent.findMany({ where: { tenantId, status: 'ACTIVE' } })
    const crmConn = await this.prisma.cRMConnection.findFirst({ where: { tenantId, isActive: true } })

    for (const agent of agents) {
      const currentTools: string[] = (agent.tools as string[]) ?? []
      const mergedTools = [...new Set([...currentTools, ...defaults.defaultTools])]
      await this.prisma.agent.update({ where: { id: agent.id }, data: { tools: mergedTools } })

      if (crmConn) {
        const rolePerms = defaults.agentRoleDefaults[agent.role]
        if (rolePerms) {
          await this.prisma.agentCRMAccess.upsert({
            where: { agentId_connectionId: { agentId: agent.id, connectionId: crmConn.id } },
            update: { permissions: rolePerms },
            create: { agentId: agent.id, connectionId: crmConn.id, permissions: rolePerms },
          })
        }
      }
    }
  }

  // ── Agent template management (marketplace) ───────────────────────

  async listTemplates() {
    return this.prisma.agentTemplate.findMany({
      orderBy: { name: 'asc' },
    })
  }

  async createTemplate(data: {
    name: string
    role: string
    description: string
    industries: string[]
    defaultPrompt: string
    tools: string[]
    avatar?: string
    isPublic?: boolean
  }) {
    return this.prisma.agentTemplate.create({
      data: {
        ...data,
        industries: data.industries.filter(i => Object.values(Industry).includes(i as Industry)) as Industry[],
        isPublic: data.isPublic ?? false,
      },
    })
  }

  async updateTemplate(id: string, data: {
    name?: string
    role?: string
    description?: string
    industries?: string[]
    defaultPrompt?: string
    tools?: string[]
    avatar?: string
    isPublic?: boolean
  }) {
    const { industries, ...rest } = data
    return this.prisma.agentTemplate.update({
      where: { id },
      data: {
        ...rest,
        ...(industries !== undefined && {
          industries: industries.filter(i => Object.values(Industry).includes(i as Industry)) as Industry[],
        }),
      },
    })
  }

  async toggleTemplateVisibility(id: string) {
    const template = await this.prisma.agentTemplate.findUnique({ where: { id } })
    if (!template) throw new NotFoundException('Template not found')
    return this.prisma.agentTemplate.update({
      where: { id },
      data: { isPublic: !template.isPublic },
    })
  }

  async deleteTemplate(id: string) {
    await this.prisma.agentTemplate.delete({ where: { id } })
    return { success: true }
  }

  // ── Create super admin user ───────────────────────────────────────

  async createSuperAdmin(data: { email: string; password: string; name: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new BadRequestException('Email already exists')

    // Super admin users don't belong to a tenant — create a platform tenant
    let platformTenant = await this.prisma.tenant.findFirst({ where: { slug: 'platform-admin' } })
    if (!platformTenant) {
      platformTenant = await this.prisma.tenant.create({
        data: { name: 'Platform Admin', slug: 'platform-admin' },
      })
    }

    const hashed = await bcrypt.hash(data.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role: 'SUPER_ADMIN',
        tenantId: platformTenant.id,
      },
    })

    return { id: user.id, email: user.email, name: user.name, role: user.role }
  }
}
