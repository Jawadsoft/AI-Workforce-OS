import { Injectable, NotFoundException, Logger, InternalServerErrorException } from '@nestjs/common'
import { Readable } from 'stream'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { CrmService } from '../crm/crm.service'
import { CrmContextService } from '../crm/crm-context.service'
import { BrainService } from '../brain/brain.service'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { TasksService } from '../tasks/tasks.service'
import { TicketsService } from '../tickets/tickets.service'
import { EmailService } from '../email/email.service'
import { DocumentsService } from '../documents/documents.service'
import { StormService } from '../storm/storm.service'
import { MemoryService } from '../memory/memory.service'
import { SocialService } from '../social/social.service'

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
    description: 'Create an internal task ONLY when a staff member or owner explicitly asks to schedule a reminder, add a task, or set a follow-up (e.g. "add a task to call John tomorrow", "remind me to send the invoice"). Never call this automatically — use create_ticket for all customer interactions.',
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
    description: 'Create an approval request that needs sign-off before proceeding. Use when a decision requires manager or colleague approval (e.g. discounts, refunds, large purchases). Always set assignedToRole to the role keyword of the colleague who should approve it.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs to be approved' },
        description: { type: 'string', description: 'Details of what is being approved and why' },
        type: { type: 'string', description: 'Category e.g. budget, quote, refund, discount, schedule, hr' },
        assignedToRole: { type: 'string', description: 'Role keyword of the colleague who should approve this (e.g. "finance", "manager", "hr", "sales"). Resolved dynamically from registered agents.' },
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
    description: 'Generate a professional PDF document (estimate, proposal, report, invoice, etc.). Call this directly when the user asks for a document or proposal. Optionally use ask_user first to confirm details if the scope is unclear — but if the user has explicitly asked for a document, generate it immediately.',
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
    name: 'post_to_social',
    description: 'Generate and queue a social media post. Use when staff asks to post something, create social content, or share something on Facebook/Instagram/LinkedIn/X. The post goes into the approval queue. Always show the full generated post text back to the user so they can see what was created.',
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'What the post should be about — a job completed, a review received, a promotion, a team update, etc.' },
        platforms: { type: 'array', items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'x'] }, description: 'Which platforms to post to' },
        contentType: { type: 'string', enum: ['educational', 'promotional', 'story', 'team', 'general'], description: 'Type of content — educational tips, promotional offer, customer story, team highlight, or general' },
        scheduledAt: { type: 'string', description: 'ISO datetime to schedule the post e.g. "2026-07-01T09:00:00Z". Leave empty to post ASAP after approval.' },
      },
      required: ['brief', 'platforms'],
    },
  },
  {
    name: 'review_to_post',
    description: 'Turn a customer review or testimonial into social media posts. Use when staff shares a review or says something like "we got a 5-star review from John, post about it". Always show the generated posts back to the user.',
    parameters: {
      type: 'object',
      properties: {
        reviewText: { type: 'string', description: 'The full text of the customer review or testimonial' },
        reviewerName: { type: 'string', description: 'Customer name if available' },
        rating: { type: 'number', description: 'Star rating (1-5) if available' },
        platforms: { type: 'array', items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'x'] }, description: 'Which platforms to post to' },
      },
      required: ['reviewText', 'platforms'],
    },
  },
  {
    name: 'repurpose_content',
    description: 'Repurpose existing content (blog post, email, document, or any text) into platform-specific social media posts. Use when staff says "turn this blog post into social posts" or "repurpose this for Instagram". Always show the posts back.',
    parameters: {
      type: 'object',
      properties: {
        sourceContent: { type: 'string', description: 'The full source content to repurpose' },
        sourceType: { type: 'string', enum: ['blog', 'email', 'document', 'text'], description: 'Type of the source content' },
        platforms: { type: 'array', items: { type: 'string', enum: ['facebook', 'instagram', 'linkedin', 'x'] }, description: 'Target platforms' },
      },
      required: ['sourceContent', 'platforms'],
    },
  },
  {
    name: 'suggest_transfer',
    description: 'Offer to connect the customer with a colleague who is better suited to handle their request. Use this when the customer asks something outside your area of expertise. Shows the customer a button to switch to the right person.',
    parameters: {
      type: 'object',
      properties: {
        agentRole: { type: 'string', description: 'Role keyword of the colleague e.g. "estimator", "insurance specialist", "sales assistant", "field inspector"' },
        reason: { type: 'string', description: 'Brief natural-language reason why this colleague is better suited, e.g. "Our estimator handles all quotes and pricing"' },
        message: { type: 'string', description: 'Natural message to say to the customer before showing the transfer button, e.g. "That\'s actually my colleague\'s area — want me to connect you with them?"' },
      },
      required: ['agentRole', 'reason', 'message'],
    },
  },
  {
    name: 'create_ticket',
    description: 'Create an activity ticket to track any significant customer interaction, task, or follow-up that needs to be visible to the whole team. Use for: estimates sent, bookings made, complaints, jobs scheduled, HR actions, invoices raised, or any event another agent should know about. Always create a ticket rather than just making a mental note.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title e.g. "Estimate sent — John Smith 2-bed clean"' },
        description: { type: 'string', description: 'Full context of what happened and what this ticket is tracking' },
        type: { type: 'string', enum: ['ESTIMATE_SENT', 'JOB_BOOKED', 'FOLLOW_UP', 'COMPLAINT', 'HR', 'INVOICE', 'HANDYMAN', 'GENERAL'], description: 'Ticket category' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Priority level' },
        contactRef: { type: 'string', description: 'Customer name or identifier e.g. "John Smith"' },
        contactPhone: { type: 'string', description: 'Customer phone number if known' },
        contactEmail: { type: 'string', description: 'Customer email if known' },
        assignedAgentRole: { type: 'string', description: 'Role keyword of the team member who should OWN and action this ticket. Use your knowledge of the team to decide. Examples: "operations" for scheduling/rosters, "hr" for recruitment/staff, "finance" for invoices/payments, "sales" for quotes/leads. Leave empty only if YOU are personally responsible for the next action.' },
        nextAction: { type: 'string', description: 'What needs to happen next e.g. "Alex to confirm date and time with customer"' },
        followUpAt: { type: 'string', description: 'ISO datetime for when to follow up e.g. "2026-06-25T09:00:00Z"' },
      },
      required: ['title', 'type'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update a ticket status, next action, or add a progress note. Use whenever you take action on a ticket.',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'The ticket ID (last 6 chars shown in your pending tickets list)' },
        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED'], description: 'OPEN=not yet started, IN_PROGRESS=being worked on, COMPLETED=fully resolved (booking confirmed, estimate sent, job done — any final outcome)' },
        nextAction: { type: 'string', description: 'Updated next action description' },
        note: { type: 'string', description: 'Progress note to add to the ticket timeline' },
        assignedAgentRole: { type: 'string', description: 'Reassign to a team member by role keyword e.g. "operations", "hr", "finance", "sales"' },
        followUpAt: { type: 'string', description: 'Updated follow-up datetime in ISO format' },
      },
      required: ['ticketId'],
    },
  },
  {
    name: 'get_my_tickets',
    description: 'Get all open tickets assigned to you. Use at the start of a session or when the owner asks "what\'s pending", "what needs attention", "what tickets do you have". Shows status, priority, contact, and next actions.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_team_activity',
    description: 'Scan recent ticket activity across the whole team. Use this when the owner refers to a job, client, or request without giving full details — e.g. "the gutter replacement", "my client from yesterday", "the job you were assigned". Returns recent tickets for the entire team regardless of who they are assigned to, across all statuses.',
    parameters: {
      type: 'object',
      properties: {
        query:  { type: 'string',  description: 'Optional keyword to filter by — client name, job type, or description fragment e.g. "Morgan", "gutter replacement", "Seattle"' },
        status: { type: 'string',  enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'ALL'], description: 'Filter by status. Omit or use ALL to see everything recent.' },
        days:   { type: 'number',  description: 'How many days back to look (default: 7, max: 30)' },
      },
      required: [],
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get available service/cleaning slots for the next 7 days. Use when confirming a booking, scheduling a job, or checking crew availability. Returns real-time slot data with crew details.',
    parameters: {
      type: 'object',
      properties: {
        jobType: { type: 'string', description: 'Type of job e.g. "deep clean", "standard clean", "handyman", "inspection", "end of tenancy"' },
        preferredDate: { type: 'string', description: 'Preferred day or date the customer mentioned e.g. "Thursday", "25 June"' },
      },
      required: [],
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
    private readonly tickets: TicketsService,
    private readonly email: EmailService,
    private readonly documents: DocumentsService,
    private readonly storm: StormService,
    private readonly memory: MemoryService,
    private readonly social: SocialService,
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

  /**
   * Auto-wake an assigned agent: post briefing to their primary thread, trigger
   * autonomous reasoning, then post their response back into the originating
   * conversation so it appears in the active window of the agent who raised the ticket.
   * Runs in the background — fire and forget.
   */
  async autoWakeAgent(
    tenantId: string,
    agentId: string,
    ticketId: string,
    briefing: string,
    creatorAgentId: string,
    originatingConvId?: string,   // conversation where the ticket was created (e.g. Nora's window)
    _creatorAgentName?: string,
  ): Promise<void> {
    this.logger.log(`[autoWake] Starting for agent ${agentId}, ticket ${ticketId.slice(-6)}`)

    // Load ticket metadata upfront for context framing in the callback to Nora
    const ticketMeta = await this.prisma.activityTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, ticketNumber: true, title: true, description: true, conversationId: true },
    }).catch(() => null)

    // Stamp ticket as IN_PROGRESS and touch updatedAt — resets the cron cooldown
    await this.prisma.activityTicket.update({
      where: { id: ticketId },
      data: { status: 'IN_PROGRESS', updatedAt: new Date() },
    }).catch(() => {/* silently ignore for approval IDs */})

    // Step 1 — post briefing into specialist's own thread (backend only, never user-visible)
    const convId = await this.postBriefing(tenantId, agentId, briefing, 'TICKET_ASSIGNED')

    const agentRecord = await this.prisma.agent.findUnique({ where: { id: agentId } })
    if (!agentRecord) {
      this.logger.warn(`[autoWake] Agent ${agentId} not found — aborting`)
      return
    }

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

    // Fetch pending tickets for context injection
    const pendingTickets = await this.tickets.getForAgent(tenantId, agentId)
    const ticketsBlock = pendingTickets.length
      ? `\n\nYOUR PENDING TICKETS:\n${pendingTickets.map(t => `• ${t.id.slice(-6)} — "${t.title}" [${t.status}]${t.nextAction ? ` → ${t.nextAction}` : ''}`).join('\n')}`
      : ''

    // Fetch team roster for dynamic prompt
    const wakeTeamRoster = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { name: true, role: true, prompt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Fetch specialist's industry + tenant knowledge for the briefing topic
    const wakeRagContext = await this.knowledge.retrieveContext(
      agentId,
      briefing.slice(0, 400),  // use first 400 chars of briefing as the query
      mergedSettings.industry,
      agentRecord.role,
      3,
    )

    // isSpecialist=true → strips create_ticket — prevents duplicate ticket creation during auto-wake
    const systemPrompt = this.buildFullSystemPrompt(agentRecord, mergedSettings, brainContext, '', wakeRagContext, true, ticketsBlock, wakeTeamRoster)

    try {
      // Step 2 — specialist reasons and acts (depth=1, no create_ticket, no further handoffs)
      const response = await this.runWithToolDispatch(
        tenantId, agentRecord, systemPrompt,
        [{ role: 'user' as const, content: briefing }],
        undefined,   // defaultCustomerId
        undefined,   // emit — pure backend work, no streaming
        1,           // handoffDepth = 1 — prevent further routing
        undefined,   // handoffCountRef
        convId,      // specialist's own thread
        'INTERNAL',
      )

      if (!response?.trim()) {
        this.logger.warn(`[autoWake] Agent ${agentRecord.name} produced no response`)
        return
      }

      // Step 3 — save specialist's work to their OWN thread as an internal briefing
      // (briefingType = 'TICKET_BRIEF' keeps it out of the main chat tab)
      await this.prisma.message.create({
        data: { conversationId: convId, role: 'ASSISTANT', content: response, briefingType: 'TICKET_BRIEF' },
      })
      await this.prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } })

      // Step 4 — surface the response in the originating conversation (Nora's active window).
      // The ticket stays IN_PROGRESS — it is the assigned agent's responsibility to call
      // update_ticket(COMPLETED) once they are satisfied the work is fully done.
      if (originatingConvId && originatingConvId !== convId) {
        const ticketRef   = ticketMeta ? `Ticket #${String(ticketMeta.ticketNumber ?? '').padStart(4, '0')} (${ticketMeta.id.slice(-6)})` : `Ticket ${ticketId.slice(-6)}`
        const ticketTitle = ticketMeta?.title ? ` — "${ticketMeta.title}"` : ''
        const contextFrame = [
          `📬 **[${agentRecord.name}]** responded to ${ticketRef}${ticketTitle}`,
          `↳ Ticket is still IN_PROGRESS. ${agentRecord.name} will mark it COMPLETED when the work is fully done.`,
          ``,
        ].join('\n')

        await this.prisma.message.create({
          data: {
            conversationId: originatingConvId,
            role: 'ASSISTANT',
            content: `${contextFrame}${response}`,
            briefingType: 'SPECIALIST_UPDATE',
          },
        })
        await this.prisma.conversation.update({
          where: { id: originatingConvId },
          data: { updatedAt: new Date() },
        })
        this.logger.log(`[autoWake] ${agentRecord.name}'s response surfaced in originating conv ${originatingConvId.slice(-6)} — ticket ${ticketId.slice(-6)} remains IN_PROGRESS`)
      }

      this.logger.log(`[autoWake] ${agentRecord.name} completed work (${response.length} chars)`)

    } catch (e: any) {
      this.logger.warn(`[autoWake] Reasoning failed for ${agentRecord.name}: ${e.message}`)
    }
  }

  /** Post an email briefing to the Tier 1 (intake/primary) agent for the tenant.
   *  Tries Tier 1 role keywords first; falls back to the first active agent. */
  async postEmailBriefing(tenantId: string, content: string): Promise<void> {
    const allActive = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
    if (!allActive.length) return

    // Prefer Tier 1 agents (intake, receptionist, executive assistant, customer success, etc.)
    const tier1Keywords = ['intake', 'receptionist', 'executive', 'assistant', 'customer success', 'front desk', 'client service']
    const tier1Agent = allActive.find(a =>
      tier1Keywords.some(k => a.role.toLowerCase().includes(k))
    ) ?? allActive[0]  // fallback to first if no Tier 1 found

    await this.postBriefing(tenantId, tier1Agent.id, content, 'email_briefing')
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

    // Fetch the most recent 14 messages in reverse order, then re-sort ascending
    // so the LLM sees them oldest-first.  Using desc+take ensures we always get
    // the LATEST messages (not the oldest) when conversations exceed the window.
    // 14 keeps multi-customer context tight — each customer typically needs 4-6 turns.
    const historyRaw = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 14,
    })
    const history = historyRaw.reverse()

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

    // ── RAG + Memory + ticket fetch (all in parallel) ──────────────
    const [ragContext, memoryContext, ticketsBlock, teamRoster] = await Promise.all([
      this.knowledge.retrieveContext(conv.agent.id, content, mergedSettings.industry, conv.agent.role),
      this.memory.searchMemory(conv.agent.id, tenantId, content),
      this.tickets.buildPromptBlock(tenantId, conv.agent.id, conversationId),
      this.prisma.agent.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { name: true, role: true, prompt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    // ── Build enriched system prompt ──────────────────────────────
    const enrichedSystemPrompt = this.buildFullSystemPrompt(conv.agent, mergedSettings, brainContext, crmContextBlock, ragContext + memoryContext, false, ticketsBlock, teamRoster)

    // ── Tool dispatch loop ────────────────────────────────────────
    // Always route through runWithToolDispatch — it falls back to plain chat
    // if no tools are available, and ensures ticket + internal tools work for ALL agents.
    const rawMessages = history
      .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
      .filter((m) => !(m.role === 'ASSISTANT' && m.content.trim().includes('__tool__')))
      .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant' as 'user' | 'assistant', content: m.content }))

    // ── History loop-breaker ───────────────────────────────────────────
    // When the LLM repeats the same response to different user messages (stuck loop),
    // replace stale duplicate assistant messages so the LLM cannot follow that wrong pattern.
    //
    // Uses word-overlap similarity (not exact match) so it catches responses that say
    // the same thing in different words (e.g. same price range, same booking details).
    const similarityRatio = (a: string, b: string): number => {
      const words = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter(w => w.length > 3))
      const wa = words(a.slice(0, 400))
      const wb = words(b.slice(0, 400))
      if (!wa.size || !wb.size) return 0
      const overlap = [...wa].filter(w => wb.has(w)).length
      return overlap / Math.min(wa.size, wb.size)
    }

    const messages = rawMessages.map((m, i) => {
      if (m.role !== 'assistant' || i < 2) return m
      // Check against ALL prior assistant messages in a 6-message window
      const prior = rawMessages.slice(Math.max(0, i - 6), i).filter(p => p.role === 'assistant')
      const isStuckLoop = prior.some(p => similarityRatio(m.content, p.content) > 0.65)
      if (isStuckLoop) {
        return { role: 'assistant' as const, content: '[Previous response was incorrect or stale — new information has been provided. Respond fresh to the current message with updated details.]' }
      }
      return m
    })

    let aiReply = ''
    try {
      const convSource = (conv.channel === 'WIDGET') ? 'WIDGET' : 'INTERNAL'
      aiReply = await this.runWithToolDispatch(tenantId, conv.agent, enrichedSystemPrompt, messages, callerCustomerId, undefined, 0, undefined, conversationId, convSource)
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
    conversationId?: string,
    conversationSource?: string,
  ): Promise<string> {
    // Specialists (depth >= 1) cannot handoff further or proactively create tasks — prevents infinite loops
    const isSpecialist = handoffDepth > 0
    // Track handoffs across multiple tool rounds in this conversation turn
    const hcRef = handoffCountRef ?? { count: 0 }
    // Guard against duplicate ticket creation within a single conversation turn
    let ticketCreatedThisTurn = false
    // Intake agents silently relay via handoff_to_agent.
    // All other agents offer transfers via suggest_transfer — never silent relay.
    const roleLC = (agent.role ?? '').toLowerCase()

    // ── Role classification — purely keyword-based, no hierarchy ────────
    // Intake: customer-facing primary contact agents
    const isIntakeAgent = roleLC.includes('intake') || roleLC.includes('receptionist') || roleLC.includes('customer') ||
                          roleLC.includes('executive') || roleLC.includes('assistant') || roleLC.includes('front desk') ||
                          roleLC.includes('success manager') || roleLC.includes('client service')
    // Ops: internal coordination / scheduling agents
    const isOpsAgent    = roleLC.includes('operations') || roleLC.includes('coordinator') || roleLC.includes('office manager') ||
                          roleLC.includes('admin manager') || roleLC.includes('project manager') || roleLC.includes('ops lead') ||
                          roleLC.includes('scheduling')
    const isStormAnalyst = roleLC.includes('storm') || roleLC.includes('analyst') || agent.name?.toLowerCase().includes('arturo')

    // Ticket tools — available to all agent types
    const ticketToolNames = ['create_ticket', 'update_ticket', 'get_my_tickets', 'get_team_activity']
    // Scheduling tool — available to ops and non-intake agents (everyone except pure intake)
    const schedulingTools = (!isIntakeAgent || isOpsAgent) ? ['get_available_slots'] : []

    // create_internal_task only injected when staff explicitly requests a task/reminder
    const userWantsTask = messages.length > 0 &&
      /\b(create\s+a?\s*task|add\s+a?\s*task|schedule\s+a?\s*reminder|remind\s+me|add\s+a?\s*reminder|set\s+a?\s*reminder)\b/i
        .test(messages[messages.length - 1]?.content ?? '')
    const taskTools = userWantsTask ? ['create_internal_task'] : []

    // social media tools — only for agents with the post_to_social tool flag
    const agentTools = agent.tools as string[] ?? []
    const socialTools = agentTools.includes('post_to_social')
      ? ['post_to_social', 'review_to_post', 'repurpose_content']
      : []

    // Specialists can update/view tickets but NEVER create new ones (prevents duplicates during auto-wake/handoff)
    const specialistTicketTools = ['update_ticket', 'get_my_tickets', 'get_team_activity']

    const internalToolNames = isSpecialist
      // Called via handoff or auto-wake: update existing tickets only, no create_ticket
      ? ['reply_to_widget_session', 'contact_customer', 'generate_document', 'ask_user', ...specialistTicketTools, ...schedulingTools, ...socialTools]
      : isIntakeAgent
        // Intake agent: silent relay + explicit transfer when user requests it
        ? ['request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'handoff_to_agent', 'suggest_transfer', 'ask_user', ...ticketToolNames, ...taskTools, ...socialTools]
        : isStormAnalyst
          // Storm analyst: gets storm data tool + standard specialist tools
          ? ['request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'suggest_transfer', 'ask_user', 'fetch_storm_data', ...ticketToolNames, ...taskTools, ...socialTools]
          // Specialist agent (estimator, inspector, etc.): offer transfers, no silent relay
          : ['request_approval', 'reply_to_widget_session', 'contact_customer', 'generate_document', 'suggest_transfer', 'ask_user', ...ticketToolNames, ...schedulingTools, ...taskTools, ...socialTools]

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
            // Resolve assignedToRole → actual agent
            let approvalAssignedAgent: { id: string; name: string; role: string } | null = null
            if (params.assignedToRole) {
              const roleKeyword = (params.assignedToRole as string).toLowerCase()
              approvalAssignedAgent = await this.prisma.agent.findFirst({
                where: {
                  tenantId,
                  status: 'ACTIVE',
                  OR: [
                    { role: { contains: roleKeyword, mode: 'insensitive' } },
                    { name: { contains: roleKeyword, mode: 'insensitive' } },
                  ],
                  NOT: { id: agent.id },
                },
                select: { id: true, name: true, role: true },
              })
            }

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

            const assignedTo = approvalAssignedAgent?.name ?? 'the manager'

            // Auto-wake the assigned agent to review and action the approval
            if (approvalAssignedAgent) {
              const briefing = [
                `📝 **Approval request from ${agent.name}**`,
                `"${approval.title}"`,
                `Type: ${approval.type} | Status: PENDING`,
                approval.description ? `Details: ${approval.description}` : '',
                ``,
                `INSTRUCTIONS:`,
                `1. Review this approval request.`,
                `2. If you can approve it, proceed and update the relevant ticket if one exists.`,
                `3. Inform ${agent.name} of your decision via update_ticket or by noting your response.`,
                `4. DO NOT contact the customer directly — ${agent.name} will handle that.`,
              ].filter(Boolean).join('\n')

              this.logger.log(`[autoWake] Waking ${approvalAssignedAgent.name} for approval: "${approval.title}"`)
              setImmediate(() => {
                this.autoWakeAgent(
                  tenantId,
                  approvalAssignedAgent!.id,
                  approval.id,
                  briefing,
                  agent.id,
                  conversationId ?? undefined,
                  agent.name,
                ).catch(e =>
                  this.logger.warn(`[autoWake] Approval wake failed for ${approvalAssignedAgent!.id}: ${e.message}`)
                )
              })
            }

            return `Approval request created: "${approval.title}" — assigned to ${assignedTo} for review (ID: ${approval.id})`
          } catch (err: any) {
            return `Failed to create approval: ${err.message}`
          }
        }

        // ── Create activity ticket ─────────────────────────
        if (toolName === 'create_ticket') {
          // Block duplicate ticket creation within the same conversation turn only.
          // We intentionally do NOT block across turns — the owner-manages-multiple-customers
          // scenario means multiple tickets can legitimately exist for the same conversation
          // (e.g. Rio's inspection ticket + Jack's gutter ticket in the same Nora thread).
          // Per-conversation duplicate prevention is handled by LLM guidance in buildPromptBlock.
          if (ticketCreatedThisTurn) {
            return `A ticket was already created in this response. Use update_ticket to modify the existing one instead of creating a duplicate.`
          }
          try {
            // Resolve assignedAgentRole → actual agent ID
            let resolvedAssignedAgentId: string | undefined
            if (params.assignedAgentRole) {
              const roleKeyword = (params.assignedAgentRole as string).toLowerCase()
              const matched = await this.prisma.agent.findFirst({
                where: {
                  tenantId,
                  status: 'ACTIVE',
                  OR: [
                    { role: { contains: roleKeyword, mode: 'insensitive' } },
                    { name: { contains: roleKeyword, mode: 'insensitive' } },
                  ],
                  NOT: { id: agent.id }, // don't assign to self via role
                },
                select: { id: true, name: true, role: true },
              })
              if (matched) {
                resolvedAssignedAgentId = matched.id
              }
            }

            const ticket = await this.tickets.create(tenantId, agent.id, agent.name, {
              title: params.title,
              subject: params.title,
              description: params.description,
              type: params.type,
              priority: params.priority,
              source: conversationSource ?? 'INTERNAL',
              conversationId: conversationId ?? undefined,
              contactRef: params.contactRef,
              contactPhone: params.contactPhone,
              contactEmail: params.contactEmail,
              assignedAgentId: resolvedAssignedAgentId,
              nextAction: params.nextAction,
              followUpAt: params.followUpAt,
            })
            const assignedTo = ticket.assignedAgent?.name ?? 'you'
            ticketCreatedThisTurn = true  // prevent duplicate ticket creation in subsequent tool rounds
            emit?.({ action_card: { type: 'ticket', id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, contactRef: ticket.contactRef } })
            // Embed ticket for intent search (async, non-blocking)
            this.memory.embedTicket(ticket.id).catch(() => {})

            // Auto-briefing + auto-wake for assigned agent (fire and forget)
            if (ticket.assignedAgent && ticket.assignedAgent.id !== agent.id) {
              const ticketNum = String(ticket.ticketNumber ?? '').padStart(4, '0')
              const ticketShortId = ticket.id.slice(-6)
              const briefing = [
                `📋 **New ticket assigned to you by ${agent.name}**`,
                `Ticket #${ticketNum} (ID: ${ticketShortId}): "${ticket.title}"`,
                `Status: ${ticket.status} | Priority: ${ticket.priority}`,
                ticket.contactRef ? `Contact: ${ticket.contactRef}` : '',
                ticket.contactPhone ? `Phone: ${ticket.contactPhone}` : '',
                params.description ? `Details: ${params.description}` : '',
                ticket.nextAction ? `Action required: ${ticket.nextAction}` : '',
                ticket.followUpAt ? `Follow-up by: ${new Date(ticket.followUpAt).toLocaleDateString('en-GB')}` : '',
                ``,
                `INSTRUCTIONS:`,
                `1. Action this task using your available tools (e.g. get_available_slots to find dates).`,
                `2. Call update_ticket with ticketId "${ticketShortId}" to record your findings and set the correct status:`,
                `   • Started working on it → IN_PROGRESS`,
                `   • Fully resolved (booking confirmed, estimate sent, done) → COMPLETED`,
                `3. DO NOT create a new ticket — update the existing one (${ticketShortId}).`,
                `4. DO NOT contact the customer directly — ${agent.name} will handle that.`,
                `5. Your response here will be automatically forwarded to ${agent.name}.`,
              ].filter(Boolean).join('\n')

              this.logger.log(`[autoWake] Waking ${ticket.assignedAgent.name} for ticket #${ticketNum} (${ticketShortId})`)
              setImmediate(() => {
                this.autoWakeAgent(
                  tenantId,
                  ticket.assignedAgent!.id,
                  ticket.id,
                  briefing,
                  agent.id,
                  conversationId ?? undefined,   // originating conversation — response posted back here
                  agent.name,
                ).catch(e =>
                  this.logger.warn(`[autoWake] Failed for agent ${ticket.assignedAgent!.id}: ${e.message}`)
                )
              })
            }

            return `Ticket created: "${ticket.title}" (ID: ${ticket.id.slice(-6)}) — Assigned to: ${assignedTo}, Status: ${ticket.status}, Priority: ${ticket.priority}${ticket.followUpAt ? `, Follow-up: ${new Date(ticket.followUpAt).toLocaleDateString('en-GB')}` : ''}`
          } catch (err: any) {
            return `Failed to create ticket: ${err.message}`
          }
        }

        // ── Update activity ticket ─────────────────────────
        if (toolName === 'update_ticket') {
          try {
            // Support short 6-char ID suffix lookup
            let ticketId = params.ticketId
            if (ticketId.length === 6) {
              const found = await this.prisma.activityTicket.findFirst({
                where: { tenantId, id: { endsWith: ticketId } },
              })
              if (found) ticketId = found.id
            }
            // Resolve assignedAgentRole → actual agent ID for reassignment
            let resolvedAssignedAgentId: string | undefined = params.assignedAgentId
            if (params.assignedAgentRole && !resolvedAssignedAgentId) {
              const roleKeyword = (params.assignedAgentRole as string).toLowerCase()
              const matched = await this.prisma.agent.findFirst({
                where: {
                  tenantId,
                  status: 'ACTIVE',
                  OR: [
                    { role: { contains: roleKeyword, mode: 'insensitive' } },
                    { name: { contains: roleKeyword, mode: 'insensitive' } },
                  ],
                },
                select: { id: true, name: true },
              })
              if (matched) resolvedAssignedAgentId = matched.id
            }
            const ticket = await this.tickets.update(tenantId, ticketId, agent.id, agent.name, {
              status: params.status,
              nextAction: params.nextAction,
              note: params.note,
              assignedAgentId: resolvedAssignedAgentId,
              followUpAt: params.followUpAt,
            })
            const assignedTo = ticket.assignedAgent?.name
            const result = `Ticket "${ticket.title}" updated — Status: ${ticket.status}${assignedTo ? `, Assigned to: ${assignedTo}` : ''}${params.note ? `, Note: "${params.note}"` : ''}`
            // Re-embed ticket so intent search reflects latest state (async, non-blocking)
            this.memory.embedTicket(ticket.id).catch(() => {})

            // Auto-notify creator when a different agent updates/completes the ticket
            const creatorId = (ticket as any).createdBy?.id ?? (ticket as any).createdByAgentId
            if (creatorId && creatorId !== agent.id) {
              const ticketNum = String((ticket as any).ticketNumber ?? '').padStart(4, '0')
              const notifyMsg = [
                `📬 **Update on ticket #${ticketNum} — "${ticket.title}"**`,
                `Updated by: **${agent.name}**`,
                `New status: **${ticket.status}**`,
                params.note ? `Note: ${params.note}` : '',
                assignedTo && assignedTo !== agent.name ? `Now assigned to: ${assignedTo}` : '',
                ticket.nextAction ? `Next action: ${ticket.nextAction}` : '',
              ].filter(Boolean).join('\n')

              setImmediate(() => {
                this.postBriefing(tenantId, creatorId, notifyMsg, 'TICKET_UPDATE').catch(e =>
                  this.logger.warn(`auto-notify to creator ${creatorId} failed: ${e.message}`)
                )
              })
            }

            return result
          } catch (err: any) {
            return `Failed to update ticket: ${err.message}`
          }
        }

        // ── Get my pending tickets ─────────────────────────
        if (toolName === 'get_my_tickets') {
          try {
            const myTickets = await this.tickets.getForAgent(tenantId, agent.id)
            if (!myTickets.length) return 'You have no pending tickets at the moment.'
            const lines = myTickets.map(t => {
              const due = t.followUpAt ? ` | Follow-up: ${new Date(t.followUpAt).toLocaleDateString('en-GB')}` : ''
              const contact = t.contactRef ? ` | Contact: ${t.contactRef}` : ''
              return `• [${t.priority}] ${t.id.slice(-6)} — "${t.title}" (${t.status})${contact}${due}${t.nextAction ? `\n  Next: ${t.nextAction}` : ''}`
            })
            return `Your pending tickets (${myTickets.length}):\n${lines.join('\n')}`
          } catch (err: any) {
            return `Failed to fetch tickets: ${err.message}`
          }
        }

        // ── Scan team activity across all agents ───────────────
        if (toolName === 'get_team_activity') {
          try {
            const days    = Math.min(Number(params.days ?? 7), 30)
            const since   = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            const statusFilter = (params.status as string | undefined)
            const query   = (params.query as string | undefined)?.trim().toLowerCase()

            const teamTickets = await this.prisma.activityTicket.findMany({
              where: {
                tenantId,
                createdAt: { gte: since },
                ...(statusFilter && statusFilter !== 'ALL' ? { status: statusFilter as any } : {}),
                ...(query ? {
                  OR: [
                    { title:       { contains: query, mode: 'insensitive' } },
                    { description: { contains: query, mode: 'insensitive' } },
                    { contactRef:  { contains: query, mode: 'insensitive' } },
                    { notes:       { contains: query, mode: 'insensitive' } },
                  ],
                } : {}),
              },
              include: {
                assignedAgent: { select: { name: true, role: true } },
                createdBy:     { select: { name: true } },
              },
              orderBy: { updatedAt: 'desc' },
              take: 20,
            })

            if (!teamTickets.length) {
              return `No team activity found${query ? ` matching "${query}"` : ''} in the last ${days} day${days !== 1 ? 's' : ''}.`
            }

            const lines = (teamTickets as any[]).map(t => {
              const assigned = t.assignedAgent ? `${(t.assignedAgent.name as string).split('—')[0].trim()} (${t.assignedAgent.role})` : 'Unassigned'
              const contact  = t.contactRef ? ` | Client: ${t.contactRef}` : ''
              const next     = t.nextAction  ? `\n    Next: ${t.nextAction}` : ''
              const age      = Math.round((Date.now() - new Date(t.updatedAt).getTime()) / 60000)
              const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`
              return `• #${t.id.slice(-6)} [${t.status}] "${t.title}"${contact} | Assigned: ${assigned} | Updated: ${ageLabel}${next}`
            })

            return `Team activity — last ${days} day${days !== 1 ? 's' : ''} (${teamTickets.length} ticket${teamTickets.length !== 1 ? 's' : ''}):\n${lines.join('\n')}`
          } catch (err: any) {
            return `Failed to fetch team activity: ${err.message}`
          }
        }

        // ── Get available slots (mock — replace with calendar API later) ──
        if (toolName === 'get_available_slots') {
          const jobType = (params.jobType as string ?? '').toLowerCase()
          const preferred = (params.preferredDate as string ?? '').toLowerCase()

          // Generate slots dynamically from today so they never expire
          const slots: { date: string; day: string; time: string; crew: string; suitable: string[] }[] = []
          const now = new Date()
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

          for (let d = 1; d <= 7; d++) {
            const date = new Date(now)
            date.setDate(now.getDate() + d)
            const dow = date.getDay()
            if (dow === 0) continue // skip Sunday
            const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            const dayStr = dayNames[dow]

            // Morning slot — suitable for inspections, assessments, shorter jobs
            slots.push({ date: dateStr, day: dayStr, time: '09:00–11:00', crew: 'Team A', suitable: ['inspection', 'site visit', 'assessment', 'consultation', 'repair', 'replacement', 'installation', 'gutter', 'roof', 'window', 'door'] })
            // Afternoon slot — weekdays only, suitable for larger jobs
            if (dow >= 1 && dow <= 5) {
              slots.push({ date: dateStr, day: dayStr, time: '13:00–16:00', crew: 'Team B', suitable: ['replacement', 'installation', 'large job', 'full replacement', 'gutter', 'roof', 'siding', 'deck', 'repair'] })
            }
          }

          // Filter by job type suitability — only exclude if there is a clear mismatch
          // If jobType is empty or no suitable tag overlaps at all, return all slots anyway
          const filtered = jobType
            ? (() => {
                const matched = slots.filter(s => s.suitable.some(t => jobType.includes(t) || t.includes(jobType)))
                return matched.length > 0 ? matched : slots  // fall back to all slots if no match
              })()
            : slots

          // Prefer slots matching requested day
          const sorted = preferred
            ? [...filtered.filter(s => s.day.toLowerCase().includes(preferred) || s.date.toLowerCase().includes(preferred)), ...filtered.filter(s => !s.day.toLowerCase().includes(preferred) && !s.date.toLowerCase().includes(preferred))]
            : filtered

          const top = sorted.slice(0, 5)
          if (!top.length) {
            return `No suitable slots found for "${jobType}" in the next 7 days. All crews are currently allocated.`
          }

          const lines = top.map((s, i) => `${i + 1}. ${s.day} ${s.date}, ${s.time} — ${s.crew}`)
          return `Available slots${jobType ? ` for ${jobType}` : ''}:\n${lines.join('\n')}\n\nNote: Confirm the customer's preferred slot and update the ticket to SCHEDULED once agreed.`
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
            const contextWords = (params.contextSummary ?? params.reason ?? '')
              .toLowerCase().split(/\W+/).filter(w => w.length > 3)

            // Fetch all active agents ordered by seniority (oldest first = tiebreaker)
            const allAgents = await this.prisma.agent.findMany({
              where: { tenantId, status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            })

            // Score every agent by capability match — purely role/scope based, no hierarchy
            const scored = allAgents
              .filter(a => a.id !== agent.id)  // exclude self
              .map(a => {
                const aRoleLC  = a.role.toLowerCase()
                const aNameLC  = a.name.toLowerCase()
                const aPromptLC = (a.prompt ?? '').toLowerCase()
                let score = 0

                // Role keyword match (most important)
                if (aRoleLC === roleKeyword)              score += 4  // exact match
                else if (aRoleLC.includes(roleKeyword))  score += 3  // role contains keyword
                else if (aNameLC.includes(roleKeyword))  score += 1  // name contains keyword

                // Context/scope match — does their prompt mention the topic words?
                const promptMatches = contextWords.filter(w => aPromptLC.includes(w)).length
                score += Math.min(promptMatches, 3)  // up to +3 for topic overlap

                return { agent: a, score }
              })
              .filter(s => s.score > 0)
              .sort((a, b) => b.score - a.score)

            const target = scored[0]?.agent ?? null
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
            const handoffContext = `\n\n[HANDOFF FROM ${agent.name.toUpperCase()}]: ${params.contextSummary}\nReason for handoff: ${params.reason}\n\nIMPORTANT: You are responding internally to a colleague, NOT to the customer. Do NOT call ask_user — work with the information you have RIGHT NOW and give a specific, useful answer immediately. If you don't have all the details, give a realistic range or ballpark based on your expertise and the knowledge base. Your response will be rewritten by ${agent.name} before the customer sees it. Be concrete — numbers, steps, timelines — not "I'll need more info first".`

            // Fetch specialist's RAG context (tenant docs + industry knowledge for their role)
            const specialistRag = await this.knowledge.retrieveContext(
              target.id,
              params.contextSummary ?? params.reason ?? '',
              mergedSettings.industry,
              target.role,
              3,
            )
            const specialistPrompt = this.buildFullSystemPrompt(target, mergedSettings, brainContext, handoffContext, specialistRag, true)

            // Run the specialist agent — depth+1 prevents further handoffs and loops.
            // Pass undefined as emit so the specialist's tool events (ask_user, action_cards)
            // never reach the user's chat stream. Only Nora's final rewrite is user-visible.
            const specialistReply = await this.runWithToolDispatch(
              tenantId, target, specialistPrompt, messages, defaultCustomerId, undefined, handoffDepth + 1, hcRef, conversationId, conversationSource,
            )

            // Create a consultation ticket (OPEN → immediately COMPLETED inline).
            // This gives Nora a trackable record of every consultation, ties it to the
            // conversationId so she can reference it, and keeps the ticket lifecycle clean:
            // one question = one ticket = one response = COMPLETED.
            if (conversationId) {
              const shortName = (n: string) => n.split('—')[0].split('(')[0].trim()
              const consultTitle = `Consulted ${shortName(target.name)}: ${(params.contextSummary ?? params.reason ?? '').slice(0, 80)}`
              const consultTicket = await this.tickets.create(tenantId, agent.id, agent.name, {
                title: consultTitle,
                description: params.contextSummary ?? params.reason,
                type: 'FOLLOW_UP',
                priority: 'NORMAL',
                source: conversationSource ?? 'INTERNAL',
                conversationId,
                assignedAgentId: target.id,
                nextAction: `Reply from ${shortName(target.name)}: ${specialistReply.slice(0, 300)}`,
              }).catch(() => null)

              if (consultTicket) {
                // Log the Q&A in the ticket notes and leave it IN_PROGRESS.
                // The specialist must call update_ticket(COMPLETED) when fully done.
                await this.prisma.activityTicket.update({
                  where: { id: consultTicket.id },
                  data: {
                    notes: `Q: ${params.contextSummary ?? params.reason}\n\nA (${shortName(target.name)}): ${specialistReply.slice(0, 600)}`,
                  },
                }).catch(() => {})
                this.memory.embedTicket(consultTicket.id).catch(() => {})
              }

              // Store episodic memory for the SPECIALIST so they remember this consultation
              const specialistSummaryText = `I was consulted by ${shortName(agent.name)} about: ${params.contextSummary}. My response: ${specialistReply.slice(0, 400)}`
              this.memory.storeHandoffMemory(
                tenantId, target.id, conversationId, specialistSummaryText,
              ).catch(() => {})
            }

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
            // Include context so Nora knows which conversation/topic this answer belongs to.
            return `[TEAM INPUT from ${target.name.split('—')[0].trim()} | Regarding: "${(params.contextSummary ?? params.reason ?? '').slice(0, 80)}" | Conversation: ${conversationId?.slice(-6) ?? 'current'}]\nRewrite this answer in your own natural voice. Mention the specialist's first name naturally (e.g. "[Name] just got back to me!"). If further work is needed for this customer, create a new ticket.${transferHint}\n\n${specialistReply}`
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

            // Reassign the conversation ticket to the target agent so they see it immediately
            if (target && conversationId) {
              const convTicket = await this.prisma.activityTicket.findFirst({
                where: { conversationId, tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
                orderBy: { createdAt: 'desc' },
              })
              if (convTicket) {
                const transferNote = `[Transfer from ${agent.name.split('—')[0].trim()} to ${targetFirstName}] Reason: ${params.reason}`
                const existingNotes = convTicket.notes ?? ''
                await this.prisma.activityTicket.update({
                  where: { id: convTicket.id },
                  data: {
                    assignedAgentId: target.id,
                    notes: existingNotes ? `${existingNotes}\n\n${transferNote}` : transferNote,
                    status: 'IN_PROGRESS',
                  },
                })
                this.memory.embedTicket(convTicket.id).catch(() => {})
              }
            }

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

        // ── Social media tool ──────────────────────────────
        if (toolName === 'post_to_social') {
          try {
            const drafts = await this.social.generatePosts({
              tenantId,
              agentId: agent.id,
              brief: params.brief,
              platforms: params.platforms ?? ['facebook'],
              contentType: params.contentType,
            })
            const saved = await Promise.all(
              drafts.map((draft) =>
                this.social.createPost(tenantId, {
                  agentId: agent.id,
                  platform: draft.platform,
                  content: draft.content,
                  imageUrl: draft.imageUrl ?? undefined,
                  imagePrompt: draft.imagePrompt ?? undefined,
                  contentType: draft.contentType,
                  scheduledAt: params.scheduledAt ? new Date(params.scheduledAt) : undefined,
                  requireApproval: true,
                }),
              ),
            )
            const lines = saved.map((p: any) => {
              const platformLabel = p.platform.charAt(0).toUpperCase() + p.platform.slice(1)
              return `**${platformLabel}** (queued for approval):\n"${p.content}"\n${p.imageUrl ? `📸 Image: ${p.imageUrl}` : ''}`
            })
            return `Here are the generated social media posts — they've been sent to the approval queue:\n\n${lines.join('\n\n')}\n\nYou can review, edit, approve or schedule them in the **Social Media** section of the dashboard.`
          } catch (err: any) {
            if (err.message?.includes('not enabled')) return `Social media feature is not enabled for your account. Contact your administrator.`
            return `Error creating social posts: ${err.message}`
          }
        }

        if (toolName === 'review_to_post') {
          try {
            const saved = await this.social.reviewToPost(tenantId, {
              agentId: agent.id,
              reviewText: params.reviewText,
              reviewerName: params.reviewerName,
              rating: params.rating,
              platforms: params.platforms ?? ['facebook'],
            })
            const lines = saved.map((p: any) => {
              const platformLabel = p.platform.charAt(0).toUpperCase() + p.platform.slice(1)
              return `**${platformLabel}** (queued for approval):\n"${p.content}"`
            })
            const reviewer = params.reviewerName ? ` from ${params.reviewerName}` : ''
            return `Here are the posts based on the customer review${reviewer}:\n\n${lines.join('\n\n')}\n\nReview and approve them in the **Social Media** section.`
          } catch (err: any) {
            return `Error creating review posts: ${err.message}`
          }
        }

        if (toolName === 'repurpose_content') {
          try {
            const saved = await this.social.repurposeContent(tenantId, {
              agentId: agent.id,
              sourceContent: params.sourceContent,
              sourceType: params.sourceType ?? 'text',
              platforms: params.platforms ?? ['facebook'],
            })
            const lines = saved.map((p: any) => {
              const platformLabel = p.platform.charAt(0).toUpperCase() + p.platform.slice(1)
              return `**${platformLabel}** (queued for approval):\n"${p.content}"`
            })
            return `Here are the repurposed posts for each platform:\n\n${lines.join('\n\n')}\n\nReview and approve them in the **Social Media** section.`
          } catch (err: any) {
            return `Error repurposing content: ${err.message}`
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
    attachments?: { url: string; name: string; mimeType: string }[],
  ) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { agent: true },
    })
    if (!conv) throw new Error('Conversation not found')

    // When a file is attached but no message typed, auto-generate a helpful instruction
    const hasAttachments = attachments && attachments.length > 0
    const isImage = hasAttachments && attachments![0].mimeType.startsWith('image/')
    const effectiveContent = content.trim()
      || (hasAttachments
        ? isImage
          ? 'Please look at this image and describe what you see. Provide any relevant insights or recommendations based on its content.'
          : `Please read the attached document "${attachments![0].name}" and give me a summary of the key points.`
        : '')

    // Save user message (with attachments metadata)
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'USER',
        content: effectiveContent,
        attachments: attachments ?? [],
      },
    })

    // Get most recent 14 messages (desc + reverse = latest messages in chronological order)
    const historyRaw2 = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 14,
    })
    const history = historyRaw2.reverse()

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

    const [ragContext, memoryContext, streamTicketsBlock, streamTeamRoster] = await Promise.all([
      this.knowledge.retrieveContext(conv.agent.id, content, mergedSettings.industry, conv.agent.role),
      this.memory.searchMemory(conv.agent.id, tenantId, content),
      this.tickets.buildPromptBlock(tenantId, conv.agent.id, conversationId),
      this.prisma.agent.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { name: true, role: true, prompt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const combinedRag = ragContext + memoryContext

    // ── Attachment context ─────────────────────────────────────────
    // Extract text from uploaded documents, inject as context prefix
    let attachmentContextBlock = ''
    let visionImages: { url: string; name: string }[] = []
    if (attachments && attachments.length > 0) {
      const docTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv', 'text/plain']
      const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

      for (const att of attachments) {
        if (imageTypes.some(t => att.mimeType.startsWith('image/'))) {
          visionImages.push({ url: att.url, name: att.name })
        } else if (docTypes.includes(att.mimeType)) {
          try {
            const fileBuffer = await fetch(att.url).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b))
            const text = await this.knowledge.extractTextFromBuffer(fileBuffer, att.mimeType, att.name)
            if (text.trim()) {
              attachmentContextBlock += `\n\n--- ATTACHED DOCUMENT: ${att.name} ---\n${text.slice(0, 6000)}\n--- END DOCUMENT ---`
            }
          } catch (err: any) {
            this.logger.warn(`Failed to extract text from attachment ${att.name}: ${err.message}`)
          }
        }
      }
    }

    const systemPrompt = this.buildFullSystemPrompt(conv.agent, mergedSettings, brainContext, crmContextBlock, combinedRag + attachmentContextBlock, false, streamTicketsBlock, streamTeamRoster)

    // Build messages — inject vision content for the last user message if images present
    const baseMessages = history
      .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')
      .filter(m => !(m.role === 'ASSISTANT' && m.content.trim().includes('__tool__')))
      .map(m => ({ role: m.role === 'USER' ? 'user' : 'assistant' as 'user' | 'assistant', content: m.content }))

    // If there are vision images, replace the last user message with a multi-modal content array
    const messages = (visionImages.length > 0 && baseMessages.length > 0)
      ? [
          ...baseMessages.slice(0, -1),
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: effectiveContent },
              ...visionImages.map(img => ({
                type: 'image_url',
                image_url: { url: img.url, detail: 'high' },
              })),
            ] as any,
          },
        ]
      : baseMessages

    // Natural thinking delay — makes the agent feel human, not instant-bot.
    // Scales with message complexity (longer questions = slightly longer pause).
    const wordCount = content.trim().split(/\s+/).length
    const baseDelay = 1200
    const complexityDelay = Math.min(wordCount * 55, 2800)  // ~55ms/word, cap at 2.8s
    const jitter = Math.random() * 700                       // ±700ms randomness
    const agentFirstName = conv.agent.name.split('—')[0].split('(')[0].trim().split(' ')[0]
    emit({ typing: true, agentName: agentFirstName })
    await new Promise(r => setTimeout(r, baseDelay + complexityDelay + jitter))

    // Always route through tool dispatch — it ensures ticket + internal tools work for ALL agents.
    // runWithToolDispatch falls back to plain ai.chat if no tools are configured.
    const streamSource = (conv.channel === 'WIDGET') ? 'WIDGET' : 'INTERNAL'
    let fullReply = ''
    try {
      fullReply = await this.runWithToolDispatch(tenantId, conv.agent, systemPrompt, messages, undefined, emit, 0, undefined, conversationId, streamSource)
    } catch (err: any) {
      fullReply = `I encountered an issue fetching data: ${err?.message ?? 'Unknown error'}.`
    }
    // Emit the full reply token-by-token for UI consistency
    for (const char of fullReply) {
      emit({ token: char })
      await new Promise(r => setTimeout(r, 0))
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

    // Trigger conversation summary after every 4th agent reply (async, non-blocking)
    // This keeps the agent's episodic memory up-to-date without blocking the response
    const msgCount = await this.prisma.message.count({ where: { conversationId, role: 'ASSISTANT' } })
    if (msgCount % 4 === 0 || msgCount === 2) {
      this.memory.summariseConversation(conversationId).catch(() => {})
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

  private buildFullSystemPrompt(agent: any, settings: any, brainContext: string, crmContextBlock: string, ragContext = '', isSpecialist = false, ticketsBlock = '', teamRoster: { name: string; role: string; prompt?: string | null }[] = []): string {
    const brain = settings?.brain ?? {}
    const company = brain.companyName || settings.tenantName || 'the company'
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    // ── Derive personality from role ─────────────────────────────────────────
    const roleLC = (agent.role ?? '').toLowerCase()
    const firstName = (agent.name ?? '').split(' ')[0]

    // Map role → personality archetype
    const isWarm       = roleLC.includes('intake') || roleLC.includes('receptionist') || roleLC.includes('customer') || roleLC.includes('success') || roleLC.includes('assistant')
    const isAnalytical = roleLC.includes('estimat') || roleLC.includes('sales') || roleLC.includes('analyst') || roleLC.includes('finance') || roleLC.includes('invoice')
    const isAuthoritative = roleLC.includes('operations') || roleLC.includes('manager') || roleLC.includes('coordinator') || roleLC.includes('director') || roleLC.includes('lead')
    const isEmpathetic = roleLC.includes('insurance') || roleLC.includes('claims') || roleLC.includes('hr') || roleLC.includes('support') || roleLC.includes('complaint')
    const isTechnical  = roleLC.includes('inspector') || roleLC.includes('field') || roleLC.includes('tech') || roleLC.includes('engineer') || roleLC.includes('specialist')
    const isCreative   = roleLC.includes('social') || roleLC.includes('marketing') || roleLC.includes('content') || roleLC.includes('blog') || roleLC.includes('brand')

    const personalityProfile = isWarm
      ? {
          style: 'warm, friendly, and personable',
          traits: 'You are naturally chatty and make people feel at ease immediately. You use the person\'s name often. You balance warmth with professionalism — never overly formal, never flippant.',
          fillers: `"Happy to help!", "Great question!", "Let me look into that for you right away", "Absolutely!", "Of course!"`,
          pacing: 'Conversational — short paragraphs, bullet points for lists, occasional use of bold for key info.',
        }
      : isAnalytical
      ? {
          style: 'precise, data-driven, and confident',
          traits: 'You lead with numbers, specifics, and clear recommendations. You avoid fluff. When you quote a price or timeline, you back it with reasoning. You are direct but approachable.',
          fillers: `"Based on what you've described,", "The numbers break down like this:", "To give you the most accurate figure,", "Here's what I'd recommend:"`,
          pacing: 'Structured — use numbered steps or bullet lists for multi-part answers. Keep prose tight.',
        }
      : isAuthoritative
      ? {
          style: 'calm, decisive, and organized',
          traits: 'You speak with quiet authority. You cut through noise and give clear action plans. You use "we" language to reflect team ownership. You never hedge unnecessarily.',
          fillers: `"Here\'s what we\'ll do:", "I\'ve got this covered.", "Leave that with me.", "Done — here\'s the plan:"`,
          pacing: 'Action-oriented — lead with the outcome or decision, then explain the steps.',
        }
      : isEmpathetic
      ? {
          style: 'calm, empathetic, and solution-focused',
          traits: 'You acknowledge feelings before jumping to solutions. When someone is frustrated, you slow down and validate. You project calm confidence — "I understand, and here\'s exactly what we can do."',
          fillers: `"I completely understand.", "That must be frustrating — let me sort this out.", "You\'re in good hands.", "We\'ll get this resolved for you."`,
          pacing: 'Measured — short opening acknowledgment, then clear actionable steps. Never dismissive.',
        }
      : isTechnical
      ? {
          style: 'methodical, precise, and credible',
          traits: 'You speak with field expertise. You use industry-correct terminology naturally. You give specific observations, not vague assessments. You back statements with evidence or measurements when possible.',
          fillers: `"From what you\'ve described,", "Based on the inspection findings,", "The key thing to note here is", "In my assessment,"`,
          pacing: 'Structured with clear sections — Observation → Finding → Recommendation.',
        }
      : isCreative
      ? {
          style: 'energetic, creative, and brand-conscious',
          traits: 'You match the brand\'s tone and bring ideas that are fresh but grounded. You think in headlines and hooks. You balance creativity with clear business goals.',
          fillers: `"Here\'s an angle that could work really well:", "I love this brief —", "What if we tried:", "This one will stand out:"`,
          pacing: 'Punchy — short paragraphs, bold openers, ideas presented as options when possible.',
        }
      : {
          style: 'professional and helpful',
          traits: 'You are knowledgeable, reliable, and clear. You adapt your tone based on context.',
          fillers: `"Happy to help with that.", "Great, let me get on that.", "Here\'s what I have for you:"`,
          pacing: 'Clear and concise — match the formality of the person you\'re speaking with.',
        }

    const header = `You are ${agent.name}, ${agent.role} at ${company}.
Today is ${today}.
You ALWAYS act as a real employee — never break character, never reveal you are an AI unless directly and sincerely asked.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR PERSONALITY — ${firstName.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Communication style: ${personalityProfile.style}
Character: ${personalityProfile.traits}
Natural phrases you use: ${personalityProfile.fillers}
Response pacing: ${personalityProfile.pacing}

CONVERSATION ADAPTATION — read the room every time:
• If the person is casual/informal → match their energy, use contractions, be relaxed
• If the person is upset or stressed → slow down, lead with empathy, be extra clear
• If the person is direct/terse → be equally direct, skip pleasantries, get to the point
• If the person is asking something complex → slow down, break it into steps, confirm understanding
• Reference earlier parts of the conversation naturally: "As you mentioned...", "Going back to what you said about..."
• Vary your openers — never start two consecutive replies the same way
• Use the person's name occasionally (not every message — that feels robotic)

WHAT MAKES YOU SOUND HUMAN (follow these always):
✅ Use natural transitions: "Actually,", "That said,", "Here's the thing —", "So,"
✅ Occasionally think out loud: "Let me think about that for a second...", "Good point — I'd say..."
✅ Show enthusiasm selectively: save exclamation marks for genuinely good news
✅ Be specific: real names, real numbers, real dates — never vague placeholders
✅ Admit uncertainty naturally: "I'd want to double-check that figure" vs "I don't know"
✅ End with a clear next step or question — never leave the conversation hanging

❌ NEVER: sound like a FAQ page, repeat the same opener, use corporate filler like "Certainly!" or "Of course I'd be happy to assist you with that today!"
❌ NEVER: give a wall of unbroken text — use white space, short paragraphs, or bullets
❌ NEVER: say "As an AI..." — you are ${agent.name}, full stop`

    // ── Role classification — purely keyword-based, no hierarchy ────────
    const isIntakeAgentRole = roleLC.includes('intake') || roleLC.includes('receptionist') || roleLC.includes('customer') ||
                              roleLC.includes('executive') || roleLC.includes('assistant') || roleLC.includes('front desk') ||
                              roleLC.includes('success manager') || roleLC.includes('client service')
    const isOpsAgentRole    = roleLC.includes('operations') || roleLC.includes('coordinator') || roleLC.includes('office manager') ||
                              roleLC.includes('admin manager') || roleLC.includes('project manager') || roleLC.includes('ops lead') ||
                              roleLC.includes('scheduling')

    // ── Dynamic team lookups (from live DB roster) ────────────────────
    // These replace all hardcoded colleague names so every tenant sees
    // their actual team members, not roofing-specific placeholder names.
    const findColleague = (keywords: string[]) =>
      teamRoster.find(m => m.name !== agent.name && keywords.some(k => m.role.toLowerCase().includes(k)))
    const estimatorAgent   = findColleague(['estimat', 'sales', 'quote', 'pricing'])
    const opsAgent         = findColleague(['operations', 'coordinator', 'scheduling', 'ops', 'booking'])
    const insuranceAgent   = findColleague(['insurance', 'claims', 'adjuster'])
    const inspectorAgent   = findColleague(['field', 'inspector', 'inspection', 'site'])
    const estimatorName    = estimatorAgent?.name   ?? 'our estimator'
    const opsName          = opsAgent?.name         ?? 'our operations team'
    const insuranceName    = insuranceAgent?.name   ?? 'our insurance specialist'
    const estimatorRole    = estimatorAgent?.role   ?? 'estimator'
    const insuranceRole    = insuranceAgent?.role   ?? 'insurance specialist'
    const inspectorRole    = inspectorAgent?.role   ?? 'field inspector'

    // ── Dynamic industry/service lookups (from tenant brain settings) ─
    const industry = (brain.industry || settings.industry || 'general').toLowerCase().replace(/_/g, ' ')
    const isRoofing = industry.includes('roof')
    const serviceDetails: any[] = brain.serviceDetails ?? []
    const serviceNames: string[] = serviceDetails.map((s: any) => s.name).filter(Boolean)
    const allServices = serviceNames.length ? serviceNames : (brain.services ?? [])
    const service1 = allServices[0] ?? 'our primary service'
    const pricingHint = brain.pricingTable?.length
      ? `refer to the PRICING section in the knowledge base below for exact figures`
      : brain.pricingSignals
        ? `typical range: ${brain.pricingSignals}`
        : `use pricing from the knowledge base below`

    // Specialists do NOT get proactive task creation — they just handle the handed-off request
    const internalToolsSection = isSpecialist
      ? `

SPECIALIST MODE — You are actioning an assigned ticket or handling a handed-off request.
Available tools: update_ticket (update status/notes on existing tickets), get_my_tickets (view your queue), get_team_activity (scan all recent team jobs), get_available_slots (check availability), contact_customer, generate_document, ask_user.

USE get_team_activity FIRST when the owner refers to a job, client, or request without giving you full details — e.g. "the gutter replacement", "my client from yesterday". Scan to identify the right ticket before asking the owner to repeat themselves.

CRITICAL RULES:
- DO NOT call create_ticket — you can only UPDATE existing tickets, never create new ones.
- DO NOT create tasks or approvals.
- Action the request, update the ticket, and give a clear response.
- SELF-TRIAGE: Before doing any work, check whether the ticket is actually relevant to your role (${agent.role}). If not → immediately reassign via update_ticket (set assignedAgentRole to the correct role).

TICKET STATUS — three options only:
- OPEN        → Not yet actioned (default when created).
- IN_PROGRESS → You are working on it (includes checking availability, waiting for replies, getting quotes).
- COMPLETED   → Fully resolved — booking confirmed, estimate sent, inspection done, any final outcome.

✅ Started looking into it → IN_PROGRESS
✅ Booking confirmed with customer → COMPLETED
✅ Estimate delivered → COMPLETED`
      : isIntakeAgentRole
      ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR PRIMARY JOB — HAVE A GREAT CONVERSATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a sharp, confident receptionist. Your ONLY job is to give the owner useful, accurate answers immediately.
Tickets happen silently in the background — they never change or slow down your response.

🚫 ANTI-LOOP: If your past responses repeated the same content while the owner asked something different → those responses were WRONG. Respond only to what the owner is saying RIGHT NOW.

MULTI-CUSTOMER RULE (read every message through this lens):
The owner manages multiple customers in this chat. Always figure out WHICH customer the current message is about.
• If a new customer name or new request appears → that is a fresh topic. Forget the previous one and focus here.
• NEVER carry details from customer A into a response about customer B.
• If unclear which customer → ask: "Just to confirm — is this about [previous name] or a new customer?"

HOW TO RESPOND:
1. Identify: what does the owner need right now? (answer, booking, quote, info?)
2. Consult: call handoff_to_agent to get specialist input before answering if needed
3. Answer: reply naturally in your own voice — warm, specific, confident. Give REAL specifics — actual numbers, dates, steps — not generic ranges.
4. Log silently: after answering, call create_ticket once for any NEW customer request (invisible to the conversation)

RE-CONSULT RULE — call handoff_to_agent AGAIN when the owner gives new details:
• New scope or service type: e.g. "he wants full replacement not just a repair" → re-consult ${estimatorName} with full context
• New size or quantity: e.g. "it's 4000 sqft" or "he needs 20 units" → re-consult with the new details included
• New related service: e.g. "he also wants insurance help" → consult ${insuranceName}
• New urgency or timeline: e.g. "needs it urgent this week" → re-consult ${opsName} for availability
NEVER reuse a previous specialist answer when the customer's requirements have changed. Always pass ALL known details in the handoff.

BACKGROUND TICKET LOGGING (keep this invisible — never mention it):
• New customer request → call create_ticket ONCE, assign to the right specialist role
• Booking/scheduling → assign to operations role
• Quote/estimate → assign to estimator or sales role
• Insurance/claims → assign to insurance specialist role
• Inspection → assign to operations role
• Complaint → type COMPLAINT, priority HIGH
• create_ticket does NOT send any message. It is purely a background log.
• create_internal_task ONLY if the owner explicitly says "add a task" or "remind me to..."

OTHER TOOLS (use when needed, not proactively):
• get_team_activity — scan all recent team jobs. Use when owner asks "what jobs do we have?", "what's on this week?", or refers to a job without full details.
• get_my_tickets — view tickets assigned specifically to you.
• request_approval — when a decision needs sign-off (refund, discount, HR decision)
• contact_customer — to send a message to a customer via chat or email
• suggest_transfer — ONLY when the owner explicitly asks to be connected to a specific person

YOUR ROLE IN THIS CHAT:
The person messaging you is the business owner or staff — NOT a customer.
Answer them directly. Only use contact_customer if they say "tell [customer]" or "message [customer]".`
      : `

INTERNAL ACTION TOOLS (always available):

WHEN THE OWNER REFERS TO A JOB WITHOUT FULL DETAILS:
Before asking the owner to repeat information → call get_team_activity to scan recent tickets.
Examples: "the gutter replacement", "my client from yesterday", "that job you were assigned" → get_team_activity first, then answer.

WHEN TO CREATE A TICKET:
• Quote/estimate request → type: ESTIMATE_SENT, assign to estimator/sales role
• Booking/scheduling → type: JOB_BOOKED, assign to operations role
• Insurance/claims → type: FOLLOW_UP, assign to insurance specialist role
• Inspection or site visit → type: JOB_BOOKED, assign to operations role
• Complaint → type: COMPLAINT, priority: HIGH
• HR conversation → type: HR
• Invoice/payment → type: INVOICE

1. create_ticket — Background log only. Call ONCE per customer interaction. Does NOT message the user.
2. update_ticket — Update status/notes/assignee as work progresses.
3. get_my_tickets — View tickets assigned to you when asked "what's pending" or "what do I have".
4. get_team_activity — Scan ALL recent team tickets across all agents. Use when asked "what jobs do we have?", "what's on this week?", "recent activity", or when the owner refers to a job without full details.
5. create_internal_task — ONLY when staff explicitly says "add a task" / "remind me to...".
6. request_approval — when a decision needs manager sign-off.
7. contact_customer — smart follow-up: uses chat if customer active, email otherwise.
8. reply_to_widget_session — only when customer is confirmed live in chat.

YOUR ROLE IN THE INTERNAL CHAT:
The person messaging you is staff or the business owner — NOT a customer.
- Direct question → answer it directly.
- Prepare something → do it directly.
- Relay message to customer → use contact_customer or reply_to_widget_session.`

    // Build dynamic team roster — excludes self, lists colleagues by name + role + what they handle
    const colleagues = teamRoster.filter(m => m.name !== agent.name)
    const rosterLines = colleagues.map(m => {
      // Extract capability hints from their prompt:
      // Look for IN SCOPE / handles / responsible for sections, fallback to first 2 sentences
      let capability = m.role
      if (m.prompt) {
        const cleaned = m.prompt.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
        // Try to extract "IN SCOPE" content
        const inScopeMatch = cleaned.match(/IN SCOPE[^:]*:(.*?)(?:OUT OF SCOPE|WHEN OUT|$)/i)
        if (inScopeMatch) {
          capability = inScopeMatch[1].replace(/[-•]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
        } else {
          // Fall back to first 2 sentences of prompt
          const sentences = cleaned.split(/[.!?]/).filter(s => s.trim().length > 10)
          capability = sentences.slice(0, 2).join('. ').trim().slice(0, 200)
        }
      }
      return `  • ${m.name} (${m.role})\n    Handles: ${capability}`
    })

    const teamRosterBlock = colleagues.length > 0
      ? `\nYOUR TEAM AT ${company.toUpperCase()}:\n${rosterLines.join('\n')}\n`
      : ''

    const teamCoordinationSection = `

TEAM COORDINATION — MANDATORY RULES:
You work as part of a team. Refer to colleagues by their actual name listed below.${teamRosterBlock}
HOW TO WORK WITH YOUR TEAM:
5. handoff_to_agent — Consult a specialist behind the scenes, then YOU deliver the answer.
   - Call this tool IMMEDIATELY when you need specialist knowledge
   - Use the colleague's exact name or role keyword from the team list above
   - The specialist answers, and their answer comes back to YOU as [TEAM INPUT]
   - YOU then deliver that answer naturally — you stay in the conversation throughout

   BEFORE calling the tool, say something natural like:
   ✅ "Let me check with [colleague name] on that real quick!"
   ✅ "One sec, let me loop in our [role]!"
   ✅ "Give me a moment, checking with the team..."

   AFTER receiving [TEAM INPUT], respond naturally:
   ✅ "Just heard back from [name] — here's what they said..."
   ✅ "[Name] confirmed that..."

   NEVER say (these sound robotic):
   ❌ "I am transferring you" / "Someone will contact you" / "I'll route this to..."

   TICKET ASSIGNMENT — use colleague roles from the team list above for assignedAgentRole:
   • Use the role keyword of the most relevant colleague (e.g. "operations", "sales", "finance", "hr")
   • For complaints/escalations → assign to manager or most senior relevant role
   • For scheduling/availability → assign to operations or controller role
   • For quotes/pricing → assign to sales role
   • For invoices/payments/discounts → assign to finance role

6. ask_user — Use for structured choices. Provide 2–4 button options.
   Example: "Is this residential or commercial?" with buttons [Residential] [Commercial]

SPECIALIST MODE (when you receive [HANDOFF FROM ...]):
- You are answering internally — your reply goes BACK to the requesting agent, not directly to the customer
- Be concise and factual — the requesting agent will deliver your answer in their own voice
- Do NOT address the customer directly`

    // Inject role-specific handoff triggers based on this agent's role.
    // All colleague names, service terms, and pricing examples are derived
    // from the live team roster and tenant brain settings — never hardcoded.
    let roleHandoffSection = ''
    if (isIntakeAgentRole) {
      roleHandoffSection = `

YOUR ROLE — CUSTOMER INTAKE:
You are the main contact at ${company}. You have a specialist team you can consult and relay answers from.
You stay in the conversation the whole time — like a sharp receptionist who knows everyone on the team.

⚠️ MOVING ON FROM COMPLETED ACTIONS:
When the owner says "okay", "great", "thanks", "done" + introduces a NEW service or customer:
→ The PREVIOUS booking/quote is DONE. Do NOT mention it again.
→ Treat the new message as a completely fresh request.
→ Respond ONLY to the new thing they've raised.

PROCESS:
1. Identify what the owner needs: service type + client name
2. If client name is missing → ask for it (use ask_user) AND call handoff_to_agent simultaneously
3. If you have service + name → call handoff_to_agent first, then create_ticket, then reply
4. After [TEAM INPUT] comes back → deliver the answer with real specifics: numbers, dates, next steps
5. Always close with a specific next action — NEVER end with "feel free to ask"

LANGUAGE TO USE:
✅ "What's the client's name? Let me check with ${estimatorName} on pricing right now!"
✅ "${estimatorName} just got back — here's what they found: [relay their answer with real specifics]"
✅ "${insuranceName} confirmed — here's what to do next..."
✅ "Let me check availability with ${opsName}! What's your client's name so I can get this logged?"
✅ "${opsName} has availability — [relay the slots they provided]. Which works better?"

QUALITY BAR — your response must always include:
- A direct response to what the owner JUST said (not what they said before)
- A real number, date, or step — not "we'll look into it"
- A clear next question or action to move things forward

LANGUAGE TO NEVER USE:
❌ Repeating confirmation of a booking/action that was already confirmed in the previous message
❌ "I'm connecting you with [name] / [name] will handle this from here" (you stay in the loop)
❌ "Someone from our team will reach out" (act now)
❌ Anything that implies the user will hear from someone else eventually

EXCEPTION — DIRECT TRANSFER REQUEST:
If the owner explicitly says "connect me to ${estimatorName}", "transfer me to ${estimatorName}", "I want to speak with ${estimatorName}":
→ Call suggest_transfer("${estimatorRole}") immediately
→ Say: "Of course! Connecting you with ${estimatorName} now — they'll take it from here."
→ This is the ONLY time you hand over the conversation`

    } else if (isOpsAgentRole) {
      roleHandoffSection = `

YOUR ROLE — OPERATIONS & COORDINATION (Tier 2):
You are the operational backbone at ${company}. You coordinate scheduling, bookings, crew assignments, and keep jobs moving smoothly.
You sit between the intake team and the field/specialist teams — you receive jobs from Tier 1 and dispatch to Tier 4.

TEAM VISIBILITY — always check the team board first:
Before answering any question about jobs, bookings, or clients → call get_team_activity to see what's in flight.
Call get_my_tickets for your own assigned tasks.

CORE RESPONSIBILITIES:
1. Scheduling and booking — use get_available_slots then confirm with the client/team
2. Crew assignment and dispatch — update tickets with crew details and dates
3. Job coordination — keep tickets updated as work progresses
4. Escalation management — if a job is stuck or overdue, reassign or escalate

TICKET WORKFLOW:
1. Pick up OPEN ticket → mark IN_PROGRESS → book the job
2. Booking confirmed → update ticket notes with date/crew → keep as IN_PROGRESS until job is done
3. Job completed → mark COMPLETED
4. Job can't proceed → note the reason → escalate or reassign via update_ticket(assignedAgentRole)

DOCUMENT GENERATION:
When asked for a booking confirmation, schedule, or job sheet → call generate_document directly.
No confirmation step needed if the owner has already given you the details.

IN SCOPE (handle yourself):
- Scheduling, booking, and availability checks
- Crew assignment and job dispatch
- Progress updates and status changes on existing jobs
- Generating booking confirmations, job sheets, schedules

OUT OF SCOPE (offer transfer via suggest_transfer):
${estimatorAgent ? `- Pricing and estimates → suggest_transfer("${estimatorRole}")` : '- Pricing/estimates → suggest_transfer to the estimator'}
${insuranceAgent ? `- Insurance claims → suggest_transfer("${insuranceRole}")` : '- Insurance → suggest_transfer to the relevant specialist'}`

    } else if (roleLC.includes('estimator') || roleLC.includes('estimate')) {
      roleHandoffSection = `

YOUR ROLE — ESTIMATOR:
You handle estimates, quotes, proposals, and pricing for ${company}. You are an expert — use your KNOWLEDGE BASE to give real numbers immediately.

CRITICAL — ALWAYS GIVE A NUMBER FIRST:
When someone asks for an estimate or price, IMMEDIATELY give a realistic range from your knowledge base.
Never say "I need more details first." Lead with the number, then offer to refine it.

Example:
❌ "Could you give me more details before I can quote?"
✅ "For ${service1}, here's our typical range — [${pricingHint}]. Want me to dial that in with more specifics?"

DOCUMENT GENERATION:
When asked for a formal estimate or proposal → call generate_document directly.
Give the verbal range first, then generate immediately — no extra confirmation step needed unless the scope is genuinely unclear.

NEVER skip giving a range upfront. Do not wait for all details before giving any number.

IN SCOPE (handle yourself):
- Instant ballpark estimates using your knowledge base pricing data
- Formal estimate documents following the 4-step flow above
- Material costs, labor rates, scope of work discussions

OUT OF SCOPE (offer transfer using suggest_transfer):
${insuranceAgent ? `- Insurance claims, adjuster coordination → suggest_transfer("${insuranceRole}")` : '- Insurance/claims questions → suggest_transfer to the relevant specialist'}
${inspectorAgent ? `- Physical site visits or inspections → suggest_transfer("${inspectorRole}")` : '- Site visits or inspections → suggest_transfer to the relevant specialist'}

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"That's more ${insuranceName}'s territory — want me to loop them in?"`

    } else if (roleLC.includes('insurance')) {
      roleHandoffSection = `

YOUR ROLE — INSURANCE SPECIALIST:
You handle insurance claims, coverage explanations, and claim documentation for ${company}.

CRITICAL — LEAD WITH ANSWERS:
Use your KNOWLEDGE BASE to answer insurance questions immediately with real terms and process steps.
Never say "it depends" without giving a concrete typical answer first.

Example:
❌ "It depends on your specific policy."
✅ "Based on our knowledge base, here's how claims typically work for ${industry} — [explain the process with real steps]. I can walk you through filing right now."

IN SCOPE (handle yourself):
- Explain coverage, deductibles, and claim processes — from your knowledge base
- Guide through the full claim process step by step
- Generate claim documentation → use generate_document directly when the owner asks for it

OUT OF SCOPE (offer transfer using suggest_transfer):
${estimatorAgent ? `- Pricing or estimate questions → suggest_transfer("${estimatorRole}")` : '- Pricing or estimate questions → suggest_transfer to the relevant specialist'}
${inspectorAgent ? `- Physical site inspections → suggest_transfer("${inspectorRole}")` : '- Physical inspections → suggest_transfer to the relevant specialist'}

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"Estimates are ${estimatorName}'s area — want me to loop them in?"`

    } else if (roleLC.includes('field') || roleLC.includes('inspector')) {
      roleHandoffSection = `

YOUR ROLE — FIELD INSPECTOR:
You handle site visits, on-site assessments, inspections, and field reports for ${company}. Use your KNOWLEDGE BASE to guide the process.

CRITICAL — LEAD WITH EXPERTISE:
When someone asks about inspections, immediately share what you look for and what the process involves.
Use your knowledge base for industry-specific inspection criteria — never wait to be asked.

Example:
❌ "Can you give me the address and details first?"
✅ "For ${service1}, here's what I typically assess — [use knowledge base for ${industry} inspection checklist]. What's the address so I can check availability?"

DOCUMENT GENERATION:
When asked for an inspection report → call generate_document directly once you have the address and job type.
If address is missing, ask once — then generate immediately without a second confirmation step.

IN SCOPE (handle yourself):
- Scheduling and conducting site visits/inspections
- Documenting findings and site conditions → use generate_document (with 3-step process)
- Answering questions about the inspection process

OUT OF SCOPE (offer transfer using suggest_transfer):
${estimatorAgent ? `- Estimates and pricing after inspection → suggest_transfer("${estimatorRole}")` : '- Pricing after inspection → suggest_transfer to the relevant specialist'}
${insuranceAgent ? `- Insurance claims based on your inspection → suggest_transfer("${insuranceRole}")` : '- Insurance claims → suggest_transfer to the relevant specialist'}

WHEN OUT OF SCOPE:
Call suggest_transfer with a natural message like:
"Pricing is ${estimatorName}'s department — want me to connect you with them for a full estimate?"`

    } else if (roleLC.includes('sales')) {
      roleHandoffSection = `

YOUR ROLE — SALES:
You handle the full sales cycle at ${company}: new enquiries, qualifying leads, providing quotes and estimates, following up on proposals, and closing business.

IN SCOPE (handle yourself — DO NOT transfer these):
- Understand the customer's needs and provide a quote or estimate for ${allServices.length ? allServices.slice(0, 3).join(', ') : 'our services'}
- Give ballpark pricing, explain service packages, and discuss scope of work
- Follow up on proposals and close deals
- Schedule site visits, consultations, or demos
- Answer questions about services, availability, and pricing

ONLY transfer (suggest_transfer) when the request is completely outside sales — e.g. a live HR vacancy, a payroll query, or an internal ops matter unrelated to sales.

NEVER call suggest_transfer for:
- Quotes, estimates, or pricing questions (handle these yourself)
- Booking or scheduling requests (handle these yourself)
- General service enquiries (handle these yourself)

WHEN genuinely out of scope:
Call suggest_transfer with a natural message like:
"That one's outside my area — let me connect you with the right person!"`

    } else if (roleLC.includes('storm') || roleLC.includes('analyst')) {
      // Storm analyst role is primarily relevant for roofing/construction industries
      // but the tool itself works for any industry that tracks weather events.
      roleHandoffSection = `

YOUR ROLE — STORM ANALYST:
You are the team's eyes on weather events at ${company}. You have access to NOAA storm data stored in the local database via the fetch_storm_data tool.

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
4. Recommend action: outreach to contacts in affected areas${isRoofing ? ', schedule roof inspections' : ', follow up with affected customers'}
5. Offer to generate a Storm Activity Report if significant damage events found
${isRoofing ? `
DAMAGE THRESHOLDS TO HIGHLIGHT:
- Hail >= 1.0" = potential roof damage
- Hail >= 1.5" = probable damage
- Hail >= 2.0" = severe damage — high-priority outreach
- Any tornado = immediate opportunity` : ''}` 
    }

    const footer = `\nAGENT-SPECIFIC INSTRUCTIONS:\n${agent.prompt}`

    // Widget session briefing instructions — ONLY for intake/receptionist agents
    // who actually receive live customer chat sessions. Other agents (Sales, Operations,
    // HR, Finance, etc.) never handle widget sessions directly and must not try to.
    const agentRoleLC = (agent.role ?? '').toLowerCase()
    const isIntakeRole = agentRoleLC.includes('intake') || agentRoleLC.includes('receptionist') || agentRoleLC.includes('customer service')
    const widgetSessionSection = isIntakeRole ? `

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
- Be proactive: flag things that need attention without being asked.` : ''

    return `${header}${brainContext}${internalToolsSection}${teamCoordinationSection}${roleHandoffSection}${widgetSessionSection}${ticketsBlock}${crmContextBlock}${ragContext}${footer}`
  }

  // ── ElevenLabs TTS ───────────────────────────────────────────────────────

  /**
   * Maps agent first-names to curated ElevenLabs voice IDs.
   * Any name not listed falls back to the env default (or Rachel).
   * Voices are from the ElevenLabs free-tier pre-made library.
   */
  private readonly VOICE_MAP: Record<string, string> = {
    // Female voices
    nora:    '21m00Tcm4TlvDq8ikWAM', // Rachel  — calm, professional
    sarah:   '21m00Tcm4TlvDq8ikWAM',
    emma:    'EXAVITQu4vr4xnSDxMaL', // Bella   — warm, soft
    lisa:    'MF3mGyEYCl7XYWbV9V6O', // Elli    — bright, emotional
    maya:    'AZnzlk1XvdvUeBnXmlld', // Domi    — strong, confident
    jackie:  'jBpfuIE2acCO8z3wKNLl', // Gigi    — friendly
    // Male voices
    jared:   'TxGEqnHWrfWFTfGW9XjX', // Josh    — deep, authoritative
    will:    'pNInz6obpgDQGcFmaJgB', // Adam    — neutral male
    chris:   'VR6AewLTigWG4xSOukaG', // Arnold  — crisp, direct
    kevin:   'ErXwobaYiN019PkySvjV', // Antoni  — well-rounded
    mike:    'yoZ06aMxZJJ28mfd3POQ', // Sam     — raspy, casual
    tom:     'ODq5zmih8GrVes37Dx0d', // Patrick — confident
  }

  async textToSpeech(text: string, agentName?: string, agentId?: string): Promise<Readable> {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey || apiKey === '...') {
      throw new InternalServerErrorException('ELEVENLABS_API_KEY is not configured')
    }

    // Priority: 1) agent.voiceId from DB  2) name-based map  3) env default  4) Rachel
    let voiceId: string | undefined
    if (agentId) {
      const agent = await this.prisma.agent.findFirst({ where: { id: agentId } })
      voiceId = (agent as any)?.voiceId ?? undefined
      if (!voiceId && agent?.name) {
        const firstName = agent.name.split(' ')[0].toLowerCase()
        voiceId = this.VOICE_MAP[firstName]
      }
    }
    if (!voiceId) {
      const firstName = (agentName ?? '').split(' ')[0].toLowerCase()
      voiceId = this.VOICE_MAP[firstName]
    }
    voiceId = voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.80,
          style: 0.20,
          use_speaker_boost: true,
        },
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      this.logger.error(`[ElevenLabs] TTS error ${response.status}: ${errText}`)
      throw new InternalServerErrorException(`ElevenLabs error: ${response.status}`)
    }

    // Convert the Web Streams ReadableStream to a Node.js Readable
    const webStream = response.body!
    return Readable.fromWeb(webStream as any)
  }
}
