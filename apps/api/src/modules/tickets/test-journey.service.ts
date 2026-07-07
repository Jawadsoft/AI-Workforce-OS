import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { ChatService } from '../chat/chat.service'
import { CrmService } from '../crm/crm.service'
import * as nodemailer from 'nodemailer'

// ── Customer constants ──────────────────────────────────────────────────────

const TEST_CUSTOMER = {
  name: 'Ronaldo (Test Journey)',
  email: 'ronaldo@mitiesoft.com',
  phone: '+1 917 265 8444',
  address: '42 Oak Drive, Fort Worth, TX 76101',
}

// ── Insurance carrier (simulated) ─────────────────────────────────────────
// Real SMTP mailbox used to send carrier approval/decision emails so they
// appear in Ronaldo's inbox exactly as a real carrier would send them.

const CARRIER = {
  name: 'State Farm Insurance',
  email: 'paulp@mitiesoft.com',
  smtpHost: 'send.one.com',
  smtpPort: 587,
  smtpPass: 'paulp786@',
}

// ── Unified 22-stage config ─────────────────────────────────────────────────
// Each stage drives the full automated journey — no hardcoded stage blocks.

interface StageReply {
  body: string
  confirmedDate?: string  // Only for inspection scheduling
}

interface StageConfig {
  idx: number
  name: string
  roleKeyword: string
  // Customer replies to inject in sequence (empty = internal stage, no customer interaction)
  replies: StageReply[]
  // Force-complete note used when agent doesn't finish autonomously
  note: string
  // True for stage 2 — after reply ticket → SCHEDULED, flipScheduledTickets fires pipelineAdvance
  isInspectionScheduling?: boolean
  // CRM fields to write back to the job card after this stage completes
  crmUpdate?: Record<string, any>
  // Document to attach to the job card (type + simulated filename)
  crmDocument?: { type: string; fileName: string }
  // Email sent FROM the carrier TO the homeowner (real email via carrier SMTP)
  carrierReply?: { subject: string; html: string }
}

const ALL_STAGES: StageConfig[] = [
  // ── DISCOVERY & SALES ────────────────────────────────────────────────────
  {
    idx: 0,
    name: 'Lead Qualification',
    roleKeyword: 'Lead Qualification',
    replies: [
      { body: `Hi, thanks for reaching out! Yes, I noticed some damage on my roof after the storm last week. I'm definitely interested in the free inspection. Can you tell me more about the process and what to expect?` },
      { body: `That sounds great, I am fully on board. Let's move forward with the inspection. Looking forward to hearing from you.` },
    ],
    note: 'Lead qualified — customer confirmed interest. Advancing to Sales Consultation.',
    crmUpdate: { leadStatus: 'Consultation Scheduled', currentStageIndex: 0 },
  },
  {
    idx: 1,
    name: 'Sales Consultation',
    roleKeyword: 'Sales',
    replies: [
      { body: `Thanks for explaining the financing options. The insurance claim assistance sounds exactly what I need. I'd like to proceed with the inspection. What are the next steps?` },
    ],
    note: 'Sales consultation done — homeowner agreed to financing and inspection. Moving to scheduling.',
    crmUpdate: { leadStatus: 'Consultation Done', currentStageIndex: 1 },
  },
  {
    idx: 2,
    name: 'Inspection Scheduling',
    roleKeyword: 'Executive',
    replies: [
      { body: `I can do Thursday July 10th at 10am. That works perfectly for me.`, confirmedDate: '2026-07-10' },
    ],
    note: 'Inspection scheduled for 10 July 2026 at 10 AM.',
    isInspectionScheduling: true,
    crmUpdate: { inspectionDate: '2026-07-10T10:00:00Z', currentStageIndex: 2 },
  },

  // ── INSPECTION & VERIFICATION ────────────────────────────────────────────
  {
    idx: 3,
    name: 'Field Inspection',
    roleKeyword: 'Field Inspector',
    replies: [],
    note: 'Roof damage documented. Hail dents confirmed on 60% of surface, 3 skylights cracked, gutters bent. Damage severity: HIGH.',
    crmUpdate: { damageSeverity: 'HIGH', hailSizeInches: 1.75, damageType: 'Hail + Wind', currentStageIndex: 3 },
    crmDocument: { type: 'inspection_report', fileName: 'inspection-report-2026-07-10.pdf' },
  },
  {
    idx: 4,
    name: 'Storm Verification',
    roleKeyword: 'Storm',
    replies: [],
    note: 'NEXRAD confirmed 1.75" hail on 2026-04-12 over TX 76101. NOAA event ID: HAI-2026-TX-0412. Attached to claim file.',
    crmUpdate: { noaaEventId: 'HAI-2026-TX-0412', stormEventDate: '2026-04-12', currentStageIndex: 4 },
    crmDocument: { type: 'storm_verification', fileName: 'storm-verification-HAI-2026-TX-0412.pdf' },
  },

  // ── ESTIMATING & PROPOSAL ────────────────────────────────────────────────
  {
    idx: 5,
    name: 'Estimate & Scope of Work',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Estimate: $24,500 (full replacement). SOW prepared and sent to homeowner for e-signature. Contractor: ProRoof TX.',
    crmUpdate: { estimateTotal: 24500, currentStageIndex: 5 },
    crmDocument: { type: 'sow', fileName: 'scope-of-work-2026-07-11.pdf' },
  },
  {
    idx: 6,
    name: 'Proposal Presentation',
    roleKeyword: 'Sales',
    replies: [
      { body: `I am happy with the proposal. The pricing looks fair and the timeline works for me. I want to proceed. What do I need to sign?` },
    ],
    note: 'Proposal accepted by homeowner. Proceeding to contract signing.',
    crmUpdate: { leadStatus: 'Proposal Accepted', currentStageIndex: 6 },
  },
  {
    idx: 7,
    name: 'Contract Signing',
    roleKeyword: 'Executive',
    replies: [
      { body: `I have signed the contract and transferred the deposit. Please go ahead and schedule everything. I am excited to get started!` },
    ],
    note: 'Contract signed by homeowner. Deposit received. Advancing to insurance claim.',
    crmUpdate: { leadStatus: 'Contract Signed', depositPaid: 2000, currentStageIndex: 7 },
    crmDocument: { type: 'contract', fileName: 'contract-signed-2026-07-12.pdf' },
  },

  // ── INSURANCE ────────────────────────────────────────────────────────────
  {
    idx: 8,
    name: 'Insurance Claim Submission & Approval',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Claim submitted to carrier. Approval letter received. ACV: $24,500. RCV: $28,900. Claim ref: CLM-2026-TX-00847.',
    crmUpdate: { claimNumber: 'CLM-2026-TX-00847', acvAmount: 24500, rcvAmount: 28900, currentStageIndex: 8 },
    crmDocument: { type: 'approval_letter', fileName: 'carrier-approval-CLM-2026-TX-00847.pdf' },
    carrierReply: {
      subject: 'Re: Roof Damage Claim — CLM-2026-TX-00847 — APPROVED',
      html: `
        <p>Dear ${TEST_CUSTOMER.name},</p>
        <p>We have completed our review of your roof damage claim submitted for the property at <strong>${TEST_CUSTOMER.address}</strong>.</p>
        <p>We are pleased to inform you that your claim has been <strong>approved</strong>.</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:4px 12px 4px 0"><strong>Claim Number:</strong></td><td>CLM-2026-TX-00847</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Cause of Loss:</strong></td><td>Hail &amp; Wind — April 12, 2026</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>ACV Payment:</strong></td><td>$24,500.00</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>RCV (Full Replacement):</strong></td><td>$28,900.00</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Depreciation Holdback:</strong></td><td>$4,400.00</td></tr>
        </table>
        <p>An ACV payment of <strong>$24,500.00</strong> will be issued within 5–7 business days. The depreciation holdback of $4,400.00 will be released upon receipt of the contractor's completion certificate.</p>
        <p>Please contact your contractor to proceed with the approved scope of work.</p>
        <br>
        <p>Sincerely,<br>
        <strong>Paul Peterson</strong><br>
        Senior Claims Adjuster<br>
        ${CARRIER.name}<br>
        📞 1-800-STATE-FARM | ✉ ${CARRIER.email}</p>
      `,
    },
  },
  {
    idx: 9,
    name: 'Supplement Request & Carrier Decision',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Supplement filed. Identified 12 underpaid line items. Total supplement: $8,400. Depreciation holdback: $4,400. Carrier reference: REF-TX-9876.',
    crmUpdate: { claimReferenceNumber: 'REF-TX-9876', depreciationHoldback: 4400, currentStageIndex: 9 },
    crmDocument: { type: 'supplement', fileName: 'supplement-REF-TX-9876.pdf' },
    carrierReply: {
      subject: 'Re: Supplement Request — CLM-2026-TX-00847 — Decision Issued',
      html: `
        <p>Dear ${TEST_CUSTOMER.name},</p>
        <p>We have reviewed the supplement request submitted by your contractor for claim <strong>CLM-2026-TX-00847</strong>.</p>
        <p>After evaluation, we have approved the following additional items:</p>
        <ul>
          <li>Drip edge replacement — <strong>$1,200.00</strong></li>
          <li>Ice &amp; water shield (full deck) — <strong>$1,800.00</strong></li>
          <li>Pipe boot replacements × 4 — <strong>$640.00</strong></li>
          <li>Additional labour (steep slope) — <strong>$2,100.00</strong></li>
          <li>Gutter &amp; downspout replacement — <strong>$2,660.00</strong></li>
        </ul>
        <p><strong>Supplement approved: $8,400.00</strong></p>
        <p>Revised total RCV: <strong>$37,300.00</strong>. Depreciation holdback remains $4,400.00 pending completion certificate.</p>
        <p>Reference: <strong>REF-TX-9876</strong>. Please retain this email for your records.</p>
        <br>
        <p>Sincerely,<br>
        <strong>Paul Peterson</strong><br>
        Senior Claims Adjuster<br>
        ${CARRIER.name}<br>
        📞 1-800-STATE-FARM | ✉ ${CARRIER.email}</p>
      `,
    },
  },

  // ── MATERIALS ────────────────────────────────────────────────────────────
  {
    idx: 10,
    name: 'Material Selection',
    roleKeyword: 'Estimat',
    replies: [
      { body: `I will go with the Owens Corning Duration shingles in Onyx Black. That colour looks great with our house. Please proceed with ordering.` },
    ],
    note: 'Homeowner selected Owens Corning Duration shingles, Onyx Black. Material choice confirmed in writing.',
    crmUpdate: {
      materialSpecs: { brand: 'Owens Corning', product: 'Duration', colour: 'Onyx Black', underlayment: 'WeatherLock' },
      currentStageIndex: 10,
    },
  },
  {
    idx: 11,
    name: 'Material Ordering',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Materials ordered from ABC Roofing Supply. PO#2026-TX-4481. Owens Corning Duration, Onyx Black, 28 squares. Delivery confirmed July 14.',
    crmUpdate: { poNumber: 'PO-2026-TX-4481', materialDeliveryDate: '2026-07-14T10:00:00Z', currentStageIndex: 11 },
  },

  // ── PERMITS & PRODUCTION ─────────────────────────────────────────────────
  {
    idx: 12,
    name: 'Permit Review',
    roleKeyword: 'Compliance',
    replies: [],
    note: 'Permit #FW-2026-RFG-8847 issued by Fort Worth Municipal. Code compliance confirmed. Contractor ProRoof TX cleared to start.',
    crmUpdate: { permitNumber: 'FW-2026-RFG-8847', currentStageIndex: 12 },
    crmDocument: { type: 'permit', fileName: 'permit-FW-2026-RFG-8847.pdf' },
  },
  {
    idx: 13,
    name: 'Production Scheduling',
    roleKeyword: 'Operations',
    replies: [],
    note: 'Crew assigned: ProRoof TX (5-person team). Installation scheduled for July 15, 2026. Homeowner notified via email. Pre-job checklist complete.',
    crmUpdate: { installationDate: '2026-07-15T08:00:00Z', leadStatus: 'Production Scheduled', currentStageIndex: 13 },
  },
  {
    idx: 14,
    name: 'Roof Installation',
    roleKeyword: 'Operations',
    replies: [],
    note: 'Roof fully installed on July 15, 2026. Old shingles removed, new Owens Corning Duration installed. All debris removed. 47 job photos uploaded.',
    crmUpdate: { leadStatus: 'Installation Complete', currentStageIndex: 14 },
  },

  // ── QUALITY & CLOSE ──────────────────────────────────────────────────────
  {
    idx: 15,
    name: 'Quality Control Inspection',
    roleKeyword: 'Field Inspector',
    replies: [],
    note: 'QC inspection passed. Flashing properly sealed, ridge cap installed, gutters reattached. Zero punch list items. Job approved.',
    crmDocument: { type: 'qc_report', fileName: 'qc-report-2026-07-16.pdf' },
    crmUpdate: { currentStageIndex: 15 },
  },
  {
    idx: 16,
    name: 'Customer Walkthrough',
    roleKeyword: 'Sales',
    replies: [
      { body: `The roof looks absolutely fantastic! I am very happy with the quality of work. The team was professional and cleaned up perfectly. Well done!` },
    ],
    note: 'Homeowner satisfied with completed roof. No punch list items. Signed off on completion.',
    crmUpdate: { leadStatus: 'Job Accepted by Customer', currentStageIndex: 16 },
  },
  {
    idx: 17,
    name: 'Final Invoice',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Final invoice #INV-2026-TX-0847 sent to homeowner. Total: $28,900. Depreciation holdback noted: $4,400. Balance due from homeowner: $4,400.',
    crmDocument: { type: 'invoice', fileName: 'invoice-INV-2026-TX-0847.pdf' },
    crmUpdate: { balanceOwing: 4400, currentStageIndex: 17 },
  },
  {
    idx: 18,
    name: 'Payment Collection',
    roleKeyword: 'Executive',
    replies: [
      { body: `Payment sent! I transferred the full outstanding balance via bank transfer. Reference number: TXN-20260720-8847. Please confirm receipt.` },
    ],
    note: 'Full payment received. Bank transfer TXN-20260720-8847 confirmed. Receipt issued. Project financially closed.',
    crmUpdate: { balanceOwing: 0, leadStatus: 'Payment Complete', currentStageIndex: 18 },
  },
  {
    idx: 19,
    name: 'Warranty Registration',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Owens Corning Platinum Protection warranty registered. Certificate #OC-2026-TX-8847 emailed to homeowner. 50-year material, 25-year workmanship.',
    crmUpdate: { warrantyType: 'Owens Corning Platinum Protection — 50yr material + 25yr workmanship', currentStageIndex: 19 },
    crmDocument: { type: 'warranty_certificate', fileName: 'warranty-OC-2026-TX-8847.pdf' },
  },
  {
    idx: 20,
    name: 'Review & Referral Request',
    roleKeyword: 'Sales',
    replies: [
      { body: `I just left a 5-star review on Google — really happy with everything. Also, my neighbour the Garcias at 44 Oak Drive also need roof work, I gave them your number!` },
    ],
    note: '5-star Google review received. Referral logged: Garcia family, 44 Oak Drive, Fort Worth TX 76101. CRM updated.',
    crmUpdate: { notes: 'Referral: Garcia family, 44 Oak Drive, Fort Worth TX 76101', currentStageIndex: 20 },
  },
  {
    idx: 21,
    name: 'Project Closeout',
    roleKeyword: 'Operations',
    replies: [],
    note: 'All tasks closed. Documents archived. CRM record marked CLOSED-WON. Job profitability: 34%. Project #2026-TX-8847 archived.',
    crmUpdate: { leadStatus: 'CLOSED-WON', profitability: 8330, currentStageIndex: 21 },
  },
]

// ── In-memory log store (per tenant) ─────────────────────────────────────────

export interface JourneyLogEntry {
  time: string
  icon: string
  label: string
  msg: string
}

type JourneyRunStatus = 'idle' | 'running' | 'complete' | 'error'

const journeyLogs   = new Map<string, JourneyLogEntry[]>()
const journeyStatus = new Map<string, JourneyRunStatus>()

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TestJourneyService {
  private readonly logger = new Logger(TestJourneyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    @Inject(forwardRef(() => TicketProcessorScheduler)) private readonly ticketProcessor: TicketProcessorScheduler,
    @Inject(forwardRef(() => ChatService)) private readonly chat: ChatService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  getLogs(tenantId: string): JourneyLogEntry[] {
    return journeyLogs.get(tenantId) ?? []
  }

  getStatus(tenantId: string): JourneyRunStatus {
    return journeyStatus.get(tenantId) ?? 'idle'
  }

  /** Start the full automated 22-stage journey in the background. Returns immediately. */
  startFullJourney(tenantId: string) {
    if (journeyStatus.get(tenantId) === 'running') {
      return { ok: false, message: 'A journey is already running. Wait for it to finish or check the log.' }
    }
    journeyLogs.set(tenantId, [])
    journeyStatus.set(tenantId, 'running')
    this.log(tenantId, '🚀', 'START', `Full 22-stage pipeline journey — ${TEST_CUSTOMER.name} <${TEST_CUSTOMER.email}>`)
    this.log(tenantId, '📤', 'SMTP',  `Emails sent from info@stormbuddy.co`)

    setImmediate(() =>
      this.runFullJourney(tenantId)
        .then(() => { journeyStatus.set(tenantId, 'complete') })
        .catch(e => {
          this.log(tenantId, '❌', 'ERROR', e.message)
          this.logger.error(`[TestJourney] ${e.message}`, e.stack)
          journeyStatus.set(tenantId, 'error')
        })
    )

    return { ok: true, message: 'Journey started in background. Poll /operations/test-journey/logs for live updates.' }
  }

  // ── Manual step helpers (kept for the step-by-step panel) ─────────────────

  async getJourneyTickets(tenantId: string): Promise<Array<{
    id: string
    ticketNumber: number
    status: string
    stageIndex: number | null
    stageName: string
    assignedAgent: { id: string; name: string; role: string } | null
    nextAction: string | null
    followUpAt: Date | null
    activityLog: unknown
    createdAt: Date
    updatedAt: Date
    suggestedReply: string | null
  }>> {
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        tenantId,
        contactEmail: TEST_CUSTOMER.email,
        status: { notIn: ['CANCELLED'] },
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      },
      include: { assignedAgent: true },
      orderBy: { ticketNumber: 'asc' },
    })
    return tickets.map(t => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      status: t.status,
      stageIndex: (t.metadata as any)?.pipelineStageIndex ?? null,
      stageName: (t.metadata as any)?.pipelineStageName ?? t.title,
      assignedAgent: t.assignedAgent
        ? { id: t.assignedAgent.id, name: t.assignedAgent.name, role: t.assignedAgent.role }
        : null,
      nextAction: t.nextAction,
      followUpAt: t.followUpAt,
      activityLog: t.activityLog,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      suggestedReply: ALL_STAGES.find(s => s.idx === (t.metadata as any)?.pipelineStageIndex)?.replies[0]?.body ?? null,
    }))
  }

  async simulateReply(tenantId: string, ticketId: string, replyBody?: string) {
    const ticket = await this.prisma.activityTicket.findFirst({ where: { id: ticketId, tenantId } })
    if (!ticket) throw new Error('Ticket not found')
    const stageIdx = (ticket.metadata as any)?.pipelineStageIndex ?? 0
    const stageCfg = ALL_STAGES.find(s => s.idx === stageIdx)
    const reply = replyBody ?? stageCfg?.replies[0]?.body ?? 'Sounds good, please proceed.'
    const confirmedDate = stageCfg?.replies[0]?.confirmedDate
    return this.injectReply(ticket, reply, confirmedDate ?? null)
  }

  async forceAdvance(tenantId: string, ticketId: string) {
    const ticket = await this.prisma.activityTicket.findFirst({
      where: { id: ticketId, tenantId },
      include: { assignedAgent: true },
    })
    if (!ticket) throw new Error('Ticket not found')
    const stageIdx = (ticket.metadata as any)?.pipelineStageIndex ?? 0
    const note = ALL_STAGES.find(s => s.idx === stageIdx)?.note ?? `Stage ${stageIdx} complete.`
    await this.markComplete(ticketId, note)
    return { ok: true, stageIdx, note, completingAgentId: ticket.assignedAgentId }
  }

  // ── Full automated 22-stage journey ───────────────────────────────────────

  private async runFullJourney(tenantId: string) {
    const t = tenantId
    const log = (icon: string, label: string, msg: string) => this.log(t, icon, label, msg)

    // Load agents
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
    })
    const byRole = (kw: string) => agents.find(a =>
      a.role?.toLowerCase().includes(kw.toLowerCase()) || a.name?.toLowerCase().includes(kw.toLowerCase())
    )

    // Load playbook stages for fallback nextAction text
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const playbookStages: any[] = (tenant?.settings as any)?.brain?.operationalPlaybook?.pipelineStages ?? []

    // Cancel ALL previous test journey tickets so waitForNewTicket only finds this run
    await this.prisma.activityTicket.updateMany({
      where: {
        tenantId,
        contactEmail: TEST_CUSTOMER.email,
        status: { notIn: ['CANCELLED'] },
        metadata: { path: ['testJourney'], equals: true },
      },
      data: { status: 'CANCELLED' },
    })

    const journeyStartTime = new Date()
    const charlie = byRole('Lead Qualification')
    if (!charlie) throw new Error('Charlie (Lead Qualification Specialist) agent not found')

    // CRM job ID resolved from lead ID — shared across all 22 stages
    let crmJobId: string | null = null

    // ── Main loop: iterate all 22 stages ─────────────────────────────────────
    for (const stage of ALL_STAGES) {
      const stageLabel = `STAGE ${stage.idx}`
      log('─────', stageLabel, `─ ${stage.name} (${stage.roleKeyword}) ` + '─'.repeat(Math.max(0, 42 - stage.name.length)))

      // ── Acquire ticket ────────────────────────────────────────────────────
      let ticket: any

      if (stage.idx === 0) {
        // Stage 0: always create manually (entry point of pipeline)
        const crmLeadId = `test_${Date.now()}`
        ticket = await this.prisma.activityTicket.create({
          data: {
            tenantId,
            title: `New lead — ${TEST_CUSTOMER.name} (Test Journey)`,
            description: `Test journey lead.\nAddress: ${TEST_CUSTOMER.address}`,
            type: 'GENERAL', status: 'OPEN', priority: 'HIGH', source: 'INTERNAL',
            contactRef: TEST_CUSTOMER.name, contactEmail: TEST_CUSTOMER.email, contactPhone: TEST_CUSTOMER.phone,
            assignedAgentId: charlie.id,
            nextAction: 'Send outreach email to homeowner introducing free roof inspection offer.',
            followUpAt: new Date(Date.now() - 1000),
            metadata: { pipelineStageIndex: 0, pipelineStageName: 'Lead Qualification', crmLeadId, testJourney: true } as any,
            activityLog: [{ agentName: 'System', agentId: 'system', action: 'TICKET_CREATED', note: `Test journey started. Customer: ${TEST_CUSTOMER.name} <${TEST_CUSTOMER.email}>`, timestamp: new Date().toISOString() }] as any,
          },
          include: { assignedAgent: { select: { id: true, name: true, role: true } } },
        })
        log('📋', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} created → ${charlie.name}`)

        // Resolve CRM job ID — used for all 22 stages
        // Stormbuddy includes job_id directly on the lead record.
        // Strategy 1: fetch lead by stored lead ID and read job_id from response
        // Strategy 2: fallback — search leads by test customer email, read job_id from first match
        log('🔗', 'CRM', `Resolving job ID for test journey...`)
        crmJobId = await this.crm.getJobIdByLeadId(tenantId, crmLeadId).catch(() => null)

        if (!crmJobId) {
          // Fake test lead ID — search by email to find real Stormbuddy lead and extract job_id
          try {
            const leads = await this.crm.searchLeads(tenantId, TEST_CUSTOMER.email)
            const match = leads?.find((l: any) => l.jobId) ?? leads?.[0]
            crmJobId = match?.jobId ?? null
            if (crmJobId) log('🔗', 'CRM', `Job ID resolved via lead search (${match?.id}): ${crmJobId}`)
          } catch { /* silent */ }
        } else {
          log('🔗', 'CRM', `Job ID resolved from lead ${crmLeadId}: ${crmJobId}`)
        }

        if (!crmJobId) {
          log('⚠️', 'CRM', `No job_id found for ${TEST_CUSTOMER.email} in Stormbuddy — CRM simulation will be skipped`)
        }
      } else {
        // Stages 1–21: wait for pipelineAdvance to create the ticket, or fall back
        await this.wakeAgents()
        await this.sleep(3000)

        ticket = await this.waitForNewTicket(tenantId, stage.idx, journeyStartTime, 25000)
        if (!ticket) {
          log('⚙️', 'CREATE', `Stage ${stage.idx} ticket not auto-created — creating manually`)
          const ag = byRole(stage.roleKeyword)
          ticket = await this.createFallbackTicket(
            tenantId, stage.idx, stage.name, ag?.id,
            playbookStages[stage.idx]?.completion ?? `Complete ${stage.name}.`,
          )
          log('⚙️', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} → ${ticket.assignedAgent?.name ?? ag?.name ?? '?'}`)
        } else {
          log('📋', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} → ${ticket.assignedAgent?.name ?? '?'}`)
        }
        await this.cancelDuplicatesForStage(tenantId, stage.idx, ticket.id)
      }

      // ── Wake agents and wait for initial response ─────────────────────────
      log('⚡', 'WAKE', `Waking ${stage.roleKeyword} agent... (cap 20s)`)
      await this.wakeAgents()
      await this.sleep(2000)
      log('⏳', 'WAIT', `Checking ticket status (up to 15s)...`)
      const afterWake = await this.waitForStatus(ticket.id, ['AWAITING_CUSTOMER', 'IN_PROGRESS', 'COMPLETED'], 15000)
      if (afterWake) {
        log('✅', stage.roleKeyword.toUpperCase().slice(0, 12), `Status → ${afterWake.status}`)
      } else {
        log('⚠️', stage.roleKeyword.toUpperCase().slice(0, 12), 'No status change yet — injecting customer data next')
      }

      // ── Inject customer replies (for customer-facing stages) ──────────────
      for (let ri = 0; ri < stage.replies.length; ri++) {
        const reply = stage.replies[ri]
        const fresh = await this.prisma.activityTicket.findUnique({ where: { id: ticket.id } })
        if (!fresh) continue

        await this.injectReply(fresh, reply.body, reply.confirmedDate ?? null)
        log('📧', 'CUSTOMER', `Replied: "${reply.body.slice(0, 80)}${reply.body.length > 80 ? '...' : ''}"`)

        if (reply.confirmedDate) {
          log('📅', 'DATE', `Confirmed date: ${reply.confirmedDate}`)
        }

        log('⚡', 'WAKE', `Waking agent to respond to customer...`)
        await this.wakeAgents()
        await this.sleep(4000)
        const afterReply = await this.waitForStatus(
          ticket.id,
          ['AWAITING_CUSTOMER', 'IN_PROGRESS', 'COMPLETED', 'SCHEDULED'],
          15000,
        )
        if (afterReply) {
          log('✅', stage.roleKeyword.toUpperCase().slice(0, 12), `Responded. Status → ${afterReply.status}`)
        }
      }

      // ── Special handling: Inspection Scheduling (Stage 2) ─────────────────
      // After customer confirms date, force followUpAt to NOW so flipScheduledTickets fires.
      // flipScheduledTickets marks COMPLETED and calls pipelineAdvance internally.
      if (stage.isInspectionScheduling) {
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: { status: 'SCHEDULED', followUpAt: new Date(Date.now() - 60000) },
        })
        log('⚙️', 'DATE', 'Inspection date moved to NOW for testing — flipScheduledTickets will advance to Field Inspector')
        await this.ticketProcessor.flipScheduledTickets()
        await this.sleep(3000)
        continue  // pipelineAdvance handled internally by flipScheduledTickets
      }

      // ── Force-complete if agent did not finish autonomously ───────────────
      const finalCheck = await this.waitForStatus(ticket.id, ['COMPLETED'], 5000)
      if (!finalCheck) {
        await this.markComplete(ticket.id, stage.note)
        log('⚙️', 'FORCE', `Forced COMPLETED: ${stage.note.slice(0, 80)}`)
      } else {
        log('🎯', stage.roleKeyword.toUpperCase().slice(0, 12), 'Completed autonomously!')
      }

      // ── Carrier email — send real email from carrier to homeowner ────────
      if (stage.carrierReply) {
        await this.sendAsCarrier(stage.carrierReply.subject, stage.carrierReply.html, log)
      }

      // ── CRM simulation — write job card fields + tick checklist ──────────
      if (crmJobId) {
        await this.simulateCrmActions(tenantId, crmJobId, stage, playbookStages, log)
      }

      // ── Advance pipeline (all stages except last) ─────────────────────────
      if (stage.idx < ALL_STAGES.length - 1) {
        const ticketFull = await this.prisma.activityTicket.findUnique({
          where: { id: ticket.id },
          include: { assignedAgent: true },
        })
        if (ticketFull) {
          await this.chat.pipelineAdvance(
            tenantId,
            ticketFull as any,
            (ticketFull.assignedAgent ?? { id: 'system', name: 'System', role: '' }) as any,
            stage.note,
          )
          await this.sleep(3000)
        }
      }
    }

    // ── Final summary ─────────────────────────────────────────────────────────
    log('─────', 'DONE', '─'.repeat(57))

    const allTickets = await this.prisma.activityTicket.findMany({
      where: {
        tenantId,
        contactEmail: TEST_CUSTOMER.email,
        createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
      },
      include: { assignedAgent: { select: { name: true } } },
      orderBy: { ticketNumber: 'asc' },
    })

    log('🎉', 'COMPLETE', `All 22 stages done! ${allTickets.length} tickets created.`)
    log('📊', 'SUMMARY', allTickets.map(tk => {
      const si = (tk.metadata as any)?.pipelineStageIndex ?? '?'
      const sn = (tk.metadata as any)?.pipelineStageName ?? tk.title
      const emoji = tk.status === 'COMPLETED' ? '✅' : tk.status === 'SCHEDULED' ? '📅' : tk.status === 'CANCELLED' ? '🚫' : '⏳'
      return `${emoji} S${si} ${sn} | ${tk.assignedAgent?.name ?? '?'} | ${tk.status}`
    }).join(' │ '))

    const customerStages = ALL_STAGES.filter(s => s.replies.length > 0).map(s => `S${s.idx}`).join(', ')
    log('📤', 'EMAILS', `Real outreach emails sent for customer-facing stages: ${customerStages}`)
    log('✉️', 'CHECK', `Check inbox: ${TEST_CUSTOMER.email}`)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Send a real email FROM the insurance carrier TO the homeowner.
   *  Uses the carrier's own SMTP mailbox so the email appears in Ronaldo's
   *  inbox exactly as a real carrier approval/decision email would.
   */
  private async sendAsCarrier(subject: string, html: string, log: (icon: string, label: string, msg: string) => void) {
    try {
      const transporter = nodemailer.createTransport({
        host: CARRIER.smtpHost,
        port: CARRIER.smtpPort,
        secure: false,
        auth: { user: CARRIER.email, pass: CARRIER.smtpPass },
        tls: { rejectUnauthorized: false },
      })
      await transporter.sendMail({
        from: `"${CARRIER.name}" <${CARRIER.email}>`,
        to: TEST_CUSTOMER.email,
        subject,
        html,
      })
      log('📨', 'CARRIER', `Email sent: "${subject}" → ${TEST_CUSTOMER.email}`)
    } catch (err: any) {
      log('⚠️', 'CARRIER', `Failed to send carrier email: ${err.message}`)
    }
  }

  /** Simulate CRM interactions for a completed pipeline stage:
   *  1. Fetch job card (log key fields)
   *  2. Tick all checklist items for this stage
   *  3. Write stage results back to job card
   *  4. Attach document if stage produces one
   *  All errors are swallowed — CRM simulation never blocks the journey.
   */
  private async simulateCrmActions(
    tenantId: string,
    jobId: string,
    stage: StageConfig,
    playbookStages: any[],
    log: (icon: string, label: string, msg: string) => void,
  ) {
    const crmLabel = `CRM S${stage.idx}`

    // 1. Fetch job card
    try {
      const card = await this.crm.getJobCard(tenantId, jobId)
      log('📂', crmLabel, `Job card read — status: ${card.leadStatus ?? '—'} | stage: ${card.currentStageIndex ?? '—'}`)
    } catch (e: any) {
      log('⚠️', crmLabel, `crm_get_job failed: ${e.message} — skipping CRM simulation for this stage`)
      return
    }

    // 2. Tick each checklist item for this stage
    const checklistItems: string[] = playbookStages[stage.idx]?.checklist ?? []
    if (checklistItems.length) {
      let ticked = 0
      for (let i = 0; i < checklistItems.length; i++) {
        try {
          await this.crm.markChecklistItem(tenantId, jobId, stage.idx, i, true, `${stage.roleKeyword} (test journey)`)
          ticked++
        } catch (e: any) {
          log('⚠️', crmLabel, `checklist item ${i} failed: ${e.message}`)
        }
      }
      log('✅', crmLabel, `Checklist: ${ticked}/${checklistItems.length} items ticked`)
    } else {
      log('ℹ️', crmLabel, 'No checklist items in playbook for this stage')
    }

    // 3. Write stage results back to job card
    if (stage.crmUpdate) {
      try {
        const res = await this.crm.updateJobCard(tenantId, jobId, stage.crmUpdate)
        log('💾', crmLabel, `Job card updated: ${res.updatedFields?.join(', ') ?? Object.keys(stage.crmUpdate).join(', ')}`)
      } catch (e: any) {
        log('⚠️', crmLabel, `crm_update_job failed: ${e.message}`)
      }
    }

    // 4. Attach document if this stage generates one
    if (stage.crmDocument) {
      try {
        const res = await this.crm.attachDocument(tenantId, {
          jobId,
          documentType: stage.crmDocument.type,
          fileName: stage.crmDocument.fileName,
          fileUrl: `https://storage.stormbuddy.co/test-journey/${stage.crmDocument.fileName}`,
          uploadedBy: `${stage.roleKeyword} (test journey)`,
          stageIndex: stage.idx,
          notes: `[Test Journey] Auto-generated for Stage ${stage.idx} — ${stage.name}`,
        })
        log('📎', crmLabel, `Document attached: ${stage.crmDocument.fileName} (id: ${res.documentId})`)
      } catch (e: any) {
        log('⚠️', crmLabel, `crm_attach_document failed: ${e.message}`)
      }
    }
  }

  private log(tenantId: string, icon: string, label: string, msg: string) {
    const logs = journeyLogs.get(tenantId) ?? []
    const entry: JourneyLogEntry = { time: new Date().toLocaleTimeString('en-GB'), icon, label, msg }
    logs.push(entry)
    journeyLogs.set(tenantId, logs)
    this.logger.log(`[TestJourney] ${icon} [${label}] ${msg}`)
  }

  private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

  private async wakeAgents() {
    // Fire-and-forget: don't block the journey waiting for LLM responses.
    // waitForStatus() will poll for the result; force-complete fires if agent is too slow.
    this.ticketProcessor.processOpenTickets(true).catch(err =>
      this.logger.warn(`[wakeAgents] background error: ${err?.message}`)
    )
    await this.sleep(3000)
  }

  private async waitForStatus(ticketId: string, targetStatuses: string[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    let lastLog = Date.now()
    while (Date.now() < deadline) {
      const t = await this.prisma.activityTicket.findUnique({
        where: { id: ticketId },
        select: { status: true, activityLog: true, nextAction: true },
      })
      if (t && targetStatuses.includes(t.status)) return t
      // Heartbeat every 8s so the log stays alive
      if (Date.now() - lastLog >= 8000) {
        const remaining = Math.round((deadline - Date.now()) / 1000)
        this.logger.debug(`[waitForStatus] still waiting for ${targetStatuses.join('/')} on ${ticketId} (${remaining}s left)`)
        lastLog = Date.now()
      }
      await this.sleep(2000)
    }
    return null
  }

  private async waitForNewTicket(tenantId: string, stageIndex: number, afterTime: Date, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    let lastLog = Date.now()
    while (Date.now() < deadline) {
      const t = await this.prisma.activityTicket.findFirst({
        where: {
          tenantId,
          contactEmail: TEST_CUSTOMER.email,
          status: { notIn: ['CANCELLED'] },
          createdAt: { gte: afterTime },
          metadata: { path: ['pipelineStageIndex'], equals: stageIndex },
        },
        include: { assignedAgent: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      })
      if (t) return t
      if (Date.now() - lastLog >= 8000) {
        const remaining = Math.round((deadline - Date.now()) / 1000)
        this.logger.debug(`[waitForNewTicket] stage ${stageIndex} not created yet (${remaining}s left)`)
        lastLog = Date.now()
      }
      await this.sleep(2000)
    }
    return null
  }

  /** Cancel any duplicate tickets for the same stage, keeping only the canonical one. */
  private async cancelDuplicatesForStage(tenantId: string, stageIndex: number, keepId: string) {
    await this.prisma.activityTicket.updateMany({
      where: {
        tenantId,
        contactEmail: TEST_CUSTOMER.email,
        id: { not: keepId },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        metadata: { path: ['pipelineStageIndex'], equals: stageIndex },
      },
      data: { status: 'CANCELLED' },
    })
  }

  private async injectReply(ticket: any, body: string, confirmedDate: string | null) {
    const log = Array.isArray(ticket.activityLog) ? ticket.activityLog : []
    const newStatus = confirmedDate ? 'SCHEDULED' : 'OPEN'
    const followUpAt = confirmedDate ? new Date(confirmedDate) : null
    const nextAction = confirmedDate
      ? `Inspection confirmed for ${new Date(confirmedDate).toLocaleDateString('en-GB')} — send confirmation email, then update_ticket(COMPLETED).`
      : `Customer replied: "${body.slice(0, 120)}". Respond via contact_customer(contactEmail: "${TEST_CUSTOMER.email}"). When fully resolved, call update_ticket(COMPLETED).`

    const { count } = await this.prisma.activityTicket.updateMany({
      where: { id: ticket.id, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      data: {
        status: newStatus as any,
        followUpAt,
        nextAction,
        updatedAt: new Date('2020-01-01'),
        activityLog: [...log, {
          agentName: 'System (test)',
          agentId: 'system',
          action: 'CUSTOMER_REPLIED',
          note: `[TEST SIMULATION] Customer replied: "${body.slice(0, 200)}"`,
          timestamp: new Date().toISOString(),
        }] as any,
      },
    })
    if (count === 0) {
      this.logger.warn(`[injectReply] ticket ${ticket.id} was already completed/cancelled — skipping reply injection`)
    }
    return newStatus
  }

  private async markComplete(ticketId: string, note: string) {
    const ticket = await this.prisma.activityTicket.findUnique({ where: { id: ticketId } })
    if (!ticket || ['COMPLETED', 'CANCELLED'].includes(ticket.status)) return
    const log = Array.isArray(ticket.activityLog) ? ticket.activityLog as any[] : []
    await this.prisma.activityTicket.updateMany({
      where: { id: ticketId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: {
        status: 'COMPLETED',
        resolvedAt: new Date(),
        notes: note,
        activityLog: [...log, {
          agentName: 'System (test)',
          agentId: 'system',
          action: 'STAGE_FORCE_COMPLETED',
          note: `[TEST] ${note}`,
          timestamp: new Date().toISOString(),
        }] as any,
      },
    })
  }

  private async createFallbackTicket(tenantId: string, stageIdx: number, stageName: string, agentId?: string, nextAction?: string) {
    return this.prisma.activityTicket.create({
      data: {
        tenantId,
        title: `[Stage ${stageIdx + 1}] ${stageName} — ${TEST_CUSTOMER.name}`,
        type: 'GENERAL', status: 'OPEN', priority: 'HIGH', source: 'INTERNAL',
        contactRef: TEST_CUSTOMER.name, contactEmail: TEST_CUSTOMER.email, contactPhone: TEST_CUSTOMER.phone,
        assignedAgentId: agentId,
        nextAction: nextAction ?? `Complete ${stageName}.`,
        followUpAt: new Date(Date.now() - 1000),
        metadata: { pipelineStageIndex: stageIdx, pipelineStageName: stageName, testJourney: true } as any,
        activityLog: [{ agentName: 'System', agentId: 'system', action: 'PIPELINE_ADVANCED', note: `Fallback ticket for Stage ${stageIdx}.`, timestamp: new Date().toISOString() }] as any,
      },
      include: { assignedAgent: { select: { id: true, name: true, role: true } } },
    })
  }
}
