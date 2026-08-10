import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { Industry, CRMProvider } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { INDUSTRY_CRM_DEFAULTS } from '../crm/crm.interface'
import * as bcrypt from 'bcryptjs'

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Platform stats ────────────────────────────────────────────────

  async getStats(allowedTenantIds: string[] | null = null) {
    const tenantFilter = allowedTenantIds ? { id: { in: allowedTenantIds } } : {}

    const [tenants, agents, conversations, users] = await Promise.all([
      this.prisma.tenant.count({ where: tenantFilter }),
      this.prisma.agent.count({ where: allowedTenantIds ? { tenantId: { in: allowedTenantIds } } : {} }),
      this.prisma.conversation.count({ where: allowedTenantIds ? { tenantId: { in: allowedTenantIds } } : {} }),
      this.prisma.user.count({ where: allowedTenantIds ? { tenantId: { in: allowedTenantIds } } : {} }),
    ])
    return { tenants, agents, conversations, users }
  }

  // ── Tenant management ─────────────────────────────────────────────

  async listTenants(allowedTenantIds: string[] | null = null) {
    const where = allowedTenantIds ? { id: { in: allowedTenantIds } } : {}
    
    const tenants = await this.prisma.tenant.findMany({
      where,
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

    return tenants
      .filter((t) => {
        if (t.slug === 'platform-admin') return false
        const settings = (t.settings as Record<string, unknown>) || {}
        return settings.isScopedAdminTemplate !== true
      })
      .map(t => ({
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

  async listPendingTenants(allowedTenantIds: string[] | null = null) {
    const where: any = { isApproved: false }
    if (allowedTenantIds) where.id = { in: allowedTenantIds }

    const tenants = await this.prisma.tenant.findMany({
      where,
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

  async approveTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    await this.prisma.tenant.update({ where: { id }, data: { isApproved: true, isActive: true } })
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: true } })
    return { success: true, message: 'Tenant approved and activated' }
  }

  async rejectTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: false } })
    await this.prisma.tenant.delete({ where: { id } })
    return { success: true, message: 'Tenant rejected and removed' }
  }

  async getTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
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

  async suspendTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
    await this.prisma.tenant.update({ where: { id }, data: { isActive: false } })
    // Deactivate all users of this tenant
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: false } })
    return { success: true, message: 'Tenant suspended' }
  }

  async activateTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
    await this.prisma.tenant.update({ where: { id }, data: { isActive: true } })
    await this.prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: true } })
    return { success: true, message: 'Tenant activated' }
  }

  async deleteTenant(id: string, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
    await this.prisma.tenant.delete({ where: { id } })
    return { success: true, message: 'Tenant deleted' }
  }

  async updateTenantConfig(id: string, data: {
    industry?: string
    crmProvider?: string
    crmName?: string
    crmBaseUrl?: string
    crmApiKey?: string
  }, allowedTenantIds: string[] | null = null) {
    this.checkTenantAccess(id, allowedTenantIds)
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
        data: { name: 'Platform Admin', slug: 'platform-admin', isApproved: true, isActive: true },
      })
    } else if (!platformTenant.isApproved || !platformTenant.isActive) {
      platformTenant = await this.prisma.tenant.update({
        where: { id: platformTenant.id },
        data: { isApproved: true, isActive: true },
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

  // ── Scoped Admin Management ───────────────────────────────────────

  async createScopedAdmin(data: { 
    email: string
    password: string
    name: string
    createdByAdminId: string
    maxTenants?: number
    permissions?: string[]
  }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new BadRequestException('Email already exists')

    const emailSlug = data.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'admin'
    const templateTenant = await this.prisma.tenant.create({
      data: {
        name: `${data.name} — Default Workspace`,
        slug: `scoped-${emailSlug}-${Date.now()}`,
        isApproved: true,
        isActive: true,
        settings: { isScopedAdminTemplate: true },
      },
    })

    const hashed = await bcrypt.hash(data.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role: 'SCOPED_ADMIN',
        tenantId: templateTenant.id,
        createdByAdminId: data.createdByAdminId,
        maxTenants: data.maxTenants ?? 5,
        permissions: data.permissions ?? [],
      },
    })

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      maxTenants: user.maxTenants,
      permissions: user.permissions,
      templateTenantId: templateTenant.id,
    }
  }

  async updateScopedAdminLimits(adminId: string, data: { maxTenants?: number; permissions?: string[] }) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } })
    if (!admin || admin.role !== 'SCOPED_ADMIN') {
      throw new NotFoundException('Scoped admin not found')
    }

    const updated = await this.prisma.user.update({
      where: { id: adminId },
      data: {
        ...(data.maxTenants !== undefined && { maxTenants: data.maxTenants }),
        ...(data.permissions !== undefined && { permissions: data.permissions }),
      },
    })

    return { id: updated.id, maxTenants: updated.maxTenants, permissions: updated.permissions }
  }

  async listSubAdmins(rootAdminId: string) {
    try {
      const subAdmins = await this.prisma.user.findMany({
        where: { createdByAdminId: rootAdminId, role: 'SCOPED_ADMIN' },
        orderBy: { createdAt: 'desc' },
        include: {
          tenant: { select: { id: true, name: true, slug: true, settings: true } },
          managedTenants: {
            include: {
              tenant: { select: { id: true, name: true, slug: true, isActive: true } },
            },
          },
        },
      })

      return Promise.all(subAdmins.map(async (admin) => {
        const settings = (admin.tenant?.settings as Record<string, unknown>) || {}
        const isTemplate = settings.isScopedAdminTemplate === true
        const templateTenantId = isTemplate ? admin.tenantId : null
        let sharedDefaultCount = 0
        if (templateTenantId) {
          const agents = await this.prisma.agent.findMany({
            where: { tenantId: templateTenantId, status: 'ACTIVE' },
            select: { id: true },
          })
          sharedDefaultCount = this.filterSharedAgentIds(settings, agents.map((a) => a.id)).length
        }

        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          isActive: admin.isActive,
          createdAt: admin.createdAt,
          maxTenants: admin.maxTenants,
          templateTenantId,
          sharedDefaultCount,
          managedTenantsCount: admin.managedTenants.length,
          managedTenants: admin.managedTenants.map(mt => mt.tenant),
        }
      }))
    } catch (err) {
      // If table doesn't exist yet (migration not run), return empty array
      console.warn('[SuperAdminService] Could not fetch sub-admins (migration needed?):', err.message)
      return []
    }
  }

  async assignTenant(adminUserId: string, tenantId: string, assignedBy: string) {
    // Check if assignment already exists
    const existing = await this.prisma.superAdminTenantAccess.findUnique({
      where: { adminUserId_tenantId: { adminUserId, tenantId } },
    })
    if (existing) throw new BadRequestException('Tenant already assigned to this admin')

    await this.prisma.superAdminTenantAccess.create({
      data: { adminUserId, tenantId, assignedBy },
    })

    const clonedAgents = await this.ensureScopedDefaultsForTenant(tenantId)

    return {
      success: true,
      message: 'Tenant assigned to scoped admin',
      clonedAgents,
    }
  }

  /**
   * Push shared default agents from a scoped admin's template workspace
   * onto all currently assigned child tenants (idempotent).
   */
  async pushDefaultsToAssignedTenants(
    requester: { id: string; role: string },
    adminId?: string,
  ) {
    const targetAdminId =
      requester.role === 'SCOPED_ADMIN' ? requester.id : adminId

    if (!targetAdminId) {
      throw new BadRequestException('adminId is required')
    }

    if (requester.role === 'SCOPED_ADMIN' && adminId && adminId !== requester.id) {
      throw new BadRequestException('Scoped admins can only push their own defaults')
    }

    if (requester.role === 'SUPER_ADMIN') {
      const admin = await this.prisma.user.findUnique({ where: { id: targetAdminId } })
      if (!admin || admin.role !== 'SCOPED_ADMIN') {
        throw new NotFoundException('Scoped admin not found')
      }
      if (admin.createdByAdminId !== requester.id) {
        throw new BadRequestException('You can only manage scoped admins you created')
      }
    }

    const templateTenantId = await this.ensureTemplateWorkspace(targetAdminId)
    const assignments = await this.prisma.superAdminTenantAccess.findMany({
      where: { adminUserId: targetAdminId },
      include: { tenant: { select: { id: true, name: true, industry: true } } },
    })

    const results: { tenantId: string; tenantName: string; clonedAgents: number }[] = []
    for (const row of assignments) {
      const clonedAgents = await this.cloneSharedDefaultAgents(
        templateTenantId,
        row.tenantId,
        row.tenant.industry ?? undefined,
      )
      results.push({
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        clonedAgents,
      })
    }

    const totalCloned = results.reduce((sum, r) => sum + r.clonedAgents, 0)
    return {
      success: true,
      tenantsUpdated: results.length,
      totalCloned,
      results,
      message: `Pushed defaults to ${results.length} tenant(s); ${totalCloned} agent(s) created`,
    }
  }

  /**
   * If this tenant is managed by a scoped admin, ensure shared default agents exist.
   * Safe to call on every SSO login (skips agents that already exist).
   */
  async ensureScopedDefaultsForTenant(tenantId: string): Promise<number> {
    const assignment = await this.prisma.superAdminTenantAccess.findFirst({
      where: { tenantId },
      include: { admin: { select: { id: true, role: true } } },
    })
    if (!assignment || assignment.admin.role !== 'SCOPED_ADMIN') return 0

    const templateTenantId = await this.ensureTemplateWorkspace(assignment.adminUserId)
    const target = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { industry: true },
    })
    return this.cloneSharedDefaultAgents(
      templateTenantId,
      tenantId,
      target?.industry ?? undefined,
    )
  }

  async revokeTenant(adminUserId: string, tenantId: string) {
    await this.prisma.superAdminTenantAccess.deleteMany({
      where: { adminUserId, tenantId },
    })
    return { success: true, message: 'Tenant access revoked from scoped admin' }
  }

  async deleteScopedAdmin(id: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, settings: true } } },
    })
    if (!admin || admin.role !== 'SCOPED_ADMIN') {
      throw new NotFoundException('Scoped admin not found')
    }

    const settings = (admin.tenant?.settings as Record<string, unknown>) || {}
    const templateTenantId =
      settings.isScopedAdminTemplate === true ? admin.tenantId : null

    // Move off template tenant before deleting it (if applicable)
    if (templateTenantId) {
      let platformTenant = await this.prisma.tenant.findFirst({ where: { slug: 'platform-admin' } })
      if (!platformTenant) {
        platformTenant = await this.prisma.tenant.create({
          data: { name: 'Platform Admin', slug: 'platform-admin', isApproved: true, isActive: true },
        })
      }
      await this.prisma.user.update({
        where: { id },
        data: { tenantId: platformTenant.id },
      })
    }

    await this.prisma.user.delete({ where: { id } })

    if (templateTenantId) {
      await this.prisma.tenant.delete({ where: { id: templateTenantId } }).catch(() => {})
    }

    return { success: true, message: 'Scoped admin deleted' }
  }

  /** Ensure scoped admin has a dedicated template workspace tenant (backfill older accounts). */
  async ensureTemplateWorkspace(adminId: string): Promise<string> {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { tenant: true },
    })
    if (!admin || admin.role !== 'SCOPED_ADMIN') {
      throw new NotFoundException('Scoped admin not found')
    }

    const settings = (admin.tenant?.settings as Record<string, unknown>) || {}
    if (settings.isScopedAdminTemplate === true) {
      return admin.tenantId
    }

    const emailSlug = admin.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'admin'
    const templateTenant = await this.prisma.tenant.create({
      data: {
        name: `${admin.name} — Default Workspace`,
        slug: `scoped-${emailSlug}-${Date.now()}`,
        isApproved: true,
        isActive: true,
        settings: { isScopedAdminTemplate: true },
      },
    })

    await this.prisma.user.update({
      where: { id: adminId },
      data: { tenantId: templateTenant.id },
    })

    return templateTenant.id
  }

  /**
   * Create default workspace if missing. Optionally clear all template agents (full reset).
   */
  async resetTemplateWorkspace(
    requester: { id: string; role: string },
    options: { adminId?: string; clearAgents?: boolean } = {},
  ) {
    const targetAdminId =
      requester.role === 'SCOPED_ADMIN' ? requester.id : options.adminId

    if (!targetAdminId) {
      throw new BadRequestException('adminId is required')
    }

    if (requester.role === 'SCOPED_ADMIN' && options.adminId && options.adminId !== requester.id) {
      throw new BadRequestException('Scoped admins can only reset their own default workspace')
    }

    if (requester.role === 'SUPER_ADMIN') {
      const admin = await this.prisma.user.findUnique({ where: { id: targetAdminId } })
      if (!admin || admin.role !== 'SCOPED_ADMIN') {
        throw new NotFoundException('Scoped admin not found')
      }
      if (admin.createdByAdminId !== requester.id) {
        throw new BadRequestException('You can only manage scoped admins you created')
      }
    }

    const before = await this.prisma.user.findUnique({
      where: { id: targetAdminId },
      include: { tenant: { select: { settings: true } } },
    })
    const hadWorkspace =
      ((before?.tenant?.settings as Record<string, unknown>) || {}).isScopedAdminTemplate === true

    const templateTenantId = await this.ensureTemplateWorkspace(targetAdminId)

    let clearedAgents = 0
    if (options.clearAgents) {
      const result = await this.prisma.agent.deleteMany({ where: { tenantId: templateTenantId } })
      clearedAgents = result.count
      const tenant = await this.prisma.tenant.findUnique({ where: { id: templateTenantId } })
      const settings = { ...((tenant?.settings as Record<string, unknown>) || {}) }
      settings.sharedDefaultAgentIds = []
      await this.prisma.tenant.update({
        where: { id: templateTenantId },
        data: { settings },
      })
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: templateTenantId } })
    const settings = (tenant?.settings as Record<string, unknown>) || {}
    const agents = await this.prisma.agent.findMany({
      where: { tenantId: templateTenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    const sharedDefaultCount = this.filterSharedAgentIds(settings, agents.map((a) => a.id)).length

    return {
      success: true,
      created: !hadWorkspace,
      templateTenantId,
      clearedAgents,
      sharedDefaultCount,
      message: !hadWorkspace
        ? 'Default workspace created'
        : options.clearAgents
          ? 'Default workspace reset (agents cleared)'
          : 'Default workspace already set',
    }
  }

  /** null sharedDefaultAgentIds = all agents shared; otherwise only listed IDs. */
  private filterSharedAgentIds(settings: Record<string, unknown>, agentIds: string[]): string[] {
    if (!Array.isArray(settings.sharedDefaultAgentIds)) return agentIds
    const allowed = new Set(settings.sharedDefaultAgentIds as string[])
    return agentIds.filter((id) => allowed.has(id))
  }

  private async setAgentSharedDefault(tenantId: string, agentId: string, shared: boolean) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Template workspace not found')

    const settings = { ...((tenant.settings as Record<string, unknown>) || {}) }
    const allAgents = await this.prisma.agent.findMany({
      where: { tenantId },
      select: { id: true },
    })
    let sharedIds = Array.isArray(settings.sharedDefaultAgentIds)
      ? [...(settings.sharedDefaultAgentIds as string[])]
      : allAgents.map((a) => a.id)

    if (shared) {
      if (!sharedIds.includes(agentId)) sharedIds.push(agentId)
    } else {
      sharedIds = sharedIds.filter((id) => id !== agentId)
    }

    settings.sharedDefaultAgentIds = sharedIds
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings },
    })
  }

  private async resolveTemplateTenantId(requester: { id: string; role: string }, adminId?: string): Promise<string> {
    if (requester.role === 'SCOPED_ADMIN') {
      if (adminId && adminId !== requester.id) {
        throw new BadRequestException('Scoped admins can only manage their own default workspace')
      }
      return this.ensureTemplateWorkspace(requester.id)
    }

    if (!adminId) {
      throw new BadRequestException('adminId is required')
    }
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } })
    if (!admin || admin.role !== 'SCOPED_ADMIN') {
      throw new NotFoundException('Scoped admin not found')
    }
    if (admin.createdByAdminId !== requester.id) {
      throw new BadRequestException('You can only manage scoped admins you created')
    }
    return this.ensureTemplateWorkspace(adminId)
  }

  async listTemplateWorkspaceAgents(requester: { id: string; role: string }, adminId?: string) {
    const tenantId = await this.resolveTemplateTenantId(requester, adminId)
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const settings = (tenant?.settings as Record<string, unknown>) || {}
    const agents = await this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    })
    const sharedIds = new Set(this.filterSharedAgentIds(settings, agents.map((a) => a.id)))
    return {
      templateTenantId: tenantId,
      agents: agents.map((a) => ({
        ...a,
        isSharedDefault: sharedIds.has(a.id),
      })),
    }
  }

  async createTemplateWorkspaceAgent(
    requester: { id: string; role: string },
    data: {
      adminId?: string
      name: string
      role: string
      industry?: string
      prompt: string
      tools?: string[]
      permissions?: string[]
      isSharedDefault?: boolean
    },
  ) {
    const tenantId = await this.resolveTemplateTenantId(requester, data.adminId)
    const industry = (data.industry && Object.values(Industry).includes(data.industry as Industry)
      ? data.industry
      : 'OTHER') as Industry

    const agent = await this.prisma.agent.create({
      data: {
        tenantId,
        name: data.name,
        role: data.role,
        industry,
        prompt: data.prompt,
        tools: data.tools ?? ['create_task', 'crm_update', 'send_email'],
        permissions: data.permissions ?? ['read_conversations', 'create_tasks'],
        approvalRules: { requireApprovalFor: ['crm_update', 'send_email'] },
        status: 'ACTIVE',
      },
    })

    await this.setAgentSharedDefault(tenantId, agent.id, data.isSharedDefault ?? true)
    return { ...agent, isSharedDefault: data.isSharedDefault ?? true }
  }

  async installTemplateToWorkspace(
    requester: { id: string; role: string },
    data: { adminId?: string; templateId: string; isSharedDefault?: boolean },
  ) {
    const tenantId = await this.resolveTemplateTenantId(requester, data.adminId)
    const template = await this.prisma.agentTemplate.findUnique({ where: { id: data.templateId } })
    if (!template) throw new NotFoundException('Template not found')

    const existing = await this.prisma.agent.findFirst({
      where: { tenantId, templateId: template.id },
    })
    if (existing) {
      await this.prisma.agent.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' },
      })
      if (data.isSharedDefault !== undefined) {
        await this.setAgentSharedDefault(tenantId, existing.id, data.isSharedDefault)
      }
      return { ...existing, status: 'ACTIVE', isSharedDefault: data.isSharedDefault ?? true }
    }

    const agent = await this.prisma.agent.create({
      data: {
        tenantId,
        name: template.name,
        role: template.role,
        industry: (template.industries[0] ?? 'OTHER') as Industry,
        prompt: template.defaultPrompt,
        tools: template.tools,
        avatar: template.avatar,
        status: 'ACTIVE',
        permissions: ['read_conversations', 'create_tasks'],
        approvalRules: { requireApprovalFor: ['crm_update', 'send_email'] },
        templateId: template.id,
      },
    })

    await this.setAgentSharedDefault(tenantId, agent.id, data.isSharedDefault ?? true)
    return { ...agent, isSharedDefault: data.isSharedDefault ?? true }
  }

  async updateTemplateWorkspaceAgent(
    requester: { id: string; role: string },
    agentId: string,
    data: {
      adminId?: string
      name?: string
      role?: string
      prompt?: string
      tools?: string[]
      status?: string
      isSharedDefault?: boolean
    },
  ) {
    const tenantId = await this.resolveTemplateTenantId(requester, data.adminId)
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found in template workspace')

    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.prompt !== undefined && { prompt: data.prompt }),
        ...(data.tools !== undefined && { tools: data.tools }),
        ...(data.status !== undefined && { status: data.status as any }),
      },
    })

    if (data.isSharedDefault !== undefined) {
      await this.setAgentSharedDefault(tenantId, agentId, data.isSharedDefault)
    }

    return { ...updated, isSharedDefault: data.isSharedDefault }
  }

  async deleteTemplateWorkspaceAgent(
    requester: { id: string; role: string },
    agentId: string,
    adminId?: string,
  ) {
    const tenantId = await this.resolveTemplateTenantId(requester, adminId)
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found in template workspace')
    await this.setAgentSharedDefault(tenantId, agentId, false)
    await this.prisma.agent.delete({ where: { id: agentId } })
    return { success: true }
  }

  /** Clone shared-default agents into a child tenant (skips duplicates by templateId or name+role). */
  private async cloneSharedDefaultAgents(
    sourceTenantId: string,
    targetTenantId: string,
    industry?: string | null,
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: sourceTenantId } })
    const settings = (tenant?.settings as Record<string, unknown>) || {}
    const allAgents = await this.prisma.agent.findMany({
      where: { tenantId: sourceTenantId, status: 'ACTIVE' },
    })
    const sharedIds = new Set(this.filterSharedAgentIds(settings, allAgents.map((a) => a.id)))
    const agents = allAgents.filter((a) => sharedIds.has(a.id))

    if (agents.length === 0) return 0

    const existing = await this.prisma.agent.findMany({
      where: { tenantId: targetTenantId },
      select: { name: true, role: true, templateId: true },
    })
    const existingKeys = new Set(
      existing.map((a) =>
        a.templateId ? `t:${a.templateId}` : `n:${a.name.toLowerCase()}|${a.role.toLowerCase()}`,
      ),
    )

    const targetIndustry = (industry && Object.values(Industry).includes(industry as Industry)
      ? industry
      : null) as Industry | null

    const toCreate = agents.filter((a) => {
      const key = a.templateId
        ? `t:${a.templateId}`
        : `n:${a.name.toLowerCase()}|${a.role.toLowerCase()}`
      return !existingKeys.has(key)
    })

    if (toCreate.length === 0) return 0

    await this.prisma.agent.createMany({
      data: toCreate.map((a) => ({
        tenantId: targetTenantId,
        name: a.name,
        role: a.role,
        industry: targetIndustry ?? a.industry,
        avatar: a.avatar,
        voiceId: a.voiceId,
        prompt: a.prompt,
        status: 'ACTIVE' as const,
        permissions: a.permissions,
        tools: a.tools,
        approvalRules: a.approvalRules as any,
        templateId: a.templateId,
      })),
    })

    return toCreate.length
  }

  /** Helper: check if a tenant ID is in the allowed list for a scoped admin (null allowedTenantIds = root, all allowed) */
  private checkTenantAccess(tenantId: string, allowedTenantIds: string[] | null): void {
    if (allowedTenantIds === null) return // Root admin — unrestricted
    if (!allowedTenantIds.includes(tenantId)) {
      throw new NotFoundException('Tenant not found or access denied')
    }
  }

  // ── Tenant Creation with Verification ─────────────────────────────

  async createTenantWithVerification(
    data: { name: string; slug: string; ownerName: string; ownerEmail: string; industry?: string },
    createdByAdminId: string,
    adminRole: string,
  ) {
    // Check if slug is already taken
    const existing = await this.prisma.tenant.findUnique({ where: { slug: data.slug } })
    if (existing) throw new BadRequestException('Slug already taken')

    // Check if email is already taken
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.ownerEmail } })
    if (existingUser) throw new BadRequestException('Email already registered')

    // Check tenant limit for scoped admins
    if (adminRole === 'SCOPED_ADMIN') {
      const admin = await this.prisma.user.findUnique({ where: { id: createdByAdminId }, select: { maxTenants: true } })
      const currentCount = await this.prisma.superAdminTenantAccess.count({ where: { adminUserId: createdByAdminId } })
      
      if (admin.maxTenants && currentCount >= admin.maxTenants) {
        throw new BadRequestException(`Tenant limit reached. You can only manage ${admin.maxTenants} tenants.`)
      }
    }

    // Create tenant (not approved yet)
    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        industry: data.industry as any,
        isApproved: false,
        isActive: false,
      },
    })

    // Generate verification token
    const crypto = require('crypto')
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Create owner user (inactive until verified)
    const hashedPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12) // Random temp password
    const owner = await this.prisma.user.create({
      data: {
        email: data.ownerEmail,
        name: data.ownerName,
        password: hashedPassword,
        role: 'TENANT_OWNER',
        tenantId: tenant.id,
        isActive: false,
      },
    })

    // Store verification token
    await this.prisma.passwordResetToken.create({
      data: {
        userId: owner.id,
        token: verificationToken,
        expiresAt: verificationExpiry,
      },
    })

    // If created by scoped admin, auto-assign the tenant to them and clone default agents
    let clonedAgents = 0
    if (adminRole === 'SCOPED_ADMIN') {
      await this.prisma.superAdminTenantAccess.create({
        data: {
          adminUserId: createdByAdminId,
          tenantId: tenant.id,
          assignedBy: createdByAdminId,
        },
      })

      const templateTenantId = await this.ensureTemplateWorkspace(createdByAdminId)
      clonedAgents = await this.cloneSharedDefaultAgents(
        templateTenantId,
        tenant.id,
        data.industry,
      )
    }

    // Return verification link (in production, send this via email)
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-account?token=${verificationToken}`

    return {
      success: true,
      message: 'Tenant created. Verification email sent to owner.',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      owner: { id: owner.id, email: owner.email, name: owner.name },
      clonedAgents,
      verificationLink, // Remove this in production, only send via email
    }
  }
}
