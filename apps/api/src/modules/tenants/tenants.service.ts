import { Injectable, Logger } from '@nestjs/common'
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
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, avatar: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async inviteMember(tenantId: string, data: { name: string; email: string; role: string; inviterName?: string }) {
    const bcryptjs = await import('bcryptjs')
    const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!'
    const hashed = await bcryptjs.hash(tempPassword, 10)

    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new Error(`User with email ${data.email} already exists`)

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        name: data.name,
        email: data.email,
        password: hashed,
        role: data.role as any,
        isActive: true,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })

    // Send invite email
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
    await this.email.sendTeamInvite({
      tenantId,
      to: data.email,
      inviteeName: data.name,
      inviterName: data.inviterName || 'Your team',
      companyName: tenant?.name || 'AI Workforce OS',
      role: data.role,
      loginUrl,
      tempPassword,
    }).catch((err) => this.logger.warn(`Failed to send invite email: ${err}`))

    this.logger.log(`Invited team member: ${data.email} as ${data.role}`)
    return { ...user, tempPassword }
  }

  async updateMemberRole(tenantId: string, userId: string, role: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new Error('User not found')
    return this.prisma.user.update({ where: { id: userId }, data: { role: role as any }, select: { id: true, name: true, email: true, role: true } })
  }

  async removeMember(tenantId: string, userId: string, currentUserId: string) {
    if (userId === currentUserId) throw new Error('You cannot remove yourself')
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new Error('User not found')
    return this.prisma.user.update({ where: { id: userId }, data: { isActive: false } })
  }

  async isOnboardingComplete(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    })
    return !!(tenant?.settings as any)?.onboardingComplete
  }
}
