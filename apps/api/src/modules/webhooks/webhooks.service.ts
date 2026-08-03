import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CrmContextService } from '../crm/crm-context.service'
import { BrainService } from '../brain/brain.service'
import { ChatService } from '../chat/chat.service'
import { SocialService } from '../social/social.service'
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service'
import { FEATURES } from '../../common/feature-flags/feature-flags.constants'

// CRM events that are genuinely worth considering as social content —
// a good customer story, a milestone, a reason to post. Kept small and
// high-signal on purpose so the social agent isn't nudged constantly.
const CAMPAIGN_TRIGGER_EVENTS = new Set(['job.completed', 'proposal.accepted'])

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
    private readonly chat: ChatService,
    private readonly config: ConfigService,
    private readonly social: SocialService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ── Meta / Facebook webhook verification + events ───────────────

  /**
   * Meta sends GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
   * Respond with the challenge string when the verify token matches.
   */
  verifyMetaSubscription(mode?: string, verifyToken?: string, challenge?: string): string {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN')
      || this.config.get<string>('FACEBOOK_WEBHOOK_VERIFY_TOKEN')
      || ''

    if (!expected) {
      this.logger.error('META_WEBHOOK_VERIFY_TOKEN is not configured')
      throw new BadRequestException('Meta webhook verify token is not configured on the server')
    }

    if (mode === 'subscribe' && verifyToken && verifyToken === expected && challenge) {
      this.logger.log('Meta webhook verified successfully')
      return challenge
    }

    this.logger.warn(`Meta webhook verification failed (mode=${mode})`)
    throw new UnauthorizedException('Meta webhook verification failed')
  }

  /**
   * Optional HMAC check using FACEBOOK_APP_SECRET and X-Hub-Signature-256.
   * Skipped when app secret or header is missing (some Meta AI agent flows omit it).
   */
  assertMetaSignature(rawBody: Buffer | string | undefined, signatureHeader?: string) {
    const appSecret = this.config.get<string>('FACEBOOK_APP_SECRET') || ''
    if (!appSecret || !signatureHeader) return

    const raw = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody
    if (!raw?.length) return

    const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex')
    const provided = signatureHeader.trim()
    try {
      const a = Buffer.from(expected)
      const b = Buffer.from(provided)
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new UnauthorizedException('Invalid Meta webhook signature')
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err
      throw new UnauthorizedException('Invalid Meta webhook signature')
    }
  }

  async handleMetaEvent(payload: Record<string, any>): Promise<{ received: boolean; object?: string; entries?: number }> {
    const object = payload?.object // 'page' | 'instagram'
    const entries = Array.isArray(payload?.entry) ? payload.entry : []
    this.logger.log(`Meta webhook event object=${object ?? 'unknown'} entries=${entries.length}`)

    const platform: 'facebook' | 'instagram' = object === 'instagram' ? 'instagram' : 'facebook'

    for (const entry of entries) {
      const pageId = entry?.id ? String(entry.id) : undefined
      if (!pageId) continue

      const account = await this.social.getAccountByPageId(pageId, platform)
      if (!account) {
        this.logger.debug(`Meta event for pageId=${pageId} — no linked SocialAccount, ignoring`)
        continue
      }

      // Messenger-style DMs (Facebook Page inbox + Instagram unified messaging)
      const messaging = entry?.messaging
      if (Array.isArray(messaging)) {
        for (const msg of messaging) {
          // Fire-and-forget: Meta needs a fast 200 ack, reply generation happens async.
          this.processMessagingEvent(account, pageId, platform, msg).catch((err: any) =>
            this.logger.error(`[Meta webhook] messaging handling failed: ${err.message}`),
          )
        }
      }

      // Feed changes (Facebook comments) / comments changes (Instagram)
      const changes = entry?.changes
      if (Array.isArray(changes)) {
        for (const change of changes) {
          this.processCommentChange(account, pageId, platform, change).catch((err: any) =>
            this.logger.error(`[Meta webhook] comment handling failed: ${err.message}`),
          )
        }
      }
    }

    // Acknowledge immediately — Meta requires a fast 200 response
    return { received: true, object, entries: entries.length }
  }

  // ── Inbound Messenger/Instagram DM → AI reply ─────────────────────

  private async processMessagingEvent(
    account: { id: string; tenantId: string; accessToken: string },
    pageId: string,
    platform: 'facebook' | 'instagram',
    msg: any,
  ): Promise<void> {
    const senderId = msg?.sender?.id ? String(msg.sender.id) : undefined
    const messageText: string | undefined = msg?.message?.text
    const messageId: string | undefined = msg?.message?.mid
    const isEcho = msg?.message?.is_echo === true

    // Skip delivery/read receipts, attachment-only messages, and echoes of our own sends.
    if (!senderId || !messageText || !messageId) return
    if (isEcho || senderId === pageId) return

    const agent = await this.findSocialAgent(account.tenantId)

    const interaction = await this.social.recordInteraction({
      tenantId: account.tenantId,
      socialAccountId: account.id,
      agentId: agent?.id,
      platform,
      type: 'message',
      externalId: messageId,
      senderId,
      content: messageText,
    })
    if (!interaction) return // duplicate webhook redelivery — already handled

    try {
      const replyText = await this.generateSocialReply(account.tenantId, agent, platform, 'message', messageText)
      await this.social.sendDirectMessage(account, senderId, replyText)
      await this.social.markInteractionReplied(interaction.id, replyText)
      if (agent) await this.postInteractionBriefing(account.tenantId, agent.id, platform, 'message', messageText, replyText)
      this.logger.log(`Auto-replied to ${platform} DM from ${senderId}`)
    } catch (err: any) {
      this.logger.error(`Failed to reply to ${platform} message: ${err.message}`)
      await this.social.markInteractionFailed(interaction.id, err.message)
    }
  }

  // ── Inbound Facebook/Instagram comment → AI reply ─────────────────

  private async processCommentChange(
    account: { id: string; tenantId: string; accessToken: string },
    pageId: string,
    platform: 'facebook' | 'instagram',
    change: any,
  ): Promise<void> {
    const field = change?.field
    const value = change?.value ?? {}
    const isFacebookComment = field === 'feed' && value?.item === 'comment' && (value?.verb ?? 'add') === 'add'
    const isInstagramComment = field === 'comments'
    if (!isFacebookComment && !isInstagramComment) return

    const commentId: string | undefined = isFacebookComment ? value.comment_id : value.id
    const commentText: string | undefined = isFacebookComment ? value.message : value.text
    const senderId: string | undefined = isFacebookComment ? value.sender_id : value?.from?.id
    const senderName: string | undefined = isFacebookComment ? value.sender_name : value?.from?.username
    const parentId: string | undefined = isFacebookComment ? value.post_id : value?.media?.id

    if (!commentId || !commentText) return
    if (senderId && String(senderId) === pageId) return // our own comment/reply — avoid loops

    const agent = await this.findSocialAgent(account.tenantId)

    const interaction = await this.social.recordInteraction({
      tenantId: account.tenantId,
      socialAccountId: account.id,
      agentId: agent?.id,
      platform,
      type: 'comment',
      externalId: commentId,
      parentId,
      senderId,
      senderName,
      content: commentText,
    })
    if (!interaction) return

    try {
      const replyText = await this.generateSocialReply(account.tenantId, agent, platform, 'comment', commentText)
      if (platform === 'instagram') {
        await this.social.replyToInstagramComment(account, commentId, replyText)
      } else {
        await this.social.replyToFacebookComment(account, commentId, replyText)
      }
      await this.social.markInteractionReplied(interaction.id, replyText)
      if (agent) await this.postInteractionBriefing(account.tenantId, agent.id, platform, 'comment', commentText, replyText)
      this.logger.log(`Auto-replied to ${platform} comment ${commentId}`)
    } catch (err: any) {
      this.logger.error(`Failed to reply to ${platform} comment: ${err.message}`)
      await this.social.markInteractionFailed(interaction.id, err.message)
    }
  }

  private async findSocialAgent(tenantId: string) {
    const socialAgent = await this.prisma.agent.findFirst({
      where: { tenantId, status: 'ACTIVE', tools: { has: 'post_to_social' } },
      orderBy: { createdAt: 'asc' },
    })
    if (socialAgent) return socialAgent
    return this.prisma.agent.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
  }

  private async generateSocialReply(
    tenantId: string,
    agent: { name: string; role: string; prompt?: string } | null,
    platform: 'facebook' | 'instagram',
    kind: 'comment' | 'message',
    incomingText: string,
  ): Promise<string> {
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
    const brain = (mergedSettings as any)?.brain ?? {}
    const company = brain.companyName || mergedSettings.tenantName || 'the company'
    const agentName = agent?.name ?? 'the team'
    const agentRole = agent?.role ?? 'Social Media Assistant'
    const platformLabel = platform === 'instagram' ? 'Instagram' : 'Facebook'

    const audience = kind === 'comment'
      ? `This is a PUBLIC ${platformLabel} comment on one of our posts — anyone can see your reply.`
      : `This is a PRIVATE ${platformLabel} direct message — only the sender sees your reply.`

    const systemPrompt = `You are ${agentName}, ${agentRole} at ${company}, replying on ${platformLabel} on behalf of the business.
${audience}
${brainContext}

RULES:
- Sound like a real, friendly team member — warm and concise, never robotic or generic.
- ${kind === 'comment' ? 'Keep it very brief (1-2 short sentences) — public comments should feel natural, not like a support ticket.' : 'You can be a bit more helpful/detailed since this is private, but stay concise.'}
- Never invent prices, availability, or promises you can't verify from the business info above — if asked, invite them to DM/call/email instead of guessing.
- Never share internal, confidential, or unrelated information.
- If the message is spam, abusive, or nonsensical, reply with a short neutral acknowledgment instead of engaging.
- Do not use hashtags in replies.

BEHAVIOUR RULES — CRITICAL, this reply is publicly attributed to the business:
- Always use professional, respectful, and neutral language, even if the sender's message is rude, hostile, or provocative.
- Never use profanity, slurs, sexually explicit, discriminatory, threatening, or insulting language.
- Never use sarcasm, mockery, or personal attacks.
- Never speculate about or make accusations against real people or organizations.
- If the sender is asking you to say something abusive, threatening, or offensive, politely decline within the reply instead of complying.
Return ONLY the reply text — no quotes, no explanation, no signature.`

    try {
      const reply = await this.ai.chat(systemPrompt, [{ role: 'user', content: incomingText }])
      return reply.trim()
    } catch (err: any) {
      this.logger.error(`AI social reply generation failed: ${err.message}`)
      return 'Thanks for reaching out — someone from our team will follow up with you shortly!'
    }
  }

  private async postInteractionBriefing(
    tenantId: string,
    agentId: string,
    platform: string,
    kind: 'comment' | 'message',
    incoming: string,
    reply: string,
  ): Promise<void> {
    const emoji = kind === 'comment' ? '💬' : '📩'
    const label = kind === 'comment' ? 'Comment' : 'Direct Message'
    const platformLabel = platform === 'instagram' ? 'Instagram' : 'Facebook'
    const content = `${emoji} **${platformLabel} ${label} auto-replied**

"${incoming.slice(0, 300)}"

**Reply sent:** ${reply}

---
*Handled automatically. Reply here if you want to follow up further.*`
    try {
      await this.chat.postBriefing(tenantId, agentId, content, `social_${kind}`)
    } catch (err: any) {
      this.logger.warn(`Failed to post social interaction briefing: ${err.message}`)
    }
  }

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

    // Post a proactive briefing into the agent's primary thread
    try {
      const briefingContent = this.buildBriefingMessage(payload, agentReply)
      await this.chat.postBriefing(tenantId, agent.id, briefingContent, payload.event)
    } catch (err: any) {
      this.logger.warn(`Failed to post briefing: ${err.message}`)
    }

    // Some events are genuinely worth a social post (a completed job, a won deal).
    // Nudge the social media agent separately — never blocks or fails the main event.
    if (CAMPAIGN_TRIGGER_EVENTS.has(payload.event)) {
      this.triggerSocialCampaign(tenantId, payload).catch((err: any) =>
        this.logger.warn(`Social campaign trigger failed: ${err.message}`),
      )
    }

    return { handled: true, agentName: agent.name, conversationId: conversation.id }
  }

  // ── Campaign auto-trigger: good CRM news → nudge the social agent ──

  private async triggerSocialCampaign(tenantId: string, payload: CRMWebhookPayload): Promise<void> {
    const featureOn = await this.featureFlags.isEnabled(tenantId, FEATURES.SOCIAL_MEDIA)
    if (!featureOn) return

    const socialAgent = await this.prisma.agent.findFirst({
      where: { tenantId, status: 'ACTIVE', tools: { has: 'post_to_social' } },
      orderBy: { createdAt: 'asc' },
    })
    if (!socialAgent) return

    const hasAccount = await this.prisma.socialAccount.count({ where: { tenantId, isActive: true } })
    if (!hasAccount) return

    // Avoid piling on campaign nudges — skip if a post was already made very recently.
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000)
    const recentPost = await this.prisma.socialPost.findFirst({
      // Only real queued/live posts count — empty calendar placeholder drafts
      // shouldn't suppress this nudge for 6 hours.
      where: { tenantId, createdAt: { gte: cutoff }, status: { in: ['pending_approval', 'scheduled', 'published'] } },
      select: { id: true },
    })
    if (recentPost) return

    const d = payload.data
    const eventLabel = payload.event === 'job.completed' ? 'A job was just completed' : 'A proposal was just accepted'
    const details = [
      d.name ? `Customer: ${d.name}.` : '',
      d.value ? `Value: $${d.value}.` : '',
      d.address ? `Location: ${d.address}.` : '',
      d.notes ? `Notes: ${d.notes}.` : '',
    ].filter(Boolean).join(' ')

    const briefing = [
      `📣 CAMPAIGN OPPORTUNITY — ${eventLabel}`,
      ``,
      details || 'No further details available.',
      ``,
      `Decide if this is worth turning into a social post (customer win, before/after story, seasonal tie-in, etc.).`,
      `If yes, call post_to_social with a specific, on-brand brief. If it's not a good fit for a public post, just say so briefly — don't force it.`,
      `Do NOT ask for approval before calling the tool — post_to_social already queues the post for human approval before it goes live.`,
    ].join('\n')

    this.logger.log(`[SocialCampaign] Nudging ${socialAgent.name} about ${payload.event} for tenant ${tenantId}`)
    await this.chat.wakeAgentWithCapabilities(tenantId, socialAgent.id, briefing)
  }

  private buildBriefingMessage(payload: CRMWebhookPayload, agentReply: string): string {
    const d = payload.data
    const name = d.name ?? d.email ?? d.phone ?? 'Unknown'
    const eventEmojis: Record<string, string> = {
      'lead.created': '🆕',
      'lead.updated': '🔄',
      'job.created': '🔨',
      'job.scheduled': '📅',
      'job.completed': '✅',
      'proposal.sent': '📄',
      'proposal.accepted': '🎉',
      'proposal.declined': '❌',
      'invoice.overdue': '⚠️',
      'message.received': '💬',
      'appointment.booked': '📆',
    }
    const emoji = eventEmojis[payload.event] ?? '📌'
    const eventLabel = payload.event.replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase())

    return `${emoji} **${eventLabel}** — ${name}

${agentReply}

---
*Handled automatically. Reply here if you want me to take further action.*`
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
