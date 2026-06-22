import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CrmService } from '../crm/crm.service'
import { CrmContextService } from '../crm/crm-context.service'
import { BrainService } from '../brain/brain.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { TasksService } from '../tasks/tasks.service'
import { EmailService } from '../email/email.service'
import { DocumentsService } from '../documents/documents.service'
import { StormService } from '../storm/storm.service'

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
    name: 'generate_document',
    description: 'Generate a professional PDF document. IMPORTANT: Before calling this tool, you MUST first use ask_user to show the customer a summary of what will be included and get their approval. Only call generate_document after the customer confirms they are happy with the details.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['estimate', 'inspection', 'sow', 'invoice'], description: 'Document type: estimate=quote/proposal, inspection=inspection report, sow=statement of work, invoice=payment invoice' },
        title: { type: 'string', description: 'Document title e.g. "Roof Estimate - John Smith"' },
        prompt: { type: 'string', description: 'Describe what to include: customer name, address, items, scope of work, amounts, etc.' },
      },
      required: ['type', 'title', 'prompt'],
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
  {
    name: 'handoff_to_agent',
    description: 'MUST USE: Immediately hand off this conversation to a specialist agent. Call this the moment you detect the request needs a specialist — do not explain what you will do, just call the tool. The specialist will reply directly in this conversation.',
    parameters: {
      type: 'object',
      properties: {
        agentRole: { type: 'string', description: 'Role keyword of the target agent e.g. "estimator", "insurance specialist", "sales assistant", "field inspector", "executive assistant"' },
        reason: { type: 'string', description: 'Brief reason why you are handing off' },
        contextSummary: { type: 'string', description: 'Summary of what the customer needs — passed to the specialist so they have full context' },
      },
      required: ['agentRole', 'reason', 'contextSummary'],
    },
  },
  {
    name: 'ask_user',
    description: 'Pause and ask the user a clarifying question or request approval before proceeding. Use when you need input before taking action. Optionally provide choice buttons.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
        choices: { type: 'array', items: { type: 'string' }, description: 'Optional list of button choices e.g. ["Yes, proceed", "No, cancel", "Edit amount"]' },
      },
      required: ['question'],
    },
  },
  {
    name: 'fetch_storm_data',
    description: 'Query NOAA storm reports stored in the system. Use this to look up hail, tornado, or wind events by state, county, size, and date range. If the user asks about a specific date or date range, pass that date. If they ask about "last 7 days" or "recent", use the days parameter.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['hail', 'tornado', 'wind'], description: 'Type of storm event to filter by' },
        state: { type: 'string', description: 'Two-letter US state code e.g. "TX", "FL"' },
        minSize: { type: 'number', description: 'Minimum hail size in inches (e.g. 1.0 for roof-damage threshold)' },
        days: { type: 'number', description: 'How many days back from today to query (default 7, max 30). Use this for "last N days" queries.' },
        date: { type: 'string', description: 'Specific date to query in YYYY-MM-DD format (e.g. "2026-06-15"). Use this when the user asks about a specific day.' },
        county: { type: 'string', description: 'County name to filter by (partial match)' },
      },
      required: [],
    },
  },
  {
    name: 'suggest_transfer',
    description: 'Offer to connect the customer with a colleague who is better suited to handle their request. Use this when the customer asks something outside your area of expertise. Shows the customer a button to switch to the right person.',
    parameters: {
      type: 'object',
      properties: {
        agentRole: { type: 'string', description: 'Role keyword of the colleague e.g. "estimator", "insurance specialist", "sales assistant", "field inspector"' },
        reason: { type: 'string', description: 'Brief natural-language reason why this colleague is better suited, e.g. "Cris handles all estimates and pricing"' },
        message: { type: 'string', description: 'Natural message to say to the customer before showing the transfer button, e.g. "That\'s actually my colleague Cris\'s area — want me to connect you with him?"' },
      },
      required: ['agentRole', 'reason', 'message'],
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
    private readonly documents: DocumentsService,
    private readonly storm: StormService,
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

  // ── Clear all messages in a conversation ─────────────────────────

  async clearMessages(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    })
    if (!conv) throw new NotFoundException('Conversation not found')

    const { count } = await this.prisma.message.deleteMany({
      where: { conversationId },
    })
    return { cleared: count }
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

  /** Post an email briefing to any active primary agent thread for the tenant */
  async postEmailBriefing(tenantId: string, content: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
    if (!agent) return
    await this.postBriefing(tenantId, agent.id, content, 'email_briefing')
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
    handoffDepth = 0,
    handoffCountRef?: { count: number; lastSpecialistId?: string; lastSpecialistName?: string },
  ): Promise<string> {
    // Specialists (depth >= 1) cannot handoff further or proactively create tasks — prevents infinite loops
    const isSpecialist = handoffDepth > 0
    // Track handoffs across multiple tool rounds in this conversation turn
    const hcRef = handoffCountRef ?? { count: 0 }
    // Intake agents (Nora etc.) silently relay via handoff_to_agent.
    // All other specialists offer transfers via suggest_transfer — never silent relay.
    const roleLC = (agent.role ?? '').toLowerCase()
    const isIntakeAgent = roleLC.includes('intake') || roleLC.includes('receptionist') || roleLC.includes('customer')
    const isStormAnalyst = roleLC.includes('storm') || roleLC.includes('analyst') || agent.name?.toLowerCase().includes('arturo')

    const internalToolNames = isSpecialist
      // Called via handoff: just answer, no routing tools
      ? ['reply_to_widget_session', 'contact_customer', 'generate_document', 'ask_user']
      : isIntakeAgent
        // Intake agent: silent relay to specialists
        ? ['create_internal_task', 'request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'handoff_to_agent', 'ask_user']
        : isStormAnalyst
          // Storm analyst: gets storm data tool + standard specialist tools
          ? ['create_internal_task', 'request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'suggest_transfer', 'ask_user', 'fetch_storm_data']
          // Specialist agent (estimator, inspector, etc.): offer transfers, no silent relay
          : ['create_internal_task', 'request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'suggest_transfer', 'ask_user']

    const allowedTools = CRM_TOOL_DEFINITIONS.filter(t =>
      agent.tools?.includes(t.name) || agent.tools?.includes('crm_all') || internalToolNames.includes(t.name)
    )

    if (!allowedTools.length) {
      return this.ai.chat(systemPrompt, messages)
    }

    // Specialists (called via handoff) get 1 round max — just answer.
    // Primary agents get up to 5 rounds to support: gather → confirm → user input → generate flow.
    const maxRounds = isSpecialist ? 1 : 5

    return this.ai.chatWithTools(
      systemPrompt,
      messages,
      allowedTools,
      async (toolName, params) => {
        // ── Document / PDF generation ──────────────────────
        if (toolName === 'generate_document') {
          try {
            const doc = await this.documents.generate(tenantId, agent.id, {
              type: params.type,
              title: params.title,
              prompt: params.prompt,
            })
            emit?.({ action_card: { type: 'document', id: doc.id, title: doc.title, docType: doc.type, format: doc.format } })
            return `Document generated successfully: "${doc.title}" (${doc.format}). The download button has appeared in the chat.`
          } catch (err: any) {
            return `Failed to generate document: ${err.message}`
          }
        }

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

        // ── Agent handoff ──────────────────────────────────
        if (toolName === 'handoff_to_agent') {
          try {
            const roleKeyword = (params.agentRole as string).toLowerCase()
            // Find a matching active agent in the same tenant
            const allAgents = await this.prisma.agent.findMany({
              where: { tenantId, status: 'ACTIVE' },
            })
            const target = allAgents.find(a =>
              a.role.toLowerCase().includes(roleKeyword) ||
              a.name.toLowerCase().includes(roleKeyword)
            )
            if (!target) {
              return `No active agent found with role matching "${params.agentRole}". I'll handle this myself.`
            }

            // Emit a natural "checking..." typing signal so user sees activity immediately
            const specialistFirstName = target.name.split('—')[0].split('(')[0].trim().split(' ')[0]
            emit?.({ checking: true, withName: specialistFirstName })

            // Emit handoff card to frontend (visible to business owner only)
            emit?.({
              action_card: {
                type: 'handoff',
                fromAgent: { id: agent.id, name: agent.name, role: agent.role },
                toAgent: { id: target.id, name: target.name, role: target.role },
                reason: params.reason,
              },
            })

            // Build specialist system prompt with handoff context
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
            const handoffContext = `\n\n[HANDOFF FROM ${agent.name.toUpperCase()}]: ${params.contextSummary}\nReason for handoff: ${params.reason}`
            const specialistPrompt = this.buildFullSystemPrompt(target, mergedSettings, brainContext, handoffContext, '', true)

            // Run the specialist agent — depth+1 prevents further handoffs and loops
            const specialistReply = await this.runWithToolDispatch(
              tenantId, target, specialistPrompt, messages, defaultCustomerId, emit, handoffDepth + 1, hcRef,
            )

            // Track this handoff
            hcRef.count += 1
            hcRef.lastSpecialistId = target.id
            hcRef.lastSpecialistName = target.name.split('—')[0].trim()

            this.logger.log(`[Handoff] ${agent.name} → ${target.name}: ${params.reason} (count: ${hcRef.count})`)

            // After 2+ handoffs on the same topic, hint that Nora can offer a direct transfer
            const transferHint = hcRef.count >= 2
              ? `\n\n[TRANSFER HINT: This is the ${hcRef.count === 2 ? 'second' : 'third+'} time you've consulted ${hcRef.lastSpecialistName} in this conversation. Naturally offer: "We've been going back and forth — want me to get ${hcRef.lastSpecialistName} to take over the conversation directly so you two can go deeper? Just say the word!" — but only if it feels natural.]`
              : ''

            // Return specialist answer back to Nora so she can rewrite it naturally.
            // Nora will deliver it in her own voice — she can mention the specialist by first name.
            return `[TEAM INPUT — rewrite this answer in your own natural voice. You CAN mention the specialist's first name (e.g., "Cris just got back to me!"). Sound warm and human, not like you are relaying a message.${transferHint}]\n\n${specialistReply}`
          } catch (err: any) {
            return `Handoff failed: ${err.message}. I'll handle this directly.`
          }
        }

        // ── Ask user a question / approval ─────────────────
        if (toolName === 'ask_user') {
          emit?.({
            action_card: {
              type: 'ask_user',
              question: params.question,
              choices: params.choices ?? [],
              agentName: agent.name,
            },
          })
          return `[Waiting for user response to: "${params.question}"]`
        }

        // ── Suggest transfer to a colleague ────────────────
        if (toolName === 'suggest_transfer') {
          try {
            const roleKeyword = (params.agentRole as string).toLowerCase()
            const allAgents = await this.prisma.agent.findMany({
              where: { tenantId, status: 'ACTIVE' },
            })
            const target = allAgents.find(a =>
              a.role.toLowerCase().includes(roleKeyword) ||
              a.name.toLowerCase().includes(roleKeyword)
            )

            const targetFirstName = target
              ? target.name.split('—')[0].trim().split(' ')[0]
              : roleKeyword

            emit?.({
              action_card: {
                type: 'transfer',
                agentId: target?.id,
                agentDisplayName: targetFirstName,
                reason: params.reason,
              },
            })

            this.logger.log(`[SuggestTransfer] ${agent.name} → ${target?.name ?? params.agentRole}`)
            return `[Transfer card shown to customer for ${targetFirstName}. Your message "${params.message}" was shown.]`
          } catch (err: any) {
            return `Could not find colleague for role "${params.agentRole}".`
          }
        }

        // ── Storm data query ───────────────────────────────
        if (toolName === 'fetch_storm_data') {
          try {
            const reports = await this.storm.queryReports(tenantId, {
              type: params.type as any,
              state: params.state,
              minSize: params.minSize,
              days: Math.min(params.days ?? 7, 30),
              date: params.date,
              county: params.county,
            })
            if (reports.length === 0) {
              return 'No storm reports found matching those criteria. NOAA SPC may not have recorded events in that area/timeframe, or the data may not be available yet for very recent dates. Try broader filters (more days, no state filter) or check tomorrow after 7 AM UTC.'
            }
            const byType = reports.reduce((acc: Record<string, number>, r) => {
              acc[r.type] = (acc[r.type] ?? 0) + 1
              return acc
            }, {})
            const largestHail = reports
              .filter(r => r.type === 'hail' && r.size)
              .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
            const topLines = reports.slice(0, 10).map(r => {
              const size = r.size ? ` (${r.size.toFixed(2)}")` : ''
              return `  • ${r.type.toUpperCase()}${size} — ${r.county ? r.county + ' County, ' : ''}${r.state} on ${new Date(r.reportDate).toLocaleDateString()} — ${r.location || 'location unknown'}`
            })
            const summary = [
              `Found ${reports.length} storm reports (${Object.entries(byType).map(([t, c]) => `${c} ${t}`).join(', ')})`,
              largestHail ? `Largest hail: ${largestHail.size?.toFixed(2)}" in ${largestHail.county || largestHail.state}` : null,
              '',
              'Top events:',
              ...topLines,
              reports.length > 10 ? `  ... and ${reports.length - 10} more events` : null,
            ].filter(Boolean).join('\n')
            return summary
          } catch (err: any) {
            return `Error fetching storm data: ${err.message}`
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
      maxRounds,
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

  private buildFullSystemPrompt(agent: any, settings: any, brainContext: string, crmContextBlock: string, ragContext = '', isSpecialist = false): string {
    const brain = settings?.brain ?? {}
    const company = brain.companyName || settings.tenantName || 'the company'
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const header = `You are ${agent.name}, ${agent.role} at ${company}.
Today is ${today}.
You ALWAYS act as a real employee of this business — never break character, never say you're an AI unless directly asked.
Respond in the brand voice described below. Be helpful, concise, and professional.`

    // Specialists do NOT get proactive task creation — they just handle the handed-off request
    const internalToolsSection = isSpecialist
      ? `

SPECIALIST MODE — You have been handed off this conversation. Focus solely on answering the customer's need.
Available tools: contact_customer (to message the customer), generate_document (to create proposals/reports), ask_user (to ask a clarifying question).
Do NOT create tasks or approvals unprompted. Just handle the request and give a clear response.`
      : `

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

    const teamCoordinationSection = `

TEAM COORDINATION — MANDATORY RULES:
You are the primary point of contact. You have a specialist team you can consult instantly.
You can mention your colleagues by name naturally — just like a real office receptionist would.

HOW TO WORK WITH YOUR TEAM:
5. handoff_to_agent — Consult a specialist behind the scenes, then YOU deliver the answer.
   - Call this tool IMMEDIATELY when you need specialist knowledge
   - The specialist answers, and their answer comes back to YOU as [TEAM INPUT]
   - YOU then deliver that answer naturally — you stay in the conversation throughout

   BEFORE calling the tool, say something natural like:
   ✅ "Let me check with Cris on that real quick!"
   ✅ "One sec, let me loop in our estimator!"
   ✅ "Give me a moment, checking with the team..."

   AFTER receiving [TEAM INPUT], respond naturally like:
   ✅ "Okay so Cris just got back to me — for a residential hip roof you're looking at $3,200–$4,800!"
   ✅ "Just heard back! Our estimator says we can fit you in Thursday for a site visit."
   ✅ "Good news — Cris says that's doable. Here's what he needs from you..."

   NEVER say (these sound robotic and cold):
   ❌ "I am transferring you to Cris" / "Cris will handle this from here"
   ❌ "Someone will reach out to you" / "Our estimator will contact you"
   ❌ "I'll connect you with..." / "I'll route this to..."

   TRIGGERS — call handoff_to_agent immediately:
   • "estimate" / "quote" / "cost" / "price" / "proposal"   → handoff to "estimator"
   • "insurance" / "claim" / "adjuster" / "coverage"        → handoff to "insurance specialist"
   • "inspection" / "damage" / "site visit" / "assess"      → handoff to "field inspector"
   • "interested in" / "want to buy" / "sign up"            → handoff to "sales assistant"

6. ask_user — Use for structured choices. Provide 2–4 button options.
   Example: "Is this residential or commercial?" with buttons [Residential] [Commercial]

SPECIALIST MODE (when you receive [HANDOFF FROM ...]):
- You are answering internally — your reply goes BACK to the intake agent, not directly to the customer
- Be concise and factual — the intake agent will deliver your answer in her own voice
- Do NOT address the customer directly`

    // Inject role-specific handoff triggers based on this agent's role
    const roleLC = (agent.role ?? '').toLowerCase()
    let roleHandoffSection = ''
    if (roleLC.includes('intake') || roleLC.includes('receptionist') || roleLC.includes('customer')) {
      roleHandoffSection = `

YOUR ROLE — CUSTOMER INTAKE:
You are the main contact. You have a specialist team you can consult and relay answers from.
You stay in the conversation the whole time — like a sharp receptionist who knows everyone on the team.

PROCESS:
1. Greet warmly, get their name and what they need (one natural question)
2. The moment you know what they need → call handoff_to_agent
3. BEFORE calling the tool, say something like "Let me check with [specialist] on that!"
4. AFTER [TEAM INPUT] comes back → deliver it naturally: "Okay so [name] just got back to me..."
5. Keep driving the conversation — you own it start to finish

LANGUAGE TO USE:
✅ "Let me check with Cris real quick!" [then call the tool]
✅ "Cris just got back — here's what he said..."
✅ "Good news, our estimator says..."
✅ "Want me to get that booked for you?"

LANGUAGE TO NEVER USE:
❌ "I'm connecting you with Cris" / "Cris will handle this from here"
❌ "Someone from our team will reach out"
❌ "I'm transferring you" / "I'll route this to..."
❌ Anything that implies you are stepping away from the conversation`
    } else if (roleLC.includes('estimator') || roleLC.includes('estimate')) {
      roleHandoffSection = `

YOUR ROLE — ESTIMATOR:
You handle estimates, quotes, proposals, and pricing.

DOCUMENT GENERATION PROCESS (always follow this 3-step flow):
1. Gather: Ask for the details you need (property type, size, materials, scope)
2. Confirm: Summarize what will go in the document using ask_user:
   - "Here's what I'll include in the estimate:
     • Property: Residential, 580 sqft hip roof
     • Material: Asphalt shingles
     • Scope: Full replacement including labor, materials, disposal
     • Estimated range: $4,800–$6,200
     Shall I generate it, or would you like to change anything?"
   Provide buttons: ["Generate it!"] ["Make changes"] 
3. Generate: Only call generate_document AFTER the customer confirms

NEVER skip step 2. Do not call generate_document without customer approval first.

IN SCOPE (handle yourself):
- Prepare and generate estimates and proposals (following the 3-step process above)
- Answer pricing questions, material costs, labor rates
- Discuss scope of work

OUT OF SCOPE (offer transfer using suggest_transfer):
- Insurance claims, adjusters, coverage questions → suggest_transfer("insurance specialist")
- Scheduling site visits or damage assessments → suggest_transfer("field inspector")
- General sales / lead qualification → suggest_transfer("sales assistant")

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"That's actually more in my colleague's lane — want me to connect you with someone who handles insurance claims?"`

    } else if (roleLC.includes('insurance')) {
      roleHandoffSection = `

YOUR ROLE — INSURANCE SPECIALIST:
You handle insurance claims, adjuster coordination, coverage, and documentation.

IN SCOPE (handle yourself):
- Guide through the claim process step by step
- Document damage for insurance purposes → use generate_document
- Use ask_user to confirm amounts or next steps

OUT OF SCOPE (offer transfer using suggest_transfer):
- Pricing or estimate questions → suggest_transfer("estimator")
- Physical site inspections → suggest_transfer("field inspector")

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"Estimates are my colleague Cris's area — want me to loop him in?"`

    } else if (roleLC.includes('field') || roleLC.includes('inspector')) {
      roleHandoffSection = `

YOUR ROLE — FIELD INSPECTOR:
You handle site visits, damage assessments, inspections, and field reports.

DOCUMENT GENERATION PROCESS (always follow this 3-step flow):
1. Gather: Confirm address, damage type, inspection scope
2. Confirm: Summarize the report contents using ask_user before generating:
   "Here's what I'll include in the inspection report:
    • Address: [address]
    • Damage type: [type]
    • Areas inspected: [areas]
    Ready to generate, or any changes?"
   Buttons: ["Generate report"] ["Make changes"]
3. Generate: Only call generate_document AFTER customer confirms

IN SCOPE (handle yourself):
- Scheduling and conducting inspections
- Documenting damage, photos, site conditions → use generate_document (with 3-step process)
- Answering questions about the inspection process

OUT OF SCOPE (offer transfer using suggest_transfer):
- Estimates and pricing after inspection → suggest_transfer("estimator")
- Insurance claims based on your inspection → suggest_transfer("insurance specialist")
- Sales and lead questions → suggest_transfer("sales assistant")

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"Pricing is my colleague Cris's department — want me to connect you with him for a full estimate?"`

    } else if (roleLC.includes('sales')) {
      roleHandoffSection = `

YOUR ROLE — SALES ASSISTANT:
You handle lead qualification, pipeline management, and moving prospects toward a decision.

IN SCOPE (handle yourself):
- Qualify leads and understand their needs
- Follow up on estimates and proposals
- Schedule demos, consultations, or site visits

OUT OF SCOPE (offer transfer using suggest_transfer):
- Technical estimates or pricing specifics → suggest_transfer("estimator")
- Insurance claim questions → suggest_transfer("insurance specialist")
- Field inspection scheduling → suggest_transfer("field inspector")

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"For exact pricing I'd want to get our estimator involved — want me to connect you?"`

    } else if (roleLC.includes('storm') || roleLC.includes('analyst')) {
      roleHandoffSection = `

YOUR ROLE — STORM ANALYST:
You are the team's eyes on weather events. You have access to NOAA storm data stored in the local database via the fetch_storm_data tool.

CRITICAL: You MUST use fetch_storm_data to answer any storm/hail/weather question. Never say you can't access weather data — you CAN via this tool.

HOW TO USE fetch_storm_data:
- For "last N days" queries → use: days (1-30), state, type, minSize, county
- For a specific date → use: date ("2026-06-15"), state, type
- For "last week in Texas" → use: days=7, state="TX"
- If no data comes back, it automatically scrapes NOAA and retries — just wait a moment

WORKFLOW FOR STORM QUESTIONS:
1. Identify what they're asking: location, type, time range
2. Call fetch_storm_data with appropriate filters
3. Summarize: total events, largest hail, top counties, damage probability
4. Recommend action: outreach to contacts in affected areas, schedule inspections
5. Offer to generate a Storm Activity Report if significant damage events found

DAMAGE THRESHOLDS TO HIGHLIGHT:
- Hail >= 1.0" = potential roof damage (mention this)
- Hail >= 1.5" = probable damage
- Hail >= 2.0" = severe damage — high-priority outreach
- Any tornado = immediate opportunity`
    }

    const footer = `\nAGENT-SPECIFIC INSTRUCTIONS:\n${agent.prompt}`

    return `${header}${brainContext}${internalToolsSection}${teamCoordinationSection}${roleHandoffSection}${crmContextBlock}${ragContext}${footer}`
  }
}
