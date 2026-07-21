import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { TicketProcessorScheduler } from './ticket-processor.scheduler'
import { ChatService } from '../chat/chat.service'
import { CrmService } from '../crm/crm.service'
import { AIService } from '../../ai/ai.service'
import * as nodemailer from 'nodemailer'

// ── Simulated email mailboxes ──────────────────────────────────────────────
// CARRIER: sends approval/decision emails FROM the insurance carrier TO the customer.
// CUSTOMER_SMTP: sends claim/supplement emails FROM the customer TO the carrier.
// Both use real SMTP so emails appear in actual inboxes during simulation.

const CARRIER = {
  name: 'State Farm Insurance',
  email: 'paulp@mitiesoft.com',
  smtpHost: 'send.one.com',
  smtpPort: 587,
  smtpPass: 'paulp786@',
}

const CUSTOMER_SMTP = {
  email: 'olise@mitiesoft.com',
  smtpHost: 'send.one.com',
  smtpPort: 587,
  smtpPass: 'olise786@',
}

type JourneyCustomer = { name: string; email: string; phone: string; address: string }

const CRM_DATE_FIELDS = ['inspectionDate', 'installationDate', 'materialDeliveryDate', 'stormEventDate'] as const

/** Normalize crmUpdate payload to match Stormbuddy /api/crm/update-job validation */
function normalizeCrmFields(
  stageIdx: number,
  fields: Record<string, any>,
  existingStageIndex?: number,
): Record<string, any> {
  const out = { ...fields }

  // leadStatus is returned by get-job but is not writable via update-job (422: Invalid leadStatus value)
  delete out.leadStatus

  // Stormbuddy job card stages are 1-based; never regress an already-advanced job
  const targetStage = stageIdx + 1
  if (existingStageIndex === undefined || targetStage >= existingStageIndex) {
    out.currentStageIndex = targetStage
  } else {
    delete out.currentStageIndex
  }

  for (const key of CRM_DATE_FIELDS) {
    if (typeof out[key] === 'string' && out[key].includes('T')) {
      out[key] = out[key].slice(0, 10)
    }
  }

  if (out.damageSeverity === 'HIGH') out.damageSeverity = 'Severe'
  if (out.damageType === 'Hail + Wind') out.damageType = 'Hail'

  return out
}

function formatCrmError(e: any): string {
  const status = e?.response?.status
  const data = e?.response?.data
  const detail = data?.message ?? data?.error
    ?? (data?.errors ? JSON.stringify(data.errors) : null)
    ?? (typeof data === 'string' ? data : data ? JSON.stringify(data) : null)
  return detail ? `${e.message} — ${detail}` : e.message
}

// ── Unified 22-stage config ─────────────────────────────────────────────────
// Each stage drives the full automated journey — no hardcoded stage blocks.

interface StageReply {
  body: string            // Fallback text used if LLM is unavailable or for confirmedDate stages
  persona?: string        // When set, LLM generates a contextual reply using this as extra context
  confirmedDate?: string  // When set, skip LLM and always use hardcoded body (exact date is required)
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
  // Email sent FROM the customer/contractor TO the carrier (claim/supplement submission).
  // Defined as a factory so customer name/address are substituted at runtime.
  customerToCarrier?: (customer: JourneyCustomer, jobId?: string | null) => { subject: string; html: string }
  // Email sent FROM the carrier TO the homeowner (approval/decision response).
  // Defined as a factory so customer name/address are substituted at runtime.
  carrierReply?: (customer: JourneyCustomer, jobId?: string | null) => { subject: string; html: string }
}

const ALL_STAGES: StageConfig[] = [
  // ── DISCOVERY & SALES ────────────────────────────────────────────────────
  {
    idx: 0,
    name: 'Lead Qualification',
    roleKeyword: 'Lead Qualification',
    replies: [
      { body: `Hi, thanks for reaching out! Yes, I noticed some damage on my roof after the storm last week. I'm definitely interested in the free inspection. Can you tell me more about the process and what to expect?`, persona: `You just received an outreach email about a free roof inspection. You noticed roof damage after a recent storm and are interested, but want to know more about how the process works and what to expect.` },
      { body: `That sounds great, I am fully on board. Let's move forward with the inspection. Looking forward to hearing from you.`, persona: `The roofing company has answered your questions about the inspection process. You are satisfied with their answers and ready to move forward.` },
    ],
    note: 'Lead qualified — customer confirmed interest. Advancing to Sales Consultation.',
    crmUpdate: { notes: 'Lead qualified — customer confirmed interest' },
  },
  {
    idx: 1,
    name: 'Sales Consultation',
    roleKeyword: 'Sales',
    replies: [
      { body: `Thanks for explaining the financing options. The insurance claim assistance sounds exactly what I need. I'd like to proceed with the inspection. What are the next steps?`, persona: `The sales agent has explained financing options and the insurance claim assistance process. You are convinced this is the right approach and want to proceed with the inspection.` },
    ],
    note: 'Sales consultation done — homeowner agreed to financing and inspection. Moving to scheduling.',
    crmUpdate: { notes: 'Sales consultation complete' },
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
    crmUpdate: { inspectionDate: '2026-07-10', notes: 'Inspection scheduled' },
  },

  // ── INSPECTION & VERIFICATION ────────────────────────────────────────────
  {
    idx: 3,
    name: 'Field Inspection',
    roleKeyword: 'Field Inspector',
    replies: [],
    note: 'Roof damage documented. Hail dents confirmed on 60% of surface, 3 skylights cracked, gutters bent. Damage severity: HIGH.',
    crmUpdate: { damageSeverity: 'Severe', hailSizeInches: 1.75, damageType: 'Hail' },
    crmDocument: { type: 'inspection_report', fileName: 'inspection-report-2026-07-10.pdf' },
  },
  {
    idx: 4,
    name: 'Storm Verification',
    roleKeyword: 'Storm',
    replies: [],
    note: 'NEXRAD confirmed 1.75" hail on 2026-04-12 over TX 76101. NOAA event ID: HAI-2026-TX-0412. Attached to claim file.',
    crmUpdate: { noaaEventId: 'HAI-2026-TX-0412', stormEventDate: '2026-04-12' },
    crmDocument: { type: 'storm_verification', fileName: 'storm-verification-HAI-2026-TX-0412.pdf' },
  },

  // ── ESTIMATING & PROPOSAL ────────────────────────────────────────────────
  {
    idx: 5,
    name: 'Estimate & Scope of Work',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Estimate: $24,500 (full replacement). SOW prepared and sent to homeowner for e-signature. Contractor: ProRoof TX.',
    crmUpdate: { estimateTotal: 24500 },
    crmDocument: { type: 'sow', fileName: 'scope-of-work-2026-07-11.pdf' },
  },
  {
    idx: 6,
    name: 'Proposal Presentation',
    roleKeyword: 'Sales',
    replies: [
      { body: `I am happy with the proposal. The pricing looks fair and the timeline works for me. I want to proceed. What do I need to sign?`, persona: `You have just reviewed the roofing proposal. The pricing is fair, the warranty is good, and the timeline works for you. You want to move forward and know what the next steps are.` },
    ],
    note: 'Proposal accepted by homeowner. Proceeding to contract signing.',
    crmUpdate: { notes: 'Proposal accepted by homeowner' },
  },
  {
    idx: 7,
    name: 'Contract Signing',
    roleKeyword: 'Executive',
    replies: [
      { body: `I have signed the contract and transferred the deposit. Please go ahead and schedule everything. I am excited to get started!`, persona: `You have received the contract and deposit invoice. You have signed the contract electronically and paid the deposit. You are excited to get the work started.` },
    ],
    note: 'Contract signed by homeowner. Deposit received. Advancing to insurance claim.',
    crmUpdate: { depositPaid: 2000, notes: 'Contract signed — deposit received' },
    crmDocument: { type: 'contract', fileName: 'contract-signed-2026-07-12.pdf' },
  },

  // ── INSURANCE ────────────────────────────────────────────────────────────
  {
    idx: 8,
    name: 'Insurance Claim Submission & Approval',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Claim submitted to carrier. Approval letter received. ACV: $24,500. RCV: $28,900. Claim ref: CLM-2026-TX-00847.',
    crmUpdate: { claimNumber: 'CLM-2026-TX-00847', acvAmount: 24500, rcvAmount: 28900, insuranceCarrier: 'State Farm' },
    crmDocument: { type: 'approval_letter', fileName: 'carrier-approval-CLM-2026-TX-00847.pdf' },
    customerToCarrier: (c, jobId) => ({
      subject: `Roof Damage Claim Submission — Hail & Wind — April 12, 2026${jobId ? ` [Job #${jobId}]` : ''}`,
      html: `
        <p>Dear Claims Team,</p>
        <p>Please find attached the roof damage claim for the property listed below. The damage was sustained during the hail and wind event on <strong>April 12, 2026</strong>.</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:4px 12px 4px 0"><strong>Homeowner:</strong></td><td>${c.name}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Property Address:</strong></td><td>${c.address}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Contact Email:</strong></td><td>${c.email}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Contact Phone:</strong></td><td>${c.phone}</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Damage Type:</strong></td><td>Hail &amp; Wind</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Estimated Damage:</strong></td><td>$28,900.00</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Inspection Report:</strong></td><td>Attached (field-inspection-report.pdf)</td></tr>
          <tr><td style="padding:4px 12px 4px 0"><strong>Storm Verification:</strong></td><td>NOAA Event confirmed — hail ≥ 1.0"</td></tr>
        </table>
        <p>Please process this claim at your earliest convenience. The homeowner is ready to proceed with repairs pending approval.</p>
        <br>
        <p>Regards,<br>
        <strong>StormBuddi Roofing</strong><br>
        ✉ ${CUSTOMER_SMTP.email}</p>
      `,
    }),
    carrierReply: (c, jobId) => ({
      subject: `Re: Roof Damage Claim — CLM-2026-TX-00847 — APPROVED${jobId ? ` [Job #${jobId}]` : ''}`,
      html: `
        <p>Dear ${c.name},</p>
        <p>We have completed our review of your roof damage claim submitted for the property at <strong>${c.address}</strong>.</p>
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
    }),
  },
  {
    idx: 9,
    name: 'Supplement Request & Carrier Decision',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Supplement filed. Identified 12 underpaid line items. Total supplement: $8,400. Depreciation holdback: $4,400. Carrier reference: REF-TX-9876.',
    crmUpdate: { claimReferenceNumber: 'REF-TX-9876', depreciationHoldback: 4400 },
    crmDocument: { type: 'supplement', fileName: 'supplement-REF-TX-9876.pdf' },
    customerToCarrier: (c, jobId) => ({
      subject: `Supplement Request — CLM-2026-TX-00847 — Additional Line Items${jobId ? ` [Job #${jobId}]` : ''}`,
      html: `
        <p>Dear Claims Team,</p>
        <p>We are writing to request a supplement to claim <strong>CLM-2026-TX-00847</strong> for the property at <strong>${c.address}</strong> (homeowner: ${c.name}).</p>
        <p>Upon conducting a detailed scope review, our estimator identified the following items that were missing or underpaid in the original settlement:</p>
        <ul>
          <li>Drip edge replacement — <strong>$1,200.00</strong></li>
          <li>Ice &amp; water shield (full deck) — <strong>$1,800.00</strong></li>
          <li>Pipe boot replacements × 4 — <strong>$640.00</strong></li>
          <li>Additional labour (steep slope) — <strong>$2,100.00</strong></li>
          <li>Gutter &amp; downspout replacement — <strong>$2,660.00</strong></li>
        </ul>
        <p><strong>Total supplement requested: $8,400.00</strong></p>
        <p>Supporting documentation (revised Xactimate estimate and photo evidence) is attached. Please review and confirm your decision at your earliest convenience.</p>
        <br>
        <p>Regards,<br>
        <strong>StormBuddi Roofing</strong><br>
        ✉ ${CUSTOMER_SMTP.email}</p>
      `,
    }),
    carrierReply: (c, jobId) => ({
      subject: `Re: Supplement Request — CLM-2026-TX-00847 — Decision Issued${jobId ? ` [Job #${jobId}]` : ''}`,
      html: `
        <p>Dear ${c.name},</p>
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
    }),
  },

  // ── MATERIALS ────────────────────────────────────────────────────────────
  {
    idx: 10,
    name: 'Material Selection',
    roleKeyword: 'Estimat',
    replies: [
      { body: `I will go with the Owens Corning Duration shingles in Onyx Black. That colour looks great with our house. Please proceed with ordering.`, persona: `The estimator has sent you material options to choose from. You have looked at shingle colours and decided on a style. Confirm your selection and tell them to go ahead with ordering.` },
    ],
    note: 'Homeowner selected Owens Corning Duration shingles, Onyx Black. Material choice confirmed in writing.',
    crmUpdate: {
      materialSpecs: { brand: 'Owens Corning', product: 'Duration', colour: 'Onyx Black' },
    },
  },
  {
    idx: 11,
    name: 'Material Ordering',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Materials ordered from ABC Roofing Supply. PO#2026-TX-4481. Owens Corning Duration, Onyx Black, 28 squares. Delivery confirmed July 14.',
    crmUpdate: { poNumber: 'PO-2026-TX-4481', materialDeliveryDate: '2026-07-14' },
  },

  // ── PERMITS & PRODUCTION ─────────────────────────────────────────────────
  {
    idx: 12,
    name: 'Permit Review',
    roleKeyword: 'Compliance',
    replies: [],
    note: 'Permit #FW-2026-RFG-8847 issued by Fort Worth Municipal. Code compliance confirmed. Contractor ProRoof TX cleared to start.',
    crmUpdate: { permitNumber: 'FW-2026-RFG-8847' },
    crmDocument: { type: 'permit', fileName: 'permit-FW-2026-RFG-8847.pdf' },
  },
  {
    idx: 13,
    name: 'Production Scheduling',
    roleKeyword: 'Operations',
    replies: [],
    note: 'Crew assigned: ProRoof TX (5-person team). Installation scheduled for July 15, 2026. Homeowner notified via email. Pre-job checklist complete.',
    crmUpdate: { installationDate: '2026-07-15', notes: 'Production scheduled' },
  },
  {
    idx: 14,
    name: 'Roof Installation',
    roleKeyword: 'Operations',
    replies: [],
    note: 'Roof fully installed on July 15, 2026. Old shingles removed, new Owens Corning Duration installed. All debris removed. 47 job photos uploaded.',
    crmUpdate: { notes: 'Roof installation complete' },
  },

  // ── QUALITY & CLOSE ──────────────────────────────────────────────────────
  {
    idx: 15,
    name: 'Quality Control Inspection',
    roleKeyword: 'Field Inspector',
    replies: [],
    note: 'QC inspection passed. Flashing properly sealed, ridge cap installed, gutters reattached. Zero punch list items. Job approved.',
    crmDocument: { type: 'qc_report', fileName: 'qc-report-2026-07-16.pdf' },
    crmUpdate: { notes: 'QC inspection passed' },
  },
  {
    idx: 16,
    name: 'Customer Walkthrough',
    roleKeyword: 'Sales',
    replies: [
      { body: `The roof looks absolutely fantastic! I am very happy with the quality of work. The team was professional and cleaned up perfectly. Well done!`, persona: `The roofing crew just finished the installation and you did a walkthrough. The work looks great — clean, professional, exactly what was scoped. Express your satisfaction and sign off on the completion.` },
    ],
    note: 'Homeowner satisfied with completed roof. No punch list items. Signed off on completion.',
    crmUpdate: { notes: 'Customer walkthrough complete — job accepted' },
  },
  {
    idx: 17,
    name: 'Final Invoice',
    roleKeyword: 'Estimat',
    replies: [],
    note: 'Final invoice #INV-2026-TX-0847 sent to homeowner. Total: $28,900. Depreciation holdback noted: $4,400. Balance due from homeowner: $4,400.',
    crmDocument: { type: 'invoice', fileName: 'invoice-INV-2026-TX-0847.pdf' },
    crmUpdate: { balanceOwing: 4400 },
  },
  {
    idx: 18,
    name: 'Payment Collection',
    roleKeyword: 'Executive',
    replies: [
      { body: `Payment sent! I transferred the full outstanding balance via bank transfer. Reference number: TXN-20260720-8847. Please confirm receipt.`, persona: `You received the final invoice for the roof repair. The total due from you is the depreciation holdback balance. Confirm you have made the payment and ask them to confirm receipt.` },
    ],
    note: 'Full payment received. Bank transfer TXN-20260720-8847 confirmed. Receipt issued. Project financially closed.',
    crmUpdate: { balanceOwing: 0, notes: 'Payment received in full' },
  },
  {
    idx: 19,
    name: 'Warranty Registration',
    roleKeyword: 'Insurance',
    replies: [],
    note: 'Owens Corning Platinum Protection warranty registered. Certificate #OC-2026-TX-8847 emailed to homeowner. 50-year material, 25-year workmanship.',
    crmUpdate: { warrantyType: 'Manufacturer 25yr', notes: 'Owens Corning Platinum Protection registered' },
    crmDocument: { type: 'warranty_certificate', fileName: 'warranty-OC-2026-TX-8847.pdf' },
  },
  {
    idx: 20,
    name: 'Review & Referral Request',
    roleKeyword: 'Sales',
    replies: [
      { body: `I just left a 5-star review on Google — really happy with everything. Also, my neighbour the Garcias at 44 Oak Drive also need roof work, I gave them your number!`, persona: `The roofing company has asked you for a Google review and if you know anyone who needs roof work. You are happy with the service and will leave a review. You may mention a neighbour or friend who also has a damaged roof.` },
    ],
    note: '5-star Google review received. Referral logged: Garcia family, 44 Oak Drive, Fort Worth TX 76101. CRM updated.',
    crmUpdate: { notes: 'Referral: Garcia family, 44 Oak Drive, Fort Worth TX 76101' },
  },
  {
    idx: 21,
    name: 'Project Closeout',
    roleKeyword: 'Operations',
    replies: [],
    note: 'All tasks closed. Documents archived. CRM record marked CLOSED-WON. Job profitability: 34%. Project #2026-TX-8847 archived.',
    crmUpdate: { profitability: 8330, notes: 'Project closeout complete' },
  },
]

// ── In-memory log store (per tenant) ─────────────────────────────────────────

export interface JourneyLogEntry {
  time: string
  icon: string
  label: string
  msg: string
}

type JourneyRunStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled'

const journeyLogs            = new Map<string, JourneyLogEntry[]>()
const journeyStatus          = new Map<string, JourneyRunStatus>()
const journeyCancelRequested = new Map<string, boolean>()

class JourneyCancelled extends Error {
  constructor() {
    super('Journey cancelled by user')
    this.name = 'JourneyCancelled'
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TestJourneyService {
  private readonly logger = new Logger(TestJourneyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly ai: AIService,
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

  /** Start the full automated 22-stage journey in the background. Returns immediately.
   *  @param customerOverride  Optional customer details. If omitted the lead is auto-detected
   *                           from the CRM (most recent lead with a job ID).
   */
  startFullJourney(tenantId: string, customerOverride?: { email?: string; name?: string; phone?: string; address?: string }) {
    if (journeyStatus.get(tenantId) === 'running') {
      return { ok: false, message: 'A journey is already running. Wait for it to finish or click Stop.' }
    }
    // Build a partial customer from whatever was explicitly provided.
    // Missing fields (including email) are resolved from CRM inside runFullJourney.
    const email = customerOverride?.email?.trim() ?? ''
    const partial: JourneyCustomer = {
      email,
      name:    customerOverride?.name?.trim()    || (email ? email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''),
      phone:   customerOverride?.phone?.trim()   || '',
      address: customerOverride?.address?.trim() || '',
    }
    journeyLogs.set(tenantId, [])
    journeyCancelRequested.set(tenantId, false)
    journeyStatus.set(tenantId, 'running')
    this.log(tenantId, '🚀', 'START', `Full 22-stage pipeline journey — resolving lead from CRM…`)
    this.log(tenantId, '📤', 'SMTP',  `Emails sent from info@stormbuddy.co`)

    setImmediate(() =>
      this.runFullJourney(tenantId, partial)
        .then(() => {
          journeyStatus.set(tenantId, journeyCancelRequested.get(tenantId) ? 'cancelled' : 'complete')
          journeyCancelRequested.delete(tenantId)
        })
        .catch(async e => {
          journeyCancelRequested.delete(tenantId)
          if (e?.name === 'JourneyCancelled') {
            await this.cancelActiveTestTickets(tenantId).catch(() => {})
            this.log(tenantId, '🛑', 'STOP', 'Journey ended — open test tickets cancelled')
            journeyStatus.set(tenantId, 'cancelled')
            return
          }
          this.log(tenantId, '❌', 'ERROR', e.message)
          this.logger.error(`[TestJourney] ${e.message}`, e.stack)
          journeyStatus.set(tenantId, 'error')
        })
    )

    return { ok: true, message: 'Journey started in background. Poll /operations/test-journey/logs for live updates.' }
  }

  /** Request stop of a running journey. Takes effect between stages / during waits. */
  stopFullJourney(tenantId: string) {
    if (journeyStatus.get(tenantId) !== 'running') {
      return { ok: false, message: 'No journey is currently running.' }
    }
    journeyCancelRequested.set(tenantId, true)
    this.log(tenantId, '🛑', 'STOP', 'Stop requested — ending journey…')
    return { ok: true, message: 'Journey stop requested. It will end shortly.' }
  }

  // ── Manual step helpers (kept for the step-by-step panel) ─────────────────

  async getJourneyTickets(tenantId: string) {
    const tickets = await this.prisma.activityTicket.findMany({
      where: {
        tenantId,
        status: { notIn: ['CANCELLED'] },
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        metadata: { path: ['testJourney'], equals: true },
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
    const stageReply = stageCfg?.replies[0]
    const confirmedDate = stageReply?.confirmedDate

    // If caller didn't provide a body and this stage has a persona, generate via LLM
    let body = replyBody ?? stageReply?.body ?? 'Sounds good, please proceed.'
    if (!replyBody && stageReply?.persona && !confirmedDate) {
      const customer: JourneyCustomer = {
        name:    ticket.contactRef   ?? 'Homeowner',
        email:   ticket.contactEmail ?? '',
        phone:   ticket.contactPhone ?? '',
        address: (ticket.metadata as any)?.propertyAddress ?? ticket.title ?? '',
      }
      body = await this.generateCustomerReply(customer, stageCfg?.name ?? `Stage ${stageIdx}`, stageReply.persona, body)
    }

    return this.injectReply(ticket, body, confirmedDate ?? null)
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

  private async runFullJourney(tenantId: string, customerInit: JourneyCustomer) {
    const t = tenantId
    const log = (icon: string, label: string, msg: string) => this.log(t, icon, label, msg)
    let customer = { ...customerInit }

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

    // ── Resolve customer from CRM ──────────────────────────────────────────────
    // If an email was provided: search for that specific lead and fill in any
    // missing fields (name, phone, address) from CRM data.
    // If no email was provided: fetch the most recent lead that has a job ID.
    let autoJobId: string | null = null

    try {
      const query = customer.email || ''
      const leads = await this.crm.searchLeads(tenantId, query)

      let match: any
      if (customer.email) {
        match = leads?.find((l: any) => l.email?.toLowerCase() === customer.email.toLowerCase() && l.jobId)
          ?? leads?.find((l: any) => l.email?.toLowerCase() === customer.email.toLowerCase())
          ?? leads?.[0]
      } else {
        // No email provided — pick most recent lead with a job ID
        match = leads
          ?.filter((l: any) => l.email && l.jobId)
          .sort((a: any, b: any) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
          ?? leads?.find((l: any) => l.email)
          ?? leads?.[0]
      }

      if (match) {
        customer = {
          name:    match.name    || customer.name    || match.email?.split('@')[0] || 'Customer',
          email:   match.email   || customer.email,
          phone:   match.phone   || customer.phone   || '',
          address: match.address || customer.address || '',
        }
        autoJobId = match.jobId ?? null
        log('🔍', 'CRM', `Lead: ${customer.name} <${customer.email}>${autoJobId ? ` · Job ${autoJobId}` : ''}`)
      } else if (!customer.email) {
        throw new Error('No leads found in CRM. Add a lead in Stormbuddy and try again.')
      } else {
        log('⚠️', 'CRM', `No Stormbuddy lead found for ${customer.email} — using provided details`)
      }
    } catch (e: any) {
      if (!customer.email) throw e   // can't continue without any customer
      log('⚠️', 'CRM', `CRM lookup failed: ${e.message} — using provided email`)
    }

    log('👤', 'CUSTOMER', `${customer.name} <${customer.email}>`)

    // Cancel ALL previous test journey tickets so waitForNewTicket only finds this run
    await this.prisma.activityTicket.updateMany({
      where: {
        tenantId,
        contactEmail: customer.email,
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
    // Email thread anchor (first outgoing messageId) — inherited by all stage tickets so
    // every customer email chains into one thread in their inbox
    let journeyEmailThreadId: string | null = null

    // ── Main loop: iterate all 22 stages ─────────────────────────────────────
    for (const stage of ALL_STAGES) {
      this.assertNotCancelled(tenantId)

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
            title: `New lead — ${customer.name} (Test Journey)`,
            description: `Test journey lead.\nAddress: ${customer.address}`,
            type: 'GENERAL', status: 'OPEN', priority: 'HIGH', source: 'INTERNAL',
            contactRef: customer.name, contactEmail: customer.email, contactPhone: customer.phone,
            assignedAgentId: charlie.id,
            nextAction: `Send an outreach email to the homeowner at ${customer.email} introducing the free roof inspection offer. Use contact_customer(contactEmail: "${customer.email}") to send the email.`,
            followUpAt: new Date(Date.now() - 1000),
            metadata: { pipelineStageIndex: 0, pipelineStageName: 'Lead Qualification', crmLeadId, testJourney: true } as any,
            activityLog: [{ agentName: 'System', agentId: 'system', action: 'TICKET_CREATED', note: `Test journey started. Customer: ${customer.name} <${customer.email}>`, timestamp: new Date().toISOString() }] as any,
          },
          include: { assignedAgent: { select: { id: true, name: true, role: true } } },
        })
        // Patch nextAction with the real ticket short ID so agent passes ticketId to contact_customer for email threading
        await this.prisma.activityTicket.update({
          where: { id: ticket.id },
          data: { nextAction: `Send an outreach email to the homeowner at ${customer.email} introducing the free roof inspection offer. Use contact_customer(contactEmail: "${customer.email}", ticketId: "${ticket.id.slice(-6)}") to send the email.` },
        })
        log('📋', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} created → ${charlie.name}`)

        // Resolve CRM job ID — used for all 22 stages
        // Priority: autoJobId resolved during auto-detect > getJobIdByLeadId > searchLeads fallback
        log('🔗', 'CRM', `Resolving job ID for test journey...`)

        if (autoJobId) {
          crmJobId = autoJobId
          log('🔗', 'CRM', `Job ID from auto-detect: ${crmJobId}`)
        } else {
          crmJobId = await this.crm.getJobIdByLeadId(tenantId, crmLeadId).catch(() => null)
          if (!crmJobId) {
            try {
              const leads = await this.crm.searchLeads(tenantId, customer.email)
              const match = leads?.find((l: any) => l.jobId) ?? leads?.[0]
              crmJobId = match?.jobId ?? null
              if (crmJobId) log('🔗', 'CRM', `Job ID resolved via lead search (${match?.id}): ${crmJobId}`)
            } catch { /* silent */ }
          } else {
            log('🔗', 'CRM', `Job ID resolved from lead ${crmLeadId}: ${crmJobId}`)
          }
        }

        if (!crmJobId) {
          log('⚠️', 'CRM', `No job_id found for ${customer.email} in Stormbuddy — CRM simulation will be skipped`)
        } else {
          // Persist crmJobId in ticket metadata so all pipeline stages can stamp it in email subjects
          await this.prisma.activityTicket.update({
            where: { id: ticket.id },
            data: { metadata: { ...((ticket.metadata as any) ?? {}), crmJobId } },
          }).catch(() => {})
        }
      } else {
        // Stages 1–21: wait for pipelineAdvance to create the ticket, or fall back
        await this.wakeAgents()
        await this.sleep(tenantId, 3000)

        ticket = await this.waitForNewTicket(tenantId, stage.idx, journeyStartTime, 55000, customer.email)
        if (!ticket) {
          log('⚙️', 'CREATE', `Stage ${stage.idx} ticket not auto-created — creating manually`)
          const ag = byRole(stage.roleKeyword)
          ticket = await this.createFallbackTicket(
            tenantId, stage.idx, stage.name, customer, ag?.id,
            playbookStages[stage.idx]?.completion ?? `Complete ${stage.name}.`,
            journeyEmailThreadId ?? undefined,
          )
          log('⚙️', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} → ${ticket.assignedAgent?.name ?? ag?.name ?? '?'}`)
        } else {
          // Ensure emailThreadId is present on pipelineAdvance-created tickets too
          // (pipelineAdvance spreads metadata, so it should be there — but patch if missing)
          if (journeyEmailThreadId) {
            const tMeta = (ticket.metadata as any) ?? {}
            if (!tMeta.emailThreadId) {
              await this.prisma.activityTicket.update({
                where: { id: ticket.id },
                data: { metadata: { ...tMeta, emailThreadId: journeyEmailThreadId } },
              }).catch(() => {})
            }
          }
          log('📋', 'TICKET', `#${String(ticket.ticketNumber).padStart(4,'0')} → ${ticket.assignedAgent?.name ?? '?'}`)
        }
        await this.cancelDuplicatesForStage(tenantId, stage.idx, ticket.id, customer.email)
      }

      // ── Wake agents and wait for initial response ─────────────────────────
      log('⚡', 'WAKE', `Waking ${stage.roleKeyword} agent...`)
      await this.wakeAgents()
      await this.sleep(tenantId, 4000)
      const afterWake = await this.waitForStatus(tenantId, ticket.id, ['AWAITING_CUSTOMER', 'IN_PROGRESS', 'COMPLETED'], 40000)
      if (afterWake) {
        log('✅', stage.roleKeyword.toUpperCase().slice(0, 12), `Status → ${afterWake.status}`)
      } else {
        log('⚠️', stage.roleKeyword.toUpperCase().slice(0, 12), 'No status change yet — injecting customer data next')
      }

      // ── Capture emailThreadId for future stages ───────────────────────────
      if (!journeyEmailThreadId) {
        const freshMeta = await this.prisma.activityTicket.findUnique({
          where: { id: ticket.id },
          select: { metadata: true },
        }).catch(() => null)
        const threadId = (freshMeta?.metadata as any)?.emailThreadId
        if (threadId) {
          journeyEmailThreadId = threadId
          log('🔗', 'THREAD', `Email thread anchor captured: ${threadId.slice(0, 30)}...`)
        }
      }

      // ── Inject customer replies (for customer-facing stages) ──────────────
      for (let ri = 0; ri < stage.replies.length; ri++) {
        const reply = stage.replies[ri]
        const fresh = await this.prisma.activityTicket.findUnique({ where: { id: ticket.id } })
        if (!fresh) continue

        // Only inject if the agent has already responded (ticket is AWAITING_CUSTOMER).
        // If it's still OPEN/IN_PROGRESS the first wake hasn't finished yet — wait a bit more.
        if (fresh.status !== 'AWAITING_CUSTOMER' && fresh.status !== 'IN_PROGRESS') {
          log('⏳', 'CUSTOMER', `Waiting for agent to send first email before injecting reply...`)
          await this.sleep(tenantId, 5000)
        }

        // Generate an LLM-based reply when persona is defined AND this reply doesn't
        // require a specific confirmedDate (exact dates must remain hardcoded).
        let replyBody = reply.body
        if (reply.persona && !reply.confirmedDate) {
          log('🤖', 'CUSTOMER', `Generating LLM reply for ${stage.name}...`)
          replyBody = await this.generateCustomerReply(
            customer,
            stage.name,
            reply.persona,
            reply.body,
          )
        }

        await this.injectReply(fresh, replyBody, reply.confirmedDate ?? null)
        log('📧', 'CUSTOMER', `Replied: "${replyBody.slice(0, 80)}${replyBody.length > 80 ? '...' : ''}"`)

        if (reply.confirmedDate) {
          log('📅', 'DATE', `Confirmed date: ${reply.confirmedDate}`)
        }

        // Only re-wake if the agent hasn't already moved the ticket on its own
        const beforeReplyWake = await this.prisma.activityTicket.findUnique({
          where: { id: ticket.id },
          select: { status: true },
        })
        if (beforeReplyWake && ['COMPLETED', 'SCHEDULED', 'CANCELLED'].includes(beforeReplyWake.status)) {
          log('ℹ️', 'WAKE', `Agent already resolved ticket (${beforeReplyWake.status}) — skipping reply wake`)
        } else {
          log('⚡', 'WAKE', `Waking agent to respond to customer...`)
          await this.wakeAgents()
          await this.sleep(tenantId, 4000)
          const afterReply = await this.waitForStatus(
            tenantId,
            ticket.id,
            ['AWAITING_CUSTOMER', 'IN_PROGRESS', 'COMPLETED', 'SCHEDULED'],
            40000,
          )
          if (afterReply) {
            log('✅', stage.roleKeyword.toUpperCase().slice(0, 12), `Responded. Status → ${afterReply.status}`)
          }
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

        // CRM update must run before continue — otherwise inspectionDate never reaches Stormbuddy
        if (crmJobId) {
          await this.simulateCrmActions(tenantId, crmJobId, stage, playbookStages, log)
        }

        await this.ticketProcessor.flipScheduledTickets()
        await this.sleep(tenantId, 3000)
        continue  // pipelineAdvance handled internally by flipScheduledTickets
      }

      // ── Force-complete if agent did not finish autonomously ───────────────
      const finalCheck = await this.waitForStatus(tenantId, ticket.id, ['COMPLETED'], 5000)
      if (!finalCheck) {
        await this.markComplete(ticket.id, stage.note)
        log('⚙️', 'FORCE', `Forced COMPLETED: ${stage.note.slice(0, 80)}`)
      } else {
        log('🎯', stage.roleKeyword.toUpperCase().slice(0, 12), 'Completed autonomously!')
      }

      // ── Customer → Carrier email (claim/supplement submission) ──────────
      let customerToCarrierMsgId: string | undefined
      if (stage.customerToCarrier) {
        const cc = stage.customerToCarrier(customer, crmJobId)
        customerToCarrierMsgId = await this.sendAsCustomer(cc.subject, cc.html, customer.name, log)
      }

      // ── Carrier → Customer email (approval/decision response) ────────────
      if (stage.carrierReply) {
        const cr = stage.carrierReply(customer, crmJobId)
        // Thread the carrier reply to the customer's submission using In-Reply-To
        await this.sendAsCarrier(cr.subject, cr.html, customer.email, log, customerToCarrierMsgId)
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
          await this.sleep(tenantId, 3000)
        }
      }
    }

    if (journeyCancelRequested.get(tenantId)) {
      await this.cancelActiveTestTickets(tenantId)
      throw new JourneyCancelled()
    }

    // ── Final summary ─────────────────────────────────────────────────────────
    log('─────', 'DONE', '─'.repeat(57))

    const allTickets = await this.prisma.activityTicket.findMany({
      where: {
        tenantId,
        contactEmail: customer.email,
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
    log('✉️', 'CHECK', `Check inbox: ${customer.email}`)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Send a real email FROM the customer/contractor TO the insurance carrier.
   *  Uses the customer SMTP mailbox so the email appears in the carrier's inbox
   *  as a real claim submission or supplement request.
   */
  private async sendAsCustomer(subject: string, html: string, fromName: string, log: (icon: string, label: string, msg: string) => void): Promise<string | undefined> {
    try {
      const transporter = nodemailer.createTransport({
        host: CUSTOMER_SMTP.smtpHost,
        port: CUSTOMER_SMTP.smtpPort,
        secure: false,
        auth: { user: CUSTOMER_SMTP.email, pass: CUSTOMER_SMTP.smtpPass },
        tls: { rejectUnauthorized: false },
      })
      const info = await transporter.sendMail({
        from: `"${fromName}" <${CUSTOMER_SMTP.email}>`,
        to: CARRIER.email,
        subject,
        html,
      })
      log('📤', 'CLAIM', `Email sent: "${subject}" → ${CARRIER.email}`)
      const msgId = (info as any)?.messageId
      this.appendToSentFolder({
        smtpHost: CUSTOMER_SMTP.smtpHost, smtpUser: CUSTOMER_SMTP.email, smtpPass: CUSTOMER_SMTP.smtpPass,
        from: `"${fromName}" <${CUSTOMER_SMTP.email}>`, to: CARRIER.email, subject, html,
        messageId: msgId,
      }).catch(() => {})
      return msgId
    } catch (err: any) {
      log('⚠️', 'CLAIM', `Failed to send claim email: ${err.message}`)
      return undefined
    }
  }

  /** Send a real email FROM the insurance carrier TO the homeowner.
   *  Uses the carrier's own SMTP mailbox so the email appears in the customer's
   *  inbox exactly as a real carrier approval/decision email would.
   *  Pass inReplyTo (messageId of the customer's claim email) to thread correctly.
   */
  private async sendAsCarrier(subject: string, html: string, toEmail: string, log: (icon: string, label: string, msg: string) => void, inReplyTo?: string) {
    try {
      const transporter = nodemailer.createTransport({
        host: CARRIER.smtpHost,
        port: CARRIER.smtpPort,
        secure: false,
        auth: { user: CARRIER.email, pass: CARRIER.smtpPass },
        tls: { rejectUnauthorized: false },
      })
      const info = await transporter.sendMail({
        from: `"${CARRIER.name}" <${CARRIER.email}>`,
        to: toEmail,
        subject,
        html,
        ...(inReplyTo ? { headers: { 'In-Reply-To': inReplyTo, 'References': inReplyTo } } : {}),
      })
      log('📨', 'CARRIER', `Email sent: "${subject}" → ${toEmail}${inReplyTo ? ' (threaded)' : ''}`)
      this.appendToSentFolder({
        smtpHost: CARRIER.smtpHost, smtpUser: CARRIER.email, smtpPass: CARRIER.smtpPass,
        from: `"${CARRIER.name}" <${CARRIER.email}>`, to: toEmail, subject, html,
        messageId: (info as any)?.messageId,
        inReplyTo,
      }).catch(() => {})
    } catch (err: any) {
      log('⚠️', 'CARRIER', `Failed to send carrier email: ${err.message}`)
    }
  }

  /**
   * Append a sent message to the IMAP Sent folder of the sending account.
   * Non-blocking — call with .catch(() => {}) so failures never affect delivery.
   */
  private async appendToSentFolder(params: {
    smtpHost: string
    smtpUser: string
    smtpPass: string
    from: string
    to: string
    subject: string
    html: string
    messageId?: string
    inReplyTo?: string
    references?: string
  }): Promise<void> {
    const { ImapFlow } = await import('imapflow')

    // Derive IMAP host from SMTP host (same logic as email.service.ts)
    let imapHost = params.smtpHost
    if (/^smtp\.office365\.com$/i.test(imapHost))      { imapHost = 'outlook.office365.com' }
    else if (/^smtp\.gmail\.com$/i.test(imapHost))     { imapHost = 'imap.gmail.com' }
    else if (/^smtp\./i.test(imapHost))                { imapHost = imapHost.replace(/^smtp\./i, 'imap.') }
    else if (/^send\./i.test(imapHost))                { imapHost = imapHost.replace(/^send\./i, 'imap.') }

    const client = new ImapFlow({
      host: imapHost, port: 993, secure: true,
      auth: { user: params.smtpUser, pass: params.smtpPass },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000, greetingTimeout: 5000, socketTimeout: 10000,
    })
    client.on('error', () => {})
    try {
      await client.connect()
      const mailboxes = await client.list()
      const sentFolder = mailboxes.find(m =>
        m.flags.has('\\Sent') ||
        /^(\[Gmail\]\/Sent Mail|Sent Items|Sent Messages|Sent|INBOX\.Sent)$/i.test(m.path),
      )
      const folder = sentFolder?.path ?? 'Sent Items'
      const boundary = `b_${Date.now()}`
      const plain = params.html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const raw = [
        `From: ${params.from}`,
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ...(params.messageId  ? [`Message-ID: ${params.messageId}`]  : []),
        ...(params.inReplyTo  ? [`In-Reply-To: ${params.inReplyTo}`]  : []),
        ...(params.references  ? [`References: ${params.references}`]  : []),
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        plain,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        params.html,
        ``,
        `--${boundary}--`,
      ].join('\r\n')
      try {
        await client.append(folder, Buffer.from(raw), ['\\Seen'])
        this.logger.log(`[appendToSent] ✅ Saved to "${folder}" on ${imapHost}`)
      } catch (e: any) {
        if (!e.message?.includes('BigInt')) throw e
      }
    } finally {
      try { await client.logout() } catch {}
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
    let existingStageIndex: number | undefined
    try {
      const card = await this.crm.getJobCard(tenantId, jobId)
      existingStageIndex = card.currentStageIndex
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
        const fields = normalizeCrmFields(stage.idx, stage.crmUpdate, existingStageIndex)
        const res = await this.crm.updateJobCard(tenantId, jobId, fields)
        log('💾', crmLabel, `Job card updated: ${res.updatedFields?.join(', ') ?? Object.keys(fields).join(', ')}`)
      } catch (e: any) {
        log('⚠️', crmLabel, `crm_update_job failed: ${formatCrmError(e)}`)
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
        log('⚠️', crmLabel, `crm_attach_document failed: ${formatCrmError(e)}`)
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

  private assertNotCancelled(tenantId: string) {
    if (journeyCancelRequested.get(tenantId)) throw new JourneyCancelled()
  }

  private async cancelActiveTestTickets(tenantId: string, contactEmail?: string) {
    await this.prisma.activityTicket.updateMany({
      where: {
        tenantId,
        ...(contactEmail ? { contactEmail } : {}),
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        metadata: { path: ['testJourney'], equals: true },
      },
      data: { status: 'CANCELLED' },
    })
  }

  private sleep(tenantId: string, ms: number) {
    const step = 400
    return new Promise<void>((resolve, reject) => {
      let remaining = ms
      const tick = () => {
        if (journeyCancelRequested.get(tenantId)) {
          reject(new JourneyCancelled())
          return
        }
        if (remaining <= 0) {
          resolve()
          return
        }
        const wait = Math.min(step, remaining)
        remaining -= wait
        setTimeout(tick, wait)
      }
      tick()
    })
  }

  private async wakeAgents() {
    await this.ticketProcessor.processOpenTickets(true)
  }

  private async waitForStatus(tenantId: string, ticketId: string, targetStatuses: string[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      this.assertNotCancelled(tenantId)
      const t = await this.prisma.activityTicket.findUnique({
        where: { id: ticketId },
        select: { status: true, activityLog: true, nextAction: true },
      })
      if (t && targetStatuses.includes(t.status)) return t
      await this.sleep(tenantId, 2000)
    }
    return null
  }

  private async waitForNewTicket(tenantId: string, stageIndex: number, afterTime: Date, timeoutMs: number, contactEmail?: string) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      this.assertNotCancelled(tenantId)
      const t = await this.prisma.activityTicket.findFirst({
        where: {
          tenantId,
          ...(contactEmail ? { contactEmail } : {}),
          status: { notIn: ['CANCELLED'] },
          createdAt: { gte: afterTime },
          metadata: { path: ['pipelineStageIndex'], equals: stageIndex },
        },
        include: { assignedAgent: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      })
      if (t) return t
      await this.sleep(tenantId, 2000)
    }
    return null
  }

  /** Cancel any duplicate tickets for the same stage, keeping only the canonical one. */
  private async cancelDuplicatesForStage(tenantId: string, stageIndex: number, keepId: string, contactEmail?: string) {
    await this.prisma.activityTicket.updateMany({
      where: {
        tenantId,
        ...(contactEmail ? { contactEmail } : {}),
        id: { not: keepId },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
        metadata: { path: ['pipelineStageIndex'], equals: stageIndex },
      },
      data: { status: 'CANCELLED' },
    })
  }

  /**
   * Generate a realistic homeowner reply using the LLM.
   * The customer persona is grounded in the journey customer's details and the current
   * pipeline stage so responses are contextually appropriate and vary on every run.
   * If the LLM call fails for any reason, falls back to the provided hardcoded `fallback`.
   */
  private async generateCustomerReply(
    customer: JourneyCustomer,
    stageName: string,
    stagePersona: string,
    fallback: string,
  ): Promise<string> {
    try {
      const systemPrompt = [
        `You are roleplaying as ${customer.name}, a homeowner at ${customer.address}.`,
        `Your roof was damaged by a hail and wind storm in April 2026.`,
        `You have home insurance with State Farm and you are working with a roofing company to repair it.`,
        `You are cooperative, occasionally ask brief realistic questions, and use casual but polite language.`,
        `You reply like a real person sending an email — not a formal business letter.`,
        ``,
        `CURRENT PIPELINE STAGE: ${stageName}`,
        `SITUATION: ${stagePersona}`,
        ``,
        `Write ONLY the email reply body (2–5 sentences).`,
        `Do NOT include Subject:, From:, To:, or sign-off.`,
        `Sound natural and human — vary your wording, avoid generic filler phrases.`,
      ].join('\n')

      const reply = await this.ai.chat(
        systemPrompt,
        [{ role: 'user', content: `Write your reply to the roofing company's latest email.` }],
        undefined,
        { temperature: 0.85, maxTokens: 200 },
      )

      const clean = reply.trim()
      if (clean.length > 10) {
        this.logger.log(`[Journey] LLM customer reply (${stageName}): "${clean.slice(0, 80)}..."`)
        return clean
      }
    } catch (err: any) {
      this.logger.warn(`[Journey] LLM customer reply failed (${stageName}), using fallback: ${err.message}`)
    }
    return fallback
  }

  private async injectReply(ticket: any, body: string, confirmedDate: string | null) {
    const log = Array.isArray(ticket.activityLog) ? ticket.activityLog : []
    const contactEmail: string = ticket.contactEmail ?? ''
    const newStatus = confirmedDate ? 'SCHEDULED' : 'OPEN'
    const followUpAt = confirmedDate ? new Date(confirmedDate) : null
    const ticketShortId = ticket.id.slice(-6)
    const nextAction = confirmedDate
      ? `Inspection confirmed for ${new Date(confirmedDate).toLocaleDateString('en-GB')} — send confirmation email via contact_customer(contactEmail: "${contactEmail}", ticketId: "${ticketShortId}"), then update_ticket(COMPLETED).`
      : `Customer replied: "${body.slice(0, 120)}". Respond via contact_customer(contactEmail: "${contactEmail}", ticketId: "${ticketShortId}"). When fully resolved, call update_ticket(COMPLETED).`

    await this.prisma.activityTicket.update({
      where: { id: ticket.id },
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

    // ── Send a real email from the customer's SMTP to the contractor's inbox ──
    // This closes the bidirectional loop: the contractor's inbox actually receives
    // the customer reply, mirrors what a real homeowner response looks like.
    const toEmail = await this.resolveContractorEmail(ticket.tenantId)
    if (toEmail && CUSTOMER_SMTP.email && CUSTOMER_SMTP.smtpPass) {
      // Retrieve thread anchor from ticket metadata so the reply chains correctly
      const threadMsgId = (ticket.metadata as any)?.emailThreadId
      const injectJobId  = (ticket.metadata as any)?.crmJobId
      const injectLeadId = ticket.leadId ?? (ticket.metadata as any)?.crmLeadId
      const injectJobRef = injectJobId  ? ` [Job #${injectJobId}]`
                         : injectLeadId ? ` [Lead #${injectLeadId}]`
                         : ''
      const subject = `Re: Free Roof Inspection${injectJobRef}`
      const htmlBody = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><p>${body.replace(/\n/g, '<br>')}</p></div>`
      try {
        const transporter = nodemailer.createTransport({
          host: CUSTOMER_SMTP.smtpHost,
          port: CUSTOMER_SMTP.smtpPort,
          secure: false,
          auth: { user: CUSTOMER_SMTP.email, pass: CUSTOMER_SMTP.smtpPass },
          tls: { rejectUnauthorized: false },
        })
        const replyInfo = await transporter.sendMail({
          from: `"${ticket.contactRef ?? 'Customer'}" <${CUSTOMER_SMTP.email}>`,
          to: toEmail,
          subject,
          html: htmlBody,
          text: body,
          ...(threadMsgId ? { inReplyTo: threadMsgId, references: threadMsgId } : {}),
        })
        this.logger.log(`[injectReply] Real reply sent from ${CUSTOMER_SMTP.email} → ${toEmail}`)
        this.appendToSentFolder({
          smtpHost: CUSTOMER_SMTP.smtpHost, smtpUser: CUSTOMER_SMTP.email, smtpPass: CUSTOMER_SMTP.smtpPass,
          from: `"${ticket.contactRef ?? 'Customer'}" <${CUSTOMER_SMTP.email}>`,
          to: toEmail, subject, html: htmlBody,
          messageId: (replyInfo as any)?.messageId,
          ...(threadMsgId ? { inReplyTo: threadMsgId, references: threadMsgId } : {}),
        }).catch(() => {})
      } catch (e: any) {
        this.logger.warn(`[injectReply] Real reply SMTP failed (non-critical): ${e.message}`)
      }
    }

    return newStatus
  }

  /** Look up the contractor's outbound email address from the tenant's SMTP settings. */
  private async resolveContractorEmail(tenantId: string): Promise<string | null> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      })
      const s = (tenant?.settings as Record<string, string>) || {}
      if (s.smtpFromEmail) return s.smtpFromEmail
      if (s.smtpUser)      return s.smtpUser

      // Fall back to ConnectedAccount email
      const account = await this.prisma.connectedAccount.findFirst({
        where: { tenantId, provider: 'imap', status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { accountEmail: true },
      })
      if (account?.accountEmail) return account.accountEmail

      // Fall back to .env
      return process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || null
    } catch {
      return null
    }
  }

  private async markComplete(ticketId: string, note: string) {
    const ticket = await this.prisma.activityTicket.findUnique({ where: { id: ticketId } })
    const log = Array.isArray(ticket?.activityLog) ? ticket!.activityLog as any[] : []
    await this.prisma.activityTicket.update({
      where: { id: ticketId },
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

  private async createFallbackTicket(
    tenantId: string,
    stageIdx: number,
    stageName: string,
    customer: JourneyCustomer,
    agentId?: string,
    nextAction?: string,
    emailThreadId?: string,
  ) {
    return this.prisma.activityTicket.create({
      data: {
        tenantId,
        title: `[Stage ${stageIdx + 1}] ${stageName} — ${customer.name}`,
        type: 'GENERAL', status: 'OPEN', priority: 'HIGH', source: 'INTERNAL',
        contactRef: customer.name, contactEmail: customer.email, contactPhone: customer.phone,
        assignedAgentId: agentId,
        nextAction: nextAction ?? `Complete ${stageName}.`,
        followUpAt: new Date(Date.now() - 1000),
        metadata: {
          pipelineStageIndex: stageIdx,
          pipelineStageName: stageName,
          testJourney: true,
          ...(emailThreadId ? { emailThreadId } : {}),
        } as any,
        activityLog: [{ agentName: 'System', agentId: 'system', action: 'PIPELINE_ADVANCED', note: `Fallback ticket for Stage ${stageIdx}.`, timestamp: new Date().toISOString() }] as any,
      },
      include: { assignedAgent: { select: { id: true, name: true, role: true } } },
    })
  }
}
