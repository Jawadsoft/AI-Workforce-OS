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

    // Scoped admins belong to the same platform tenant as root admins
    let platformTenant = await this.prisma.tenant.findFirst({ where: { slug: 'platform-admin' } })
    if (!platformTenant) {
      platformTenant = await this.prisma.tenant.create({
        data: { name: 'Platform Admin', slug: 'platform-admin', isApproved: true, isActive: true },
      })
    }

    const hashed = await bcrypt.hash(data.password, 12)
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashed,
        role: 'SCOPED_ADMIN',
        tenantId: platformTenant.id,
        createdByAdminId: data.createdByAdminId,
        maxTenants: data.maxTenants ?? 5,
        permissions: data.permissions ?? [],
      },
    })

    return { id: user.id, email: user.email, name: user.name, role: user.role, maxTenants: user.maxTenants, permissions: user.permissions }
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
          managedTenants: {
            include: {
              tenant: { select: { id: true, name: true, slug: true, isActive: true } },
            },
          },
        },
      })

      return subAdmins.map(admin => ({
        id: admin.id,
        email: admin.email,
        name: admin.name,
        isActive: admin.isActive,
        createdAt: admin.createdAt,
        managedTenantsCount: admin.managedTenants.length,
        managedTenants: admin.managedTenants.map(mt => mt.tenant),
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

    return { success: true, message: 'Tenant assigned to scoped admin' }
  }

  async revokeTenant(adminUserId: string, tenantId: string) {
    await this.prisma.superAdminTenantAccess.deleteMany({
      where: { adminUserId, tenantId },
    })
    return { success: true, message: 'Tenant access revoked from scoped admin' }
  }

  async deleteScopedAdmin(id: string) {
    // Deleting a scoped admin will cascade-delete their tenant assignments (onDelete: Cascade)
    await this.prisma.user.delete({ where: { id } })
    return { success: true, message: 'Scoped admin deleted' }
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

    // If created by scoped admin, auto-assign the tenant to them
    if (adminRole === 'SCOPED_ADMIN') {
      await this.prisma.superAdminTenantAccess.create({
        data: {
          adminUserId: createdByAdminId,
          tenantId: tenant.id,
          assignedBy: createdByAdminId,
        },
      })
    }

    // Return verification link (in production, send this via email)
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-account?token=${verificationToken}`

    return {
      success: true,
      message: 'Tenant created. Verification email sent to owner.',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      owner: { id: owner.id, email: owner.email, name: owner.name },
      verificationLink, // Remove this in production, only send via email
    }
  }
}
