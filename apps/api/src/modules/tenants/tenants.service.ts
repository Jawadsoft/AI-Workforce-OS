import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { EmailService } from '../email/email.service'

const INDUSTRY_AGENT_TEMPLATES: Record<string, string[]> = {
  ROOFING: ['receptionist', 'sales-assistant', 'executive-assistant', 'estimator', 'inspector', 'storm-analyst', 'insurance-assistant', 'lead-qualification-assistant'],
  CAR_DEALERSHIP: ['receptionist', 'sales-assistant', 'executive-assistant', 'lead-qualification-assistant', 'inventory-assistant', 'finance-assistant', 'appointment-assistant', 'marketing-assistant'],
  CLEANING: ['receptionist', 'sales-assistant', 'executive-assistant', 'quote-assistant', 'scheduler', 'appointment-assistant', 'marketing-assistant'],
  SECURITY: ['receptionist', 'sales-assistant', 'executive-assistant', 'tender-assistant', 'scheduler', 'compliance-assistant', 'safety-assistant'],
  PROPERTY_MANAGEMENT: ['receptionist', 'sales-assistant', 'executive-assistant', 'leasing-assistant', 'tenant-assistant', 'maintenance-coordinator', 'inspector', 'appointment-assistant'],
  HEALTHCARE: ['receptionist', 'executive-assistant', 'patient-coordinator', 'appointment-assistant', 'billing-assistant', 'compliance-assistant'],
  CONSTRUCTION: ['receptionist', 'sales-assistant', 'executive-assistant', 'estimator', 'project-coordinator', 'procurement-assistant', 'tender-assistant', 'safety-assistant'],
  REAL_ESTATE: ['receptionist', 'sales-assistant', 'executive-assistant', 'lead-qualification-assistant', 'property-assistant', 'leasing-assistant', 'appointment-assistant', 'marketing-assistant'],
  OTHER: ['receptionist', 'sales-assistant', 'executive-assistant', 'marketing-assistant'],
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async onboard(tenantId: string, data: {
    industry: string
    crm: string
    services: string
    locations?: string
    businessRules?: string
    brandVoice?: string
  }) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        industry: data.industry as any,
        settings: {
          crm: data.crm,
          services: data.services,
          locations: data.locations ?? '',
          businessRules: data.businessRules ?? '',
          brandVoice: data.brandVoice ?? 'Professional and helpful',
          onboardingComplete: true,
        },
      },
    })
  }

  async generateWorkforce(tenantId: string, industry: string) {
    // Always persist the industry on the tenant
    if (industry) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { industry: industry as any },
      })
    }

    const templateIds = INDUSTRY_AGENT_TEMPLATES[industry] ?? INDUSTRY_AGENT_TEMPLATES['OTHER']

    // ── Step 1: Deactivate ALL existing agents for this tenant ──
    // (soft delete to preserve conversation/task history)
    await this.prisma.agent.updateMany({
      where: { tenantId },
      data: { status: 'INACTIVE' },
    })
    this.logger.log(`Deactivated existing agents for tenant ${tenantId}`)

    // ── Step 2: Fetch all templates by ID ──
    const templates = await this.prisma.agentTemplate.findMany({
      where: { id: { in: templateIds } },
    })

    this.logger.log(`Found ${templates.length}/${templateIds.length} templates for industry ${industry}`)

    if (templates.length < templateIds.length) {
      const found = templates.map((t) => t.id)
      const missing = templateIds.filter((id) => !found.includes(id))
      this.logger.warn(`Missing templates: ${missing.join(', ')} — run pnpm db:seed`)
    }

    // ── Step 3: Create agents from templates ──
    if (templates.length > 0) {
      // Preserve the order from INDUSTRY_AGENT_TEMPLATES
      const ordered = templateIds
        .map((id) => templates.find((t) => t.id === id))
        .filter(Boolean) as typeof templates

      return Promise.all(
        ordered.map((template) =>
          this.prisma.agent.create({
            data: {
              tenantId,
              name: template.name,
              role: template.role,
              industry: industry as any,
              prompt: template.defaultPrompt,
              tools: template.tools,
              avatar: template.avatar ?? null,
              status: 'ACTIVE',
              permissions: ['read_conversations', 'create_tasks'],
              approvalRules: {
                requireApprovalFor: ['crm_update', 'send_email', 'upload_document'],
              },
            },
          }),
        ),
      )
    }

    // ── Fallback: no templates found ──
    this.logger.warn(`No templates found for ${industry} — creating defaults. Run pnpm db:seed.`)
    return Promise.all(
      [
        { name: 'Rachel — AI Receptionist', role: 'Receptionist' },
        { name: 'Stan — Sales Assistant', role: 'Sales Assistant' },
        { name: 'Ava — Executive Assistant', role: 'Executive Assistant' },
      ].map((d) =>
        this.prisma.agent.create({
          data: {
            tenantId,
            name: d.name,
            role: d.role,
            industry: industry as any,
            prompt: `You are ${d.name}. Help the business professionally.`,
            tools: ['create_task', 'crm_update', 'send_email'],
            status: 'ACTIVE',
            permissions: ['read_conversations', 'create_tasks'],
            approvalRules: { requireApprovalFor: ['crm_update', 'send_email'] },
          },
        }),
      ),
    )
  }

  async resetAndRegenerateWorkforce(tenantId: string, industry: string) {
    return this.generateWorkforce(tenantId, industry)
  }

  async getSettings(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, industry: true, settings: true },
    })
  }

  async saveSettings(tenantId: string, dto: Record<string, any>) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const existing = (tenant?.settings as Record<string, any>) || {}
    // Deep-merge top-level keys so nested objects (e.g. widget, brain) are merged not overwritten
    const merged: Record<string, any> = { ...existing }
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof existing[key] === 'object') {
          merged[key] = { ...(existing[key] as object), ...value }
        } else {
          merged[key] = value
        }
      }
    }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: merged } })
    return { success: true }
  }

  // ── Team Management ───────────────────────────────────────────────

  async getTeamMembers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, avatar: true, designation: true, department: true, phone: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async inviteMember(tenantId: string, data: { name: string; email: string; role: string; inviterName?: string; designation?: string; department?: string; phone?: string }) {
    const name = (data.name ?? '').trim()
    const email = (data.email ?? '').trim().toLowerCase()
    const role = (data.role ?? 'USER').trim().toUpperCase()

    if (!name || name.length < 2) throw new BadRequestException('Full name is required')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('A valid email address is required')
    }
    const allowedRoles = ['TENANT_ADMIN', 'MANAGER', 'USER', 'VIEWER']
    if (!allowedRoles.includes(role)) {
      throw new BadRequestException(`Invalid role. Allowed: ${allowedRoles.join(', ')}`)
    }

    const bcryptjs = await import('bcryptjs')
    const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!'
    const hashed = await bcryptjs.hash(tempPassword, 10)

    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) {
      // Same tenant + previously removed → reactivate with a fresh temp password
      if (existing.tenantId === tenantId && !existing.isActive) {
        const reactivated = await this.prisma.user.update({
          where: { id: existing.id },
          data: { name, password: hashed, role: role as any, isActive: true },
          select: { id: true, name: true, email: true, role: true, createdAt: true },
        })
        await this.sendInviteEmail(tenantId, {
          to: email,
          inviteeName: name,
          inviterName: data.inviterName,
          role,
          tempPassword,
        })
        this.logger.log(`Reactivated team member: ${email} as ${role}`)
        return { ...reactivated, tempPassword, reactivated: true }
      }

      if (existing.tenantId === tenantId) {
        throw new ConflictException(
          `${email} is already on this team${existing.role === 'TENANT_OWNER' ? ' as the account owner' : ''}. Use a different email address.`,
        )
      }
      throw new ConflictException(
        `${email} is already registered on another account. Use a different email address.`,
      )
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        name,
        email,
        password: hashed,
        role: role as any,
        isActive: true,
        designation: data.designation ?? null,
        department: data.department ?? null,
        phone: data.phone ?? null,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true, designation: true, department: true, phone: true },
    })

    await this.sendInviteEmail(tenantId, {
      to: email,
      inviteeName: name,
      inviterName: data.inviterName,
      role,
      tempPassword,
    })

    this.logger.log(`Invited team member: ${email} as ${role}`)
    return { ...user, tempPassword }
  }

  private async sendInviteEmail(
    tenantId: string,
    opts: { to: string; inviteeName: string; inviterName?: string; role: string; tempPassword: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
    // Prefer a public/browser-reachable URL for invite emails. Internal LAN hostnames
    // like "aipaccess" don't resolve for recipients opening mail on another device.
    const rawBase = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
    let loginBase = rawBase
    try {
      const host = new URL(rawBase).hostname.toLowerCase()
      if (host === 'aipaccess' || host.endsWith('.local') || host.endsWith('.lan')) {
        loginBase = 'http://localhost:3000'
        this.logger.warn(
          `Invite email login URL fell back to localhost (FRONTEND_URL host "${host}" is not reachable from email clients). Set PUBLIC_APP_URL for production.`,
        )
      }
    } catch {
      loginBase = 'http://localhost:3000'
    }
    const loginUrl = `${loginBase}/login`
    await this.email.sendTeamInvite({
      tenantId,
      to: opts.to,
      inviteeName: opts.inviteeName,
      inviterName: opts.inviterName || 'Your team',
      companyName: tenant?.name || 'AI Workforce OS',
      role: opts.role,
      loginUrl,
      tempPassword: opts.tempPassword,
    }).catch((err) => this.logger.warn(`Failed to send invite email: ${err}`))
  }

  async updateMemberRole(tenantId: string, userId: string, role: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new NotFoundException('User not found')
    return this.prisma.user.update({ where: { id: userId }, data: { role: role as any }, select: { id: true, name: true, email: true, role: true } })
  }

  async updateMemberProfile(tenantId: string, userId: string, data: { designation?: string; department?: string; phone?: string }) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new NotFoundException('User not found')
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        designation: data.designation ?? undefined,
        department: data.department ?? undefined,
        phone: data.phone ?? undefined,
      },
      select: { id: true, name: true, email: true, role: true, designation: true, department: true, phone: true },
    })
  }

  async removeMember(tenantId: string, userId: string, currentUserId: string) {
    if (userId === currentUserId) throw new BadRequestException('You cannot remove yourself')
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new NotFoundException('User not found')
    return this.prisma.user.update({ where: { id: userId }, data: { isActive: false } })
  }

  async isOnboardingComplete(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    return !!(tenant?.settings as any)?.onboardingComplete
  }

  async onboardingStatus(tenantId: string) {
    const [tenant, agentCount] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true, industry: true },
      }),
      this.prisma.agent.count({ where: { tenantId, status: 'ACTIVE' } }),
    ])
    const settings = (tenant?.settings as Record<string, unknown>) ?? {}
    const brain = (settings.brain as Record<string, unknown>) ?? null
    const complete = !!(settings.onboardingComplete)
    const hasIndustry = !!tenant?.industry
    const hasBrain = !!(brain && (brain.companyName || brain.companyDescription || brain.services))
    const hasAgents = agentCount > 0

    return { complete, hasIndustry, hasBrain, hasAgents }
  }
}
