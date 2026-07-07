/**
 * Updates the Stormbuddy pipeline to the corrected 22-stage roofing workflow.
 *
 * Key structural correction vs previous version:
 *   - Estimate & SOW now happens BEFORE the insurance claim (S5, not S6)
 *   - Proposal Presentation and Contract Signing move up one slot each (S6, S7)
 *   - Insurance Claim Submission & Approval is a single new stage (S8)
 *   - Supplement Request & Carrier Decision is a dedicated new stage (S9)
 *   - S10–S21 are unchanged in content and index
 *
 * Run: node scripts/update-playbook-22-stages.js
 */

const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const NEW_STAGES = [
  // ── DISCOVERY & SALES ────────────────────────────────────────────────────
  {
    name: 'Lead Qualification',
    ownerRole: 'lead qualification specialist',
    trigger: 'New lead arrives from CRM, storm event alert, or web form submission',
    completion: 'Lead scored — property address verified, insurance confirmed, homeowner interested and responsive',
    handoffTo: 'sales assistant',
    sla: '4 hours',
    crmRetrieve: [
      'Insurance carrier name (if on record)',
      'Storm event on file for property ZIP',
    ],
    checklist: [
      'Property address confirmed in service area',
      'Homeowner has active insurance confirmed',
      'Storm event date falls within policy coverage window',
      'Homeowner expressed interest in free inspection',
    ],
  },
  {
    name: 'Sales Consultation',
    ownerRole: 'sales assistant',
    trigger: 'Lead qualified by Charlie',
    completion: 'Homeowner engaged — financing options presented, objections handled, inspection agreed and confirmed',
    handoffTo: 'executive assistant',
    sla: '24 hours',
    crmRetrieve: [
      'Insurance carrier and interest level from Stage 0 notes',
      'Storm event summary (hail size, date) from job card',
    ],
    checklist: [
      'Financing options presented to homeowner',
      'Insurance claim process explained',
      'Free inspection agreed and confirmed by homeowner',
      'Lead status updated to Consultation Done',
    ],
  },
  {
    name: 'Inspection Scheduling',
    ownerRole: 'executive assistant',
    trigger: 'Homeowner agreed to inspection after sales consultation',
    completion: 'Inspection date and time confirmed with homeowner via email, calendar invite sent',
    handoffTo: 'field inspector',
    sla: '24 hours',
    crmRetrieve: [
      'Homeowner preferred contact method from job card',
      'Field inspector (Jared) availability',
    ],
    checklist: [
      'Date AND time confirmed in writing by homeowner',
      'Calendar invite sent to homeowner',
      'Jared briefed with site address and access instructions',
      'Inspection date saved on job card',
    ],
  },

  // ── INSPECTION & VERIFICATION ────────────────────────────────────────────
  {
    name: 'Field Inspection',
    ownerRole: 'field inspector',
    trigger: 'Inspection date reached — system auto-opens ticket on that day',
    completion: 'Damage photos taken, inspection report completed, damage severity documented and uploaded',
    handoffTo: 'storm analyst',
    sla: 'Same day as inspection',
    crmRetrieve: [
      'Storm event date from job card (to document against)',
      'Insurance carrier name from job card',
    ],
    checklist: [
      'Inspection report generated (damage type, coverage %, severity)',
      'Minimum 20 photos captured (roof, gutters, skylights, interior)',
      'Hail size estimated and recorded',
      'Damage severity classified: LOW / MEDIUM / HIGH / TOTAL LOSS',
      'Inspection report attached to job card via crm_attach_document',
    ],
  },
  {
    name: 'Storm Verification',
    ownerRole: 'storm analyst',
    trigger: 'Field inspection report received',
    completion: 'Storm data formally verified via NOAA/NEXRAD — hail size, date, and event ID attached to claim file',
    handoffTo: 'estimator',
    sla: '24 hours',
    crmRetrieve: [
      'Storm event date from job card',
      'Property ZIP code from ticket',
    ],
    checklist: [
      'NOAA/NEXRAD data pulled for property ZIP and storm event date',
      'Hail size confirmed at 1.0 inch or greater',
      'NOAA event ID recorded on job card',
      'Storm verification report generated and attached to job card',
    ],
  },

  // ── ESTIMATING & PROPOSAL ────────────────────────────────────────────────
  {
    name: 'Estimate & Scope of Work',
    ownerRole: 'estimator',
    trigger: 'Storm verification report confirmed and attached',
    completion: 'Contractor estimate completed, Scope of Work document prepared and sent to homeowner for e-signature',
    handoffTo: 'sales assistant',
    sla: '24 hours',
    crmRetrieve: [
      'Inspection report (damage scope and square footage) from job card',
      'Storm verification report from job card',
      'Homeowner material preferences noted on job card (if any)',
    ],
    checklist: [
      'Material quantities calculated correctly',
      'Labour cost calculated for property ZIP code',
      'Itemised estimate generated',
      'Scope of Work document prepared',
      'Estimate total saved on job card',
      'SOW sent to homeowner for e-signature',
    ],
  },
  {
    name: 'Proposal Presentation',
    ownerRole: 'sales assistant',
    trigger: 'Estimate and SOW ready for homeowner review',
    completion: 'Proposal presented to homeowner — pricing, timeline, and warranty explained, homeowner agrees to proceed',
    handoffTo: 'executive assistant',
    sla: '24 hours',
    crmRetrieve: [
      'SOW document from job card documents',
      'Estimate total from job card',
      'Financing options available',
    ],
    checklist: [
      'Pricing, timeline and warranty explained to homeowner',
      'Homeowner objections handled',
      'Written agreement received from homeowner',
      'Lead status updated to Proposal Accepted',
    ],
  },
  {
    name: 'Contract Signing',
    ownerRole: 'executive assistant',
    trigger: 'Homeowner agreed to proceed after proposal presentation',
    completion: 'Signed contract received from homeowner, deposit invoice sent',
    handoffTo: 'insurance specialist',
    sla: '24 hours',
    crmRetrieve: [
      'SOW document from job card',
      'Agreed pricing and payment schedule from job card',
    ],
    checklist: [
      'Contract generated with correct terms',
      'Contract sent for e-signature',
      'Signed contract received and attached to job card',
      'Deposit invoice sent to homeowner',
      'Deposit payment confirmed and saved on job card',
      'Lead status updated to Contract Signed',
    ],
  },

  // ── INSURANCE ────────────────────────────────────────────────────────────
  {
    name: 'Insurance Claim Submission & Approval',
    ownerRole: 'insurance specialist',
    trigger: 'Contract signed and deposit collected',
    completion: 'Claim submitted to carrier with all supporting documents, approval letter received, ACV/RCV confirmed to match estimate',
    handoffTo: 'insurance specialist',
    sla: '5 business days',
    crmRetrieve: [
      'Insurance carrier name and policy number from job card',
      'Inspection report from job card documents',
      'Storm verification report from job card documents',
      'Signed contract from job card documents',
    ],
    checklist: [
      'Claim submitted to carrier with inspection report and storm verification attached',
      'Carrier approval letter received',
      'ACV and RCV amounts confirmed and match estimate',
      'Depreciation holdback amount documented on job card',
      'Claim reference number saved on job card',
      'Approval letter attached to job card',
    ],
  },
  {
    name: 'Supplement Request & Carrier Decision',
    ownerRole: 'insurance specialist',
    trigger: 'Initial carrier approval received — review for missing or underpaid line items',
    completion: 'Supplement submitted, carrier has issued final decision, depreciation holdback fully documented',
    handoffTo: 'estimator',
    sla: '48 hours',
    crmRetrieve: [
      'Carrier approval letter from job card documents',
      'Estimate and approved scope from job card',
      'Claim reference number from job card',
    ],
    checklist: [
      'All missing and underpaid line items identified',
      'Supplement document generated in Xactimate format',
      'Supplement submitted to insurance carrier',
      'Carrier final decision received and documented on job card',
      'Depreciation holdback fully itemised on job card',
      'Any disputed items resolved or formally escalated',
    ],
  },

  // ── MATERIALS ────────────────────────────────────────────────────────────
  {
    name: 'Material Selection',
    ownerRole: 'estimator',
    trigger: 'Insurance claim and supplement finalised',
    completion: 'Roofing materials selected and confirmed by homeowner in writing',
    handoffTo: 'estimator',
    sla: '24 hours',
    crmRetrieve: [
      'Carrier-approved scope and supplement from job card',
      'SOW material specifications from job card',
      'Homeowner preferences noted on job card',
    ],
    checklist: [
      'Shingle brand, product line and colour confirmed by homeowner',
      'Underlayment type confirmed',
      'Selections match carrier-approved scope',
      'Material selections saved on job card',
      'Homeowner written confirmation received',
    ],
  },
  {
    name: 'Material Ordering',
    ownerRole: 'estimator',
    trigger: 'Material selection confirmed by homeowner',
    completion: 'Materials ordered from supplier — delivery date confirmed, PO number logged',
    handoffTo: 'compliance',
    sla: '24 hours',
    crmRetrieve: [
      'Material selections from job card',
      'Installation window or scheduled date from job card',
      'Approved supplier from job card',
    ],
    checklist: [
      'Supplier quote obtained',
      'Purchase Order raised',
      'Delivery date confirmed within installation window',
      'PO number saved on job card',
    ],
  },

  // ── PERMITS & PRODUCTION ─────────────────────────────────────────────────
  {
    name: 'Permit Review',
    ownerRole: 'compliance',
    trigger: 'Materials ordered and delivery date set',
    completion: 'All required permits pulled, code compliance confirmed, contractor cleared to start',
    handoffTo: 'operations coordinator',
    sla: '48 hours',
    crmRetrieve: [
      'Municipality derived from address on ticket',
      'Contractor licence number from job card',
      'SOW and material specs from job card documents',
    ],
    checklist: [
      'Correct permit type identified (re-roof vs new install)',
      'Permit application submitted to local authority',
      'Permit number received and saved on job card',
      'Code compliance requirements verified',
      'Contractor cleared to begin work',
    ],
  },
  {
    name: 'Production Scheduling',
    ownerRole: 'operations coordinator',
    trigger: 'Permit issued and materials delivery date confirmed',
    completion: 'Crew assigned and scheduled, homeowner notified of installation date',
    handoffTo: 'operations coordinator',
    sla: '24 hours',
    crmRetrieve: [
      'Material delivery date from job card',
      'Permit number from job card',
      'Crew availability',
    ],
    checklist: [
      'Crew assigned and confirmed',
      'Start date set after material delivery date',
      'Homeowner notified of start date in writing',
      'Pre-job checklist completed (access, pets, vehicles, valuables)',
      'Lead status updated to Production Scheduled',
    ],
  },
  {
    name: 'Roof Installation',
    ownerRole: 'operations coordinator',
    trigger: 'Installation date reached and crew confirmed on site',
    completion: 'Roof fully installed — all debris removed, site cleaned, job photos uploaded',
    handoffTo: 'field inspector',
    sla: 'Per project timeline',
    crmRetrieve: [
      'Material delivery confirmation from job card',
      'Permit status from job card (must be issued before work starts)',
    ],
    checklist: [
      'Material delivery confirmed on site',
      'Daily progress photos uploaded to job card',
      'No open safety issues',
      'Minimum 30 completion photos uploaded',
      'Site cleaned and all debris removed',
      'Lead status updated to Installation Complete',
    ],
  },

  // ── QUALITY & CLOSE ──────────────────────────────────────────────────────
  {
    name: 'Quality Control Inspection',
    ownerRole: 'field inspector',
    trigger: 'Installation crew marks job complete',
    completion: 'QC inspection passed — all SOW items verified, QC report uploaded',
    handoffTo: 'sales assistant',
    sla: '24 hours after installation',
    crmRetrieve: [
      'Original inspection report from job card (damage points to verify fixed)',
      'SOW checklist from job card documents',
      'Permit requirements from job card',
    ],
    checklist: [
      'All SOW items completed',
      'Permit final inspection passed',
      'QC report generated with before and after photos',
      'Zero punch list items remaining',
      'QC report attached to job card',
    ],
  },
  {
    name: 'Customer Walkthrough',
    ownerRole: 'sales assistant',
    trigger: 'QC inspection passed',
    completion: 'Homeowner has walked the property and is satisfied — written confirmation received',
    handoffTo: 'estimator',
    sla: '24 hours',
    crmRetrieve: [
      'QC sign-off report from job card documents',
      'Original damage photos from job card (for before/after comparison)',
      'Warranty details from job card',
    ],
    checklist: [
      'Homeowner walked the completed roof',
      'Written satisfaction confirmation received from homeowner',
      'Any final punch list items resolved',
      'Lead status updated to Job Accepted by Customer',
    ],
  },
  {
    name: 'Final Invoice',
    ownerRole: 'estimator',
    trigger: 'Customer walkthrough complete and homeowner signed off',
    completion: 'Final invoice sent to homeowner — all line items match approved scope',
    handoffTo: 'executive assistant',
    sla: '24 hours',
    crmRetrieve: [
      'Carrier-approved scope and supplement decisions from job card',
      'Deposit amount already paid from job card',
      'Depreciation holdback amount from job card',
    ],
    checklist: [
      'Invoice matches approved insurance scope exactly',
      'All supplements and change orders included',
      'Depreciation holdback itemised separately',
      'Invoice sent to homeowner and attached to job card',
    ],
  },
  {
    name: 'Payment Collection',
    ownerRole: 'executive assistant',
    trigger: 'Final invoice sent to homeowner',
    completion: 'Full payment received — receipt issued, payment logged on job card',
    handoffTo: 'insurance specialist',
    sla: '5 business days',
    crmRetrieve: [
      'Final invoice amount from job card',
      'ACV cheque status from job card',
      'Homeowner balance owing from job card',
    ],
    checklist: [
      'ACV cheque from carrier received and deposited',
      'Homeowner balance collected',
      'Payment reference number saved on job card',
      'Full receipt issued to homeowner',
      'Lead status updated to Payment Complete',
    ],
  },
  {
    name: 'Warranty Registration',
    ownerRole: 'insurance specialist',
    trigger: 'Payment collected and project financially closed',
    completion: 'Manufacturer warranty registered, certificate emailed to homeowner and saved to job card',
    handoffTo: 'sales assistant',
    sla: '48 hours',
    crmRetrieve: [
      'Material specs (manufacturer, product, colour, quantity) from job card',
      'Contractor licence number from job card',
      'Installation date from job card',
    ],
    checklist: [
      'Warranty registered with manufacturer online',
      'Certificate generated',
      'Certificate emailed to homeowner',
      'Certificate attached to job card',
      'Both material warranty and workmanship warranty confirmed',
    ],
  },
  {
    name: 'Review & Referral Request',
    ownerRole: 'sales assistant',
    trigger: 'Warranty registration confirmed',
    completion: 'Google review request sent, referral request sent, responses logged',
    handoffTo: 'operations coordinator',
    sla: '48 hours',
    crmRetrieve: [
      'Google Business profile link from job card',
    ],
    checklist: [
      'Google review request sent to homeowner',
      'Review received OR 2 follow-up attempts logged',
      'Referral request sent to homeowner',
      'Any referrals captured and added as new leads in CRM',
    ],
  },
  {
    name: 'Project Closeout',
    ownerRole: 'operations coordinator',
    trigger: 'Review and referral request completed',
    completion: 'All documents verified present, lead marked CLOSED-WON, job profitability recorded. Stage completion is computed from the other 21 stages — do not manually tick individual stages.',
    handoffTo: null,
    sla: '24 hours',
    crmRetrieve: [
      'All job card documents (verify completeness before closing)',
    ],
    checklist: [
      'Inspection report attached to job card',
      'Storm verification report attached to job card',
      'Supplement document attached to job card',
      'Signed contract attached to job card',
      'Permit attached to job card',
      'Final invoice attached to job card',
      'Warranty certificate attached to job card',
      'Lead status updated to CLOSED-WON',
      'Job profitability calculated and recorded on job card',
      'Referral leads created in CRM if any',
    ],
  },
]

// ── Re-index map: old DB stage index → new stage index ───────────────────
// Previous DB layout (from last script run):
//   5 = Insurance Analysis & Supplement  → now split across S8/S9 (map to S8)
//   6 = Estimate & Scope                 → S5
//   7 = Proposal Presentation            → S6
//   8 = Contract Signing                 → S7
//   9 = Insurance Claim Approval         → S8
const OLD_TO_NEW = {
  0: 0,   // Lead Qualification
  1: 1,   // Sales Consultation
  2: 2,   // Inspection Scheduling
  3: 3,   // Field Inspection
  4: 4,   // Storm Verification
  5: 8,   // Insurance Analysis & Supplement → Insurance Claim Submission & Approval
  6: 5,   // Estimate & Scope
  7: 6,   // Proposal Presentation
  8: 7,   // Contract Signing
  9: 8,   // Insurance Claim Approval (merged into S8)
  10: 10, // Material Selection
  11: 11, // Material Ordering
  12: 12, // Permit Review
  13: 13, // Production Scheduling
  14: 14, // Roof Installation
  15: 15, // Quality Control Inspection
  16: 16, // Customer Walkthrough
  17: 17, // Final Invoice
  18: 18, // Payment Collection
  19: 19, // Warranty Registration
  20: 20, // Review & Referral Request
  21: 21, // Project Closeout
}

async function main() {
  const tenant = await db.tenant.findFirst({
    where: { name: 'Stormbuddy' },
    select: { id: true, name: true, settings: true },
  })
  if (!tenant) throw new Error('Stormbuddy tenant not found')

  const settings = tenant.settings || {}
  const brain = settings.brain || {}
  const oldPlaybook = brain.operationalPlaybook || {}

  const newPlaybook = {
    ...oldPlaybook,
    updatedAt: new Date().toISOString(),
    pipelineStages: NEW_STAGES,
    rolesAndResponsibilities: [
      { role: 'lead qualification specialist', responsibilities: 'Score and qualify inbound leads (S0). Verify address, insurance, and storm damage likelihood. Call crm_get_job to read the job card. Mark each checklist item via crm_mark_checklist_item before calling update_ticket(COMPLETED).' },
      { role: 'sales assistant', responsibilities: 'Handles Sales Consultation (S1), Proposal Presentation (S6), Customer Walkthrough (S16), Review & Referral (S20). Pull job card via crm_get_job. Use contact_customer to engage homeowner. Tick checklist items and update lead status before completing.' },
      { role: 'executive assistant', responsibilities: 'Handles Inspection Scheduling (S2), Contract Signing (S7), Payment Collection (S18). Pull job card via crm_get_job. Coordinate scheduling and document logistics. Mark checklist and update job card before completing.' },
      { role: 'field inspector', responsibilities: 'Handles Field Inspection (S3) and Quality Control Inspection (S15). Pull job card via crm_get_job. Generate inspection/QC reports and attach via crm_attach_document. Mark all checklist items before completing.' },
      { role: 'storm analyst', responsibilities: 'Handles Storm Verification (S4). Pull job card for storm date and ZIP. Use fetch_storm_data to verify NOAA/NEXRAD data. Attach verification report via crm_attach_document. Log NOAA event ID on job card before completing.' },
      { role: 'insurance specialist', responsibilities: 'Handles Insurance Claim Submission & Approval (S8), Supplement Request & Carrier Decision (S9), Warranty Registration (S19). Pull job card and documents via crm_get_job and crm_get_documents. Submit claim, generate supplement, attach documents, log claim reference number. Mark all checklist items before completing.' },
      { role: 'estimator', responsibilities: 'Handles Estimate & Scope (S5), Material Selection (S10), Material Ordering (S11), Final Invoice (S17). Pull job card for scope and supplement data. Generate documents and attach via crm_attach_document. Save PO, estimate total, invoice on job card. Mark all checklist items before completing.' },
      { role: 'compliance', responsibilities: 'Handles Permit Review (S12). Pull job card for address, contractor licence, and SOW. Submit permit application. Save permit number on job card. Mark all checklist items before completing.' },
      { role: 'operations coordinator', responsibilities: 'Handles Production Scheduling (S13), Roof Installation (S14), Project Closeout (S21). Pull job card for delivery dates, permits, and crew. Monitor installation progress. At closeout, verify all 7 required documents are present on job card, set lead to CLOSED-WON, record profitability.' },
    ],
  }

  await db.tenant.update({
    where: { id: tenant.id },
    data: { settings: { ...settings, brain: { ...brain, operationalPlaybook: newPlaybook } } },
  })

  console.log(`✓ Playbook updated — ${NEW_STAGES.length} stages written to DB`)
  console.log('\nStage summary:')
  NEW_STAGES.forEach((s, i) => {
    console.log(`  [${String(i).padStart(2)}] ${s.name.padEnd(42)} checklist: ${s.checklist.length}  retrieve: ${s.crmRetrieve.length}`)
  })

  // Re-index existing pipeline tickets
  const tickets = await db.activityTicket.findMany({
    where: { tenantId: tenant.id, source: 'PIPELINE', status: { notIn: ['CANCELLED'] } },
    select: { id: true, ticketNumber: true, title: true, metadata: true },
  })

  let reindexed = 0
  for (const t of tickets) {
    const meta = t.metadata || {}
    const oldIdx = meta.pipelineStageIndex
    if (oldIdx === undefined || oldIdx === null) continue
    const newIdx = OLD_TO_NEW[oldIdx]
    if (newIdx === undefined || newIdx === oldIdx) continue
    const newStageName = NEW_STAGES[newIdx]?.name ?? meta.pipelineStageName
    await db.activityTicket.update({
      where: { id: t.id },
      data: { metadata: { ...meta, pipelineStageIndex: newIdx, pipelineStageName: newStageName } },
    })
    console.log(`  ✓ #${String(t.ticketNumber).padStart(4,'0')} stage ${oldIdx} → ${newIdx} (${newStageName})`)
    reindexed++
  }
  console.log(`\n✓ ${reindexed} ticket(s) re-indexed`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
