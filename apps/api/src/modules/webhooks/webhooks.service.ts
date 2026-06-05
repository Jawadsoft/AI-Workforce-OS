import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CrmContextService } from '../crm/crm-context.service'
import { BrainService } from '../brain/brain.service'

// Maps CRM event types → agent roles that should handle them
const EVENT_ROLE_MAP: Record<string, string[]> = {
  'lead.created':       ['Sales Assistant', 'Lead Qualification Assistant', 'Receptionist'],
  'lead.updated':       ['Sales Assistant', 'Lead Qualification Assistant'],
  'job.created':        ['Estimator', 'Project Coordinator', 'Inspector'],
  'job.scheduled':      ['Project Coordinator', 'Estimator'],
  'job.completed':      ['Executive Assistant', 'Project Coordinator'],
  'proposal.sent':      ['Sales Assistant', 'Executive Assistant'],
  'proposal.accepted':  ['Executive Assistant', 'Project Coordinator'],
  'proposal.declined':  ['Sales Assistant'],
  'invoice.overdue':    ['Executive Assistant', 'Receptionist'],
  'message.received':   ['Receptionist', 'Sales Assistant'],
  'appointment.booked': ['Receptionist', 'Executive Assistant'],
}

export interface CRMWebhookPayload {
  event: string         // e.g. "lead.created"
  tenantId?: string     // populated if using shared webhook endpoint
  data: {
    id?: string
    name?: string
    email?: string
    phone?: string
    address?: string
    stage?: string
    source?: string
    value?: number
    notes?: string
    jobId?: string
    customerId?: string
    leadId?: string
    [key: string]: unknown
  }
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly crmCtx: CrmContextService,
    private readonly brain: BrainService,
  ) {}

  // ── Called when a CRM webhook event arrives ───────────────────────

  async handleCRMEvent(tenantId: string, payload: CRMWebhookPayload): Promise<{ handled: boolean; agentName?: string; conversationId?: string }> {
    this.logger.log(`CRM webhook [${payload.event}] for tenant ${tenantId}`)

    // 1. Find matching agent for this event type
    const targetRoles = EVENT_ROLE_MAP[payload.event] ?? []
    if (!targetRoles.length) {
      this.logger.debug(`No agent mapping for event: ${payload.event}`)
      return { handled: false }
    }

    const agent = await this.prisma.agent.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        role: { in: targetRoles },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!agent) {
      this.logger.warn(`No active agent found for roles: ${targetRoles.join(', ')}`)
      return { handled: false }
    }

    // 2. Build auto-trigger message
    const triggerMessage = this.buildTriggerMessage(payload)

    // 3. Fetch CRM context for any person attached to this event
    const crmContext = await this.crmCtx.fetchContext(tenantId, {
      phone: payload.data.phone,
      email: payload.data.email,
      customerId: payload.data.customerId,
      leadId: payload.data.leadId,
      agentRole: agent.role,
    })
    const crmContextBlock = this.crmCtx.formatForPrompt(crmContext)

    // 4. Fetch brain context
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, industry: true, name: true },
    })
    const mergedSettings = {
      ...(tenant?.settings as any ?? {}),
      industry: (tenant?.settings as any)?.brain?.industry ?? tenant?.industry ?? '',
      tenantName: tenant?.name ?? '',
    }
    const brainContext = this.brain.buildAgentContext(mergedSettings)

    // 5. Build enriched system prompt
    const brain = (mergedSettings as any)?.brain ?? {}
    const company = brain.companyName || mergedSettings.tenantName || 'the company'
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const systemPrompt = `You are ${agent.name}, ${agent.role} at ${company}.
Today is ${today}.
You ALWAYS act as a real employee of this business.
${brainContext}${crmContextBlock}

AGENT-SPECIFIC INSTRUCTIONS:
${agent.prompt}`

    // 6. Generate agent response to the event
    let agentReply = ''
    try {
      agentReply = await this.ai.chat(systemPrompt, [{ role: 'user', content: triggerMessage }])
    } catch (err: any) {
      this.logger.error(`AI error during webhook handling: ${err.message}`)
      agentReply = `Automated response queued for ${payload.event}`
    }

    // 7. Create a system conversation + messages to store the action taken
    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId,
        agentId: agent.id,
        channel: 'WEBHOOK',
        title: `[Auto] ${payload.event} — ${payload.data.name ?? payload.data.id ?? 'Unknown'}`,
        status: 'OPEN',
        metadata: {
          webhookEvent: payload.event,
          webhookData: payload.data,
          crmCustomerId: crmContext.customer?.id,
        } as any,
      },
    })

    await this.prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: 'USER', content: triggerMessage },
        { conversationId: conversation.id, role: 'ASSISTANT', content: agentReply },
      ],
    })

    this.logger.log(`Webhook handled: agent=${agent.name}, conversation=${conversation.id}`)
    return { handled: true, agentName: agent.name, conversationId: conversation.id }
  }

  // ── Helper: create a human-readable trigger message ───────────────

  private buildTriggerMessage(payload: CRMWebhookPayload): string {
    const d = payload.data
    switch (payload.event) {
      case 'lead.created':
        return `New lead received: ${d.name ?? 'Unknown'}.${d.email ? ` Email: ${d.email}.` : ''}${d.phone ? ` Phone: ${d.phone}.` : ''}${d.source ? ` Source: ${d.source}.` : ''} Please qualify this lead and determine the best next step.`

      case 'job.created':
        return `New job created: ${d.name ?? d.id ?? 'Job'}.${d.address ? ` Address: ${d.address}.` : ''}${d.value ? ` Value: $${d.value}.` : ''} Please review this job and prepare the appropriate response or estimate.`

      case 'job.scheduled':
        return `Job scheduled: ${d.name ?? d.id ?? 'Job'} has been scheduled.${d.address ? ` Location: ${d.address}.` : ''} Please confirm preparations and notify the team.`

      case 'job.completed':
        return `Job completed: ${d.name ?? d.id ?? 'Job'} is now complete. Please follow up with the customer and update the record.`

      case 'proposal.sent':
        return `Proposal sent to ${d.name ?? 'customer'}.${d.value ? ` Value: $${d.value}.` : ''} Schedule a follow-up and track the response.`

      case 'proposal.accepted':
        return `Proposal accepted by ${d.name ?? 'customer'}!${d.value ? ` Deal value: $${d.value}.` : ''} Initiate job creation and onboarding.`

      case 'proposal.declined':
        return `Proposal declined by ${d.name ?? 'customer'}.${d.notes ? ` Notes: ${d.notes}.` : ''} Determine if we should follow up or adjust our offer.`

      case 'invoice.overdue':
        return `Invoice overdue for ${d.name ?? 'customer'}.${d.value ? ` Amount: $${d.value}.` : ''} Please draft a professional follow-up message.`

      case 'message.received':
        return `New message received from ${d.name ?? d.phone ?? d.email ?? 'customer'}: "${d.notes ?? 'No content'}". Please respond appropriately.`

      case 'appointment.booked':
        return `New appointment booked by ${d.name ?? 'customer'}.${d.address ? ` Location: ${d.address}.` : ''} Confirm and prepare any materials needed.`

      default:
        return `CRM event received: ${payload.event}. Data: ${JSON.stringify(d).slice(0, 300)}`
    }
  }

  // ── List recent webhook events (conversations triggered by webhooks) ──

  async listWebhookConversations(tenantId: string, limit = 20) {
    return this.prisma.conversation.findMany({
      where: { tenantId, channel: 'WEBHOOK' },
      include: {
        agent: { select: { id: true, name: true, role: true, avatar: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 2 },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
