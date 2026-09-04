import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'

@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async provisionTenant(data: {
    companyName: string
    ownerName: string
    ownerEmail: string
    industry?: string
    externalTenantId?: string
    scopedAdminEmail?: string  // If provided, assigns tenant to this scoped admin and clones their default agents
  }) {
    // Check if user already exists (idempotent provisioning)
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.ownerEmail },
      include: { tenant: true },
    })

    if (existingUser) {
      // User already provisioned - return existing tenant info
      const tenant = existingUser.tenant

      // Optionally update externalTenantId if provided and different
      if (data.externalTenantId && tenant) {
        const currentSettings = (tenant.settings as any) || {}
        if (currentSettings.externalTenantId !== data.externalTenantId) {
          await this.prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              settings: {
                ...currentSettings,
                externalTenantId: data.externalTenantId,
              },
            },
          })
        }
      }

      return {
        success: true,
        alreadyProvisioned: true,
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
            }
          : null,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
        message: 'User already has an account. Use SSO to log in.',
      }
    }

    // Generate slug from company name
    const baseSlug = data.companyName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    const slug = `${baseSlug}-${Date.now()}`

    // Validate and convert industry to uppercase enum value
    const validIndustries = [
      'ROOFING', 'CAR_DEALERSHIP', 'CLEANING', 'SECURITY',
      'PROPERTY_MANAGEMENT', 'HEALTHCARE', 'CONSTRUCTION',
      'REAL_ESTATE', 'HVAC', 'LANDSCAPING', 'PEST_CONTROL',
      'INSURANCE', 'HUMAN_RESOURCES', 'OTHER'
    ]
    const industryValue = data.industry ? data.industry.toUpperCase() : 'OTHER'
    const industry = validIndustries.includes(industryValue) ? industryValue : 'OTHER'

    // Create tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.companyName,
        slug,
        industry,
        isApproved: true, // Auto-approve for external integrations
        settings: data.externalTenantId
          ? { externalTenantId: data.externalTenantId }
          : {},
      },
    })

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex')

    // Create temp password (user will set real password via verification email)
    const tempPassword = crypto.randomBytes(16).toString('hex')
    const hashedPassword = await bcrypt.hash(tempPassword, 12)

    // Create owner user (auto-activated for external integrations)
    const user = await this.prisma.user.create({
      data: {
        email: data.ownerEmail,
        name: data.ownerName,
        password: hashedPassword,
        role: 'TENANT_OWNER',
        tenantId: tenant.id,
        isActive: true, // Auto-activate for trusted external integrations (enables SSO)
      },
    })

    // Store verification token
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    })

    // Send welcome email with verification link
    // Note: Account is already active for SSO, but verification link allows
    // users to set a password for direct login (optional)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const verificationUrl = `${frontendUrl}/verify-account?token=${verificationToken}`

    await this.email.sendWelcome({
      to: data.ownerEmail,
      name: data.ownerName,
      verificationUrl,
    })

    // If scopedAdminEmail provided, assign the new tenant to that scoped admin
    // and clone their default workspace agents into it
    let clonedAgents = 0
    let scopedAdminAssigned: string | null = null

    if (data.scopedAdminEmail) {
      const scopedAdmin = await this.prisma.user.findUnique({
        where: { email: data.scopedAdminEmail },
        select: { id: true, role: true, isActive: true, tenantId: true },
      })

      if (scopedAdmin && scopedAdmin.role === 'SCOPED_ADMIN' && scopedAdmin.isActive) {
        // Assign tenant to scoped admin
        await this.prisma.superAdminTenantAccess.upsert({
          where: {
            adminUserId_tenantId: { adminUserId: scopedAdmin.id, tenantId: tenant.id },
          },
          create: { adminUserId: scopedAdmin.id, tenantId: tenant.id, assignedBy: scopedAdmin.id },
          update: {},
        })

        // Find scoped admin's template workspace (their own tenantId if it is the template)
        const adminTenant = await this.prisma.tenant.findUnique({
          where: { id: scopedAdmin.tenantId },
          select: { id: true, settings: true },
        })
        const adminSettings = (adminTenant?.settings as Record<string, unknown>) ?? {}

        if (adminSettings.isScopedAdminTemplate === true) {
          const templateTenantId = scopedAdmin.tenantId

          // Find shared default agents
          const allAgents = await this.prisma.agent.findMany({
            where: { tenantId: templateTenantId, status: 'ACTIVE' },
          })
          const sharedIds = new Set<string>(
            Array.isArray(adminSettings.sharedDefaultAgentIds)
              ? (adminSettings.sharedDefaultAgentIds as string[]).filter((id) =>
                  allAgents.some((a) => a.id === id),
                )
              : allAgents.map((a) => a.id), // treat all active agents as shared if no explicit list
          )
          const agentsToClone = allAgents.filter((a) => sharedIds.has(a.id))

          // Clone into new tenant (skip duplicates by name)
          const existingNames = new Set(
            (
              await this.prisma.agent.findMany({
                where: { tenantId: tenant.id },
                select: { name: true },
              })
            ).map((a) => a.name.toLowerCase()),
          )

          for (const src of agentsToClone) {
            if (existingNames.has(src.name.toLowerCase())) continue
            await this.prisma.agent.create({
              data: {
                tenantId: tenant.id,
                name: src.name,
                role: src.role,
                industry: src.industry,
                avatar: src.avatar,
                prompt: src.prompt,
                tools: src.tools,
                permissions: src.permissions,
                approvalRules: src.approvalRules as any,
                status: 'ACTIVE',
              },
            })
            clonedAgents++
          }
        }

        scopedAdminAssigned = data.scopedAdminEmail
      }
    }

    return {
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      scopedAdminAssigned,
      clonedAgents,
      verificationUrl,
      message: scopedAdminAssigned
        ? `Tenant provisioned and assigned to ${scopedAdminAssigned}. ${clonedAgents} default agent(s) cloned.`
        : 'Tenant provisioned successfully. User must verify email to activate account.',
    }
  }

  async suspendTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isSuspended: true },
    })

    return {
      success: true,
      message: 'Tenant suspended successfully. Users cannot access the system.',
    }
  }

  async activateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isSuspended: false },
    })

    return {
      success: true,
      message: 'Tenant activated successfully. Users can now access the system.',
    }
  }

  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })

    if (!tenant) {
      throw new NotFoundException('Tenant not found')
    }

    // Delete tenant (cascade will delete all related data)
    await this.prisma.tenant.delete({
      where: { id: tenantId },
    })

    return {
      success: true,
      message: 'Tenant and all associated data deleted permanently.',
    }
  }
}
