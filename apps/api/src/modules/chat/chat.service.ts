import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CrmService } from '../crm/crm.service'
import { CrmContextService } from '../crm/crm-context.service'
import { BrainService } from '../brain/brain.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { TasksService } from '../tasks/tasks.service'
import { EmailService } from '../email/email.service'

// Regex patterns to extract caller identity from first message
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

// CRM tool definitions exposed to the AI model
const CRM_TOOL_DEFINITIONS = [
  {
    name: 'crm_search_contacts',
    description: 'Search for an existing CUSTOMER or CONTACT (someone who already has a job or account). Use for: "find customer John", "look up this phone number", "who is this email". NOT for leads or pipeline.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Customer name, email or phone to search' } }, required: ['query'] },
  },
  {
    name: 'crm_search_leads',
    description: 'Search or list LEADS in the sales pipeline. Use for: "show pending leads", "list new leads", "details of leads in Qualified stage", "which leads came from Facebook". Pass stage to filter by pipeline stage.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search term, or empty string "" to list all leads' }, stage: { type: 'string', description: 'Optional: filter by stage name exactly e.g. "Pending", "New", "Qualified", "Contacted", "Major Damage"' } }, required: ['query'] },
  },
  {
    name: 'crm_get_lead_stats',
    description: 'Get total count of LEADS grouped by pipeline stage. Use for: "how many leads", "how many pending leads", "lead breakdown", "pipeline overview", "total leads by status".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'crm_get_jobs',
    description: 'Get all open JOBS or PROJECTS for a specific customer. Use after finding a customer ID with crm_search_contacts. Use for: "what jobs does this customer have", "open projects", "active work orders".',
    parameters: { type: 'object', properties: { customerId: { type: 'string', description: 'CRM customer ID (get this from crm_search_contacts first)' } }, required: ['customerId'] },
  },
  {
    name: 'crm_get_proposals',
    description: 'Get pending PROPOSALS or ESTIMATES for a specific customer. Use for: "what quotes were sent", "proposal status", "estimate value". Requires a customer ID.',
    parameters: { type: 'object', properties: { customerId: { type: 'string', description: 'CRM customer ID' } }, required: ['customerId'] },
  },
  {
    name: 'crm_get_materials',
    description: 'Get the materials/parts list for a job from the CRM',
    parameters: { type: 'object', properties: { jobId: { type: 'string', description: 'CRM job ID' } }, required: ['jobId'] },
  },
  {
    name: 'crm_create_note',
    description: 'Log a note on a customer record in the CRM',
    parameters: { type: 'object', properties: { content: { type: 'string' }, customerId: { type: 'string' }, jobId: { type: 'string' } }, required: ['content'] },
  },
  {
    name: 'crm_create_task',
    description: 'Create a follow-up task in the CRM',
    parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, customerId: { type: 'string' }, dueDate: { type: 'string' } }, required: ['title', 'description'] },
  },
  {
    name: 'crm_update_lead',
    description: 'Update the pipeline stage of a lead in the CRM',
    parameters: { type: 'object', properties: { leadId: { type: 'string' }, stage: { type: 'string', description: 'New stage e.g. Qualified, Proposal Sent, Won' } }, required: ['leadId', 'stage'] },
  },
  {
    name: 'crm_update_record',
    description: 'Update any record in the CRM (customer, job, proposal, etc.)',
    parameters: { type: 'object', properties: { model: { type: 'string', description: 'Record type e.g. customer, job, lead' }, id: { type: 'string' }, data: { type: 'object', description: 'Fields to update' } }, required: ['model', 'id', 'data'] },
  },
  {
    name: 'create_internal_task',
    description: 'Create an internal task or follow-up action that needs to be tracked by the team. Use when a user asks to schedule something, follow up, or when you identify work that needs to be assigned or tracked internally.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Task details and context' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Task priority' },
        dueDate: { type: 'string', description: 'ISO date string for due date, optional' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'request_approval',
    description: 'Create an approval request that needs human sign-off before proceeding. Use when a decision requires manager or owner approval.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs to be approved' },
        description: { type: 'string', description: 'Details of what is being approved and why' },
        type: { type: 'string', description: 'Category e.g. budget, quote, refund, schedule, hr' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'reply_to_widget_session',
    description: 'Send a message directly to a customer who is currently in a website widget chat session. Use this when the business owner asks you to reply to or message a specific customer. The sessionId can be found in the briefing summary at the bottom of the widget chat update.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The widget session ID from the briefing card (shown as "Session ID: ..." at the bottom)' },
        message: { type: 'string', description: 'The message to send to the customer' },
      },
      required: ['sessionId', 'message'],
    },
  },
  {
    name: 'contact_customer',
    description: 'Smart contact tool: automatically sends via website chat if the customer sent a message within the last 10 minutes, or falls back to email if they have left and an email was collected. Use this as the DEFAULT way to reply to any widget customer. Always prefer this over email when the customer is likely still in the chat.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'The widget session ID from the briefing card' },
        message: { type: 'string', description: 'The message or follow-up to send to the customer' },
        subject: { type: 'string', description: 'Email subject line (only used when sending by email, optional)' },
      },
      required: ['sessionId', 'message'],
    },
  },
]

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly crm: CrmService,
    private readonly crmCtx: CrmContextService,
    private readonly brain: BrainService,
    private readonly knowledge: KnowledgeService,
    private readonly tasks: TasksService,
    private readonly email: EmailService,
  ) {}

  async findAll(tenantId: string, agentId?: string) {
    return this.prisma.conversation.findMany({
      where: { tenantId, ...(agentId ? { agentId } : {}) },
      include: { agent: { select: { id: true, name: true, role: true, avatar: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
  }

  async findOne(tenantId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { agent: true },
    })
    if (!conv) throw new NotFoundException('Conversation not found')
    return conv
  }

  async create(tenantId: string, userId: string, data: { agentId: string; channel: string; title?: string; callerPhone?: string; callerEmail?: string }) {
    return this.prisma.conversation.create({
      data: {
        tenantId,
        userId,
        agentId: data.agentId,
        channel: data.channel as any,
        title: data.title ?? 'New conversation',
        status: 'OPEN',
        metadata: {
          callerPhone: data.callerPhone,
          callerEmail: data.callerEmail,
        } as any,
      },
      include: { agent: { select: { id: true, name: true, role: true, avatar: true } } },
    })
  }

  async getMessages(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } })
    if (!conv) throw new NotFoundException('Conversation not found')
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ── Primary (persistent) conversation per agent ───────────────────
  // One conversation per tenant+agent that never gets deleted.
  // Rachel posts proactive briefings here when she handles events.

  async getOrCreatePrimaryConversation(tenantId: string, agentId: string, userId?: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, agentId, isPrimary: true },
      include: { agent: { select: { id: true, name: true, role: true, avatar: true } } },
    })
    if (existing) return existing

    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')

    return this.prisma.conversation.create({
      data: {
        tenantId,
        agentId,
        userId: userId ?? null,
        channel: 'INTERNAL',
        title: `Chat with ${agent.name}`,
        status: 'OPEN',
        isPrimary: true,
        metadata: { isPrimaryThread: true } as any,
      },
      include: { agent: { select: { id: true, name: true, role: true, avatar: true } } },
    })
  }

  // ── Post a proactive briefing from agent into primary thread ──────
  // Called by webhook handler, widget end-of-session, etc.

  async postBriefing(tenantId: string, agentId: string, content: string, briefingType: string) {
    const conv = await this.getOrCreatePrimaryConversation(tenantId, agentId)
    await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'ASSISTANT',
        content,
        briefingType,
      },
    })
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    })
    return conv.id
  }

  async sendMessage(tenantId: string, conversationId: string, content: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { agent: true },
    })
    if (!conv) throw new NotFoundException('Conversation not found')

    // Save user message
    await this.prisma.message.create({
      data: { conversationId, role: 'USER', content },
    })

    // Get conversation history (last 20 messages)
    const history = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    // Fetch tenant with industry + settings for brain context
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

    // ── CRM context injection ─────────────────────────────────────
    // On the first message of a conversation, try to find the caller in CRM
    let crmContextBlock = ''
    let callerCustomerId: string | undefined

    const isFirstMessage = history.filter(m => m.role === 'USER').length <= 1
    if (isFirstMessage) {
      const meta = conv.metadata as any
      const phone = meta?.callerPhone ?? content.match(PHONE_RE)?.[0]
      const email = meta?.callerEmail ?? content.match(EMAIL_RE)?.[0]

      if (phone || email) {
        const crmData = await this.crmCtx.fetchContext(tenantId, {
          phone,
          email,
          agentRole: conv.agent.role,
          agentId: conv.agent.id,
        })
        crmContextBlock = this.crmCtx.formatForPrompt(crmData)
        callerCustomerId = crmData.customer?.id
      }
    }

    // ── RAG: retrieve relevant knowledge chunks ───────────────────
    const ragContext = await this.knowledge.retrieveContext(conv.agent.id, content)

    // ── Build enriched system prompt ──────────────────────────────
    const enrichedSystemPrompt = this.buildFullSystemPrompt(conv.agent, mergedSettings, brainContext, crmContextBlock, ragContext)

    // ── Tool dispatch loop ────────────────────────────────────────
    // If agent has CRM tools, include tool definitions and run dispatch
    const hasCrmTools = conv.agent.tools?.some((t: string) => t.startsWith('crm_'))
    const messages = history
      .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
      // Strip any raw tool-call JSON that leaked into history so AI doesn't repeat the pattern
      .filter((m) => !(m.role === 'ASSISTANT' && m.content.trim().includes('__tool__')))
      .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant' as 'user' | 'assistant', content: m.content }))

    let aiReply = ''
    try {
      if (hasCrmTools) {
        aiReply = await this.runWithToolDispatch(tenantId, conv.agent, enrichedSystemPrompt, messages, callerCustomerId, undefined)
      } else {
        aiReply = await this.ai.chat(enrichedSystemPrompt, messages)
      }
    } catch (err: any) {
      this.logger.error(`AI chat error for conversation ${conversationId}: ${err?.message ?? err}`)
      aiReply = `I encountered an issue: ${err?.message ?? 'Unknown error'}. Please check the OpenAI API key in .env.`
    }

    const aiMessage = await this.prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: aiReply },
    })

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })

    // Auto-log CRM note if agent has crm_update tool
    if (conv.agent.tools?.includes('crm_update')) {
      const noteContent = callerCustomerId
        ? `[AI Chat] ${conv.agent.name}: ${aiReply.slice(0, 500)}`
        : `[AI Chat] ${conv.agent.name}: ${aiReply.slice(0, 300)}`
      this.crm.createNote(conv.tenantId, {
        content: noteContent,
        ...(callerCustomerId ? { customerId: callerCustomerId } : {}),
      }).catch(() => {})
    }

    return { userMessage: history[history.length - 1], aiMessage }
  }

  // ── Tool dispatch using native OpenAI function calling ───────────
  // No more JSON-in-text hacks — OpenAI handles tool routing natively

  private async runWithToolDispatch(
    tenantId: string,
    agent: any,
    systemPrompt: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    defaultCustomerId?: string,
    emit?: (data: object) => void,
  ): Promise<string> {
    // Always include internal tools so agent can create tasks/approvals/widget replies/emails
    const internalToolNames = ['create_internal_task', 'request_approval', 'reply_to_widget_session', 'contact_customer']
    const allowedTools = CRM_TOOL_DEFINITIONS.filter(t =>
      agent.tools?.includes(t.name) || agent.tools?.includes('crm_all') || internalToolNames.includes(t.name)
    )

    if (!allowedTools.length) {
      return this.ai.chat(systemPrompt, messages)
    }

    return this.ai.chatWithTools(
      systemPrompt,
      messages,
      allowedTools,
      async (toolName, params) => {
        // ── Internal task creation ─────────────────────────
        if (toolName === 'create_internal_task') {
          try {
            const task = await this.tasks.create(tenantId, {
              title: params.title,
              description: params.description,
              priority: params.priority ?? 'MEDIUM',
              agentId: agent.id,
              dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
            })
            emit?.({ action_card: { type: 'task', id: task.id, title: task.title, description: task.description, priority: task.priority, status: task.status } })
            return `Task created: "${task.title}" (ID: ${task.id})`
          } catch (err: any) {
            return `Failed to create task: ${err.message}`
          }
        }

        // ── Approval request ───────────────────────────────
        if (toolName === 'request_approval') {
          try {
            const approval = await this.prisma.approval.create({
              data: {
                tenantId,
                agentId: agent.id,
                type: params.type ?? 'general',
                title: params.title,
                description: params.description,
                status: 'PENDING',
              },
            })
            emit?.({ action_card: { type: 'approval', id: approval.id, title: approval.title, description: approval.description, approvalType: approval.type } })
            return `Approval request created: "${approval.title}" (ID: ${approval.id})`
          } catch (err: any) {
            return `Failed to create approval: ${err.message}`
          }
        }

        // ── Smart contact: widget if active, email if idle ─
        if (toolName === 'contact_customer') {
          try {
            const widgetConv = await this.prisma.conversation.findFirst({
              where: { id: params.sessionId, tenantId, channel: 'WIDGET' },
              include: {
                messages: {
                  where: { role: 'USER' },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            })
            if (!widgetConv) return `Widget session ${params.sessionId} not found`

            const meta = widgetConv.metadata as any
            // Use last USER message time (most reliable activity indicator)
            const lastUserMessage = widgetConv.messages[0]
            const lastActivity = lastUserMessage?.createdAt ?? widgetConv.updatedAt
            const idleMs = Date.now() - new Date(lastActivity).getTime()
            // Active if customer sent a message within the last 10 minutes
            const isActive = idleMs < 10 * 60 * 1000

            const visitorName = meta?.visitorName || 'Customer'
            const visitorEmail = meta?.callerEmail

            if (isActive) {
              // Send via widget chat
              await this.prisma.message.create({
                data: { conversationId: params.sessionId, role: 'ASSISTANT', content: params.message },
              })
              await this.prisma.conversation.update({
                where: { id: params.sessionId },
                data: { updatedAt: new Date() },
              })
              this.logger.log(`[contact_customer] Widget reply sent to session ${params.sessionId}`)
              return `✅ Message delivered to ${visitorName} via website chat: "${params.message}"`
            } else if (visitorEmail) {
              // Session idle — fall back to email
              const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true, name: true },
              })
              const companyName = (tenant?.settings as any)?.brain?.companyName || tenant?.name || 'Us'
              const subject = params.subject || `Follow-up from ${companyName}`
              await this.email.send({
                tenantId,
                to: visitorEmail,
                subject,
                html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                  <p>Hi ${visitorName},</p>
                  <p>${params.message.replace(/\n/g, '<br>')}</p>
                  <p style="color:#64748b;font-size:13px;margin-top:24px;">— ${companyName}</p>
                </div>`,
                text: `Hi ${visitorName},\n\n${params.message}\n\n— ${companyName}`,
              })
              this.logger.log(`[contact_customer] Email sent to ${visitorEmail}`)
              return `✅ Customer left the chat — email sent to ${visitorEmail}: "${params.message}"`
            } else {
              return `⚠️ Customer session is idle (${Math.round(idleMs / 60000)} min ago) and no email was collected. Cannot reach them automatically.`
            }
          } catch (err: any) {
            return `Failed to contact customer: ${err.message}`
          }
        }

        // ── Reply to widget customer ───────────────────────
        if (toolName === 'reply_to_widget_session') {
          try {
            const widgetConv = await this.prisma.conversation.findFirst({
              where: { id: params.sessionId, tenantId, channel: 'WIDGET' },
            })
            if (!widgetConv) return `Widget session ${params.sessionId} not found`

            await this.prisma.message.create({
              data: {
                conversationId: params.sessionId,
                role: 'ASSISTANT',
                content: params.message,
              },
            })
            await this.prisma.conversation.update({
              where: { id: params.sessionId },
              data: { updatedAt: new Date() },
            })
            this.logger.log(`[Widget Reply] sent to session ${params.sessionId}`)
            return `Message delivered to the customer: "${params.message}"`
          } catch (err: any) {
            return `Failed to send widget reply: ${err.message}`
          }
        }

        // ── CRM tools ──────────────────────────────────────
        if (!params.customerId && defaultCustomerId) {
          params.customerId = defaultCustomerId
        }
        try {
          const { summary } = await this.crmCtx.executeTool(tenantId, agent.role, toolName, params, agent.id)
          this.logger.log(`[Tool] ${toolName} → ${summary.slice(0, 120)}`)
          return summary
        } catch (err: any) {
          this.logger.warn(`[Tool] ${toolName} failed: ${err.message}`)
          return `Error executing ${toolName}: ${err.message}`
        }
      },
    )
  }

  // ── Streaming version of sendMessage ─────────────────────────────
  // Streams tokens via SSE callback, saves final message to DB

  async streamMessage(
    tenantId: string,
    conversationId: string,
    content: string,
    emit: (data: object) => void,
  ) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { agent: true },
    })
    if (!conv) throw new Error('Conversation not found')

    // Save user message
    await this.prisma.message.create({ data: { conversationId, role: 'USER', content } })

    // Get history
    const history = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    })

    // Build prompt (same as sendMessage)
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

    // CRM context on first message
    let crmContextBlock = ''
    const isFirstMessage = history.filter(m => m.role === 'USER').length <= 1
    if (isFirstMessage) {
      const meta = conv.metadata as any
      const phone = meta?.callerPhone ?? content.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0]
      const email = meta?.callerEmail ?? content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]
      if (phone || email) {
        const crmData = await this.crmCtx.fetchContext(tenantId, { phone, email, agentRole: conv.agent.role, agentId: conv.agent.id })
        crmContextBlock = this.crmCtx.formatForPrompt(crmData)
      }
    }

    const ragContext = await this.knowledge.retrieveContext(conv.agent.id, content)
    const systemPrompt = this.buildFullSystemPrompt(conv.agent, mergedSettings, brainContext, crmContextBlock, ragContext)
    const messages = history
      .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
      // Strip any raw tool-call JSON that leaked into history
      .filter(m => !(m.role === 'ASSISTANT' && m.content.trim().includes('__tool__')))
      .map(m => ({ role: m.role === 'USER' ? 'user' : 'assistant' as 'user' | 'assistant', content: m.content }))

    // If agent has CRM tools, run tool dispatch first then stream final answer
    const hasCrmTools = conv.agent.tools?.some((t: string) => t.startsWith('crm_'))
    let fullReply = ''

    if (hasCrmTools) {
      // Run tool dispatch loop (non-streaming), then stream the final response
      try {
        fullReply = await this.runWithToolDispatch(tenantId, conv.agent, systemPrompt, messages, undefined, emit)
      } catch (err: any) {
        fullReply = `I encountered an issue fetching data: ${err?.message ?? 'Unknown error'}.`
      }
      // Emit the full reply token-by-token for UI consistency
      for (const char of fullReply) {
        emit({ token: char })
        await new Promise(r => setTimeout(r, 0))
      }
    } else {
      // Stream tokens directly
      const aiMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages]
      for await (const token of this.ai.stream(aiMessages)) {
        fullReply += token
        emit({ token })
      }
    }

    // Save assistant message
    const aiMessage = await this.prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: fullReply },
    })

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })

    // Auto-log CRM note
    if (conv.agent.tools?.includes('crm_update') && fullReply) {
      this.crm.createNote(tenantId, { content: `[AI] ${conv.agent.name}: ${fullReply.slice(0, 400)}` }).catch(() => {})
    }

    emit({ done: true, messageId: aiMessage.id })
  }

  // ── Returns the full system prompt ───────────────────────────────

  async getAgentSystemPrompt(tenantId: string, agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, tenantId } })
    if (!agent) throw new NotFoundException('Agent not found')

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
    return this.buildFullSystemPrompt(agent, mergedSettings, brainContext, '')
  }

  // ── Builds the structured system prompt ──────────────────────────

  private buildFullSystemPrompt(agent: any, settings: any, brainContext: string, crmContextBlock: string, ragContext = ''): string {
    const brain = settings?.brain ?? {}
    const company = brain.companyName || settings.tenantName || 'the company'
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const header = `You are ${agent.name}, ${agent.role} at ${company}.
Today is ${today}.
You ALWAYS act as a real employee of this business — never break character, never say you're an AI unless directly asked.
Respond in the brand voice described below. Be helpful, concise, and professional.`

    // Always include internal action tool instructions
    const internalToolsSection = `

INTERNAL ACTION TOOLS (always available):
You have access to these internal tools you should use proactively:

1. create_internal_task — Use whenever you identify work that needs to be tracked or followed up on.
   Always create a task rather than just saying "I'll follow up" — actually create it.

2. request_approval — Use when a decision needs sign-off from the business owner or manager.
   Examples: refund, discount, schedule change, large purchase. Create an approval instead of deciding yourself.

3. contact_customer (USE THIS BY DEFAULT for customer follow-ups) — Smart tool that automatically:
   - Sends via website CHAT if the customer's last message was within 10 minutes (they are likely still on the page)
   - Falls back to EMAIL only if the customer's last message was more than 10 minutes ago AND an email was collected
   ALWAYS call contact_customer. Do not just say you did it — actually invoke the tool.
   When the owner says "send via chat", "reply via chat", "tell them" — ALWAYS use contact_customer, not email.
   The tool decides the channel automatically based on recency — you do not need to decide.

4. reply_to_widget_session — Only use this when you are certain the customer is still active in the chat. Otherwise prefer contact_customer.

HANDLING MULTIPLE CONCURRENT CUSTOMER SESSIONS:
- Each briefing card contains a 🔑 Session ID line and the customer's name.
- ALWAYS map customer names to session IDs using the briefing cards you received.
- When the owner says "tell Mac" or "reply to Jorge" — look up the session ID that matches that customer name from your recent briefings.
- NEVER guess or mix up sessions. If you are unsure which session ID belongs to which customer, ask the owner to clarify.
- Example: owner says "tell Mac I'll confirm tomorrow" → find the briefing for Mac → use his session ID → call contact_customer with that session ID and the message.
- The session ID looks like: cmqay1ss80003av2trjxplg86

When chatting with the business owner/manager directly (in the internal chat thread):
- You will receive briefing updates about customer website chats after they go quiet.
- Each briefing shows 🔑 Session ID and the customer name prominently.
- Be proactive: flag things that need attention without being asked.`

    const footer = `\nAGENT-SPECIFIC INSTRUCTIONS:\n${agent.prompt}`

    return `${header}${brainContext}${internalToolsSection}${crmContextBlock}${ragContext}${footer}`
  }
}
