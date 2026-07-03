/**
 * Updates the Stormbuddy playbook to match the PDF design:
 *   [0] Lead Qualification      — Charlie  (unchanged)
 *   [1] Sales Consultation      — Will     (NEW — was missing)
 *   [2] Inspection Scheduling   — Hanna    (was [1])
 *   [3] Field Inspection        — Jared    (was [2])
 *   [4] Insurance Analysis      — Kevin    (was [3])
 *   [5] Estimate & Scope        — Cris     (was [4])
 *   [6] Storm Verification      — Arturo   (NEW — was missing)
 *   [7] Compliance & Permit     — Linda    (was [5])
 *
 * Also re-indexes all existing pipeline tickets so their
 * metadata.pipelineStageIndex matches the new positions.
 */

const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const NEW_STAGES = [
  {
    name: 'Lead Qualification',
    ownerRole: 'lead qualification specialist',
    trigger: 'New lead arrives from CRM, storm event alert, or web form submission',
    completion: 'Lead scored — property address verified, insurance confirmed, homeowner interested',
    handoffTo: 'sales assistant',
    sla: '4 hours',
  },
  {
    name: 'Sales Consultation',
    ownerRole: 'sales assistant',
    trigger: 'Lead qualified and confirmed by Charlie',
    completion: 'Homeowner engaged — financing options presented, objections handled, inspection agreed',
    handoffTo: 'executive assistant',
    sla: '24 hours',
  },
  {
    name: 'Inspection Scheduling',
    ownerRole: 'executive assistant',
    trigger: 'Homeowner agreed to inspection after sales consultation',
    completion: 'Inspection date and time confirmed with homeowner via email or phone',
    handoffTo: 'field inspector',
    sla: '24 hours',
  },
  {
    name: 'Field Inspection',
    ownerRole: 'field inspector',
    trigger: 'Inspection date reached (system auto-opens ticket on that day)',
    completion: 'Damage photos uploaded, inspection report completed, damage severity documented',
    handoffTo: 'insurance specialist',
    sla: 'Same day as inspection',
  },
  {
    name: 'Insurance Analysis & Supplement',
    ownerRole: 'insurance specialist',
    trigger: 'Inspection report and photos received from field inspector',
    completion: 'Supplement document generated, all missing/underpaid items identified, submitted to carrier',
    handoffTo: 'estimator',
    sla: '48 hours',
  },
  {
    name: 'Estimate & Scope of Work',
    ownerRole: 'estimator',
    trigger: 'Insurance analysis and supplement filed',
    completion: 'Contractor estimate approved, Scope of Work document sent to homeowner for signature',
    handoffTo: 'storm analyst',
    sla: '24 hours',
  },
  {
    name: 'Storm Verification',
    ownerRole: 'storm analyst',
    trigger: 'Estimate and SOW signed by homeowner',
    completion: 'Storm data formally verified (NOAA, NEXRAD, hail swath) and attached to claim file',
    handoffTo: 'compliance',
    sla: '24 hours',
  },
  {
    name: 'Compliance & Permit Review',
    ownerRole: 'compliance',
    trigger: 'Storm verification complete, all documents ready',
    completion: 'All required permits pulled, code compliance confirmed, contractor cleared to start',
    handoffTo: null,
    sla: '48 hours',
  },
]

// Map old stage index → new stage index
// Old: 0=Charlie, 1=Hanna, 2=Jared, 3=Kevin, 4=Cris, 5=Linda
// New: 0=Charlie, 1=Will(new), 2=Hanna, 3=Jared, 4=Kevin, 5=Cris, 6=Arturo(new), 7=Linda
const OLD_TO_NEW = { 0: 0, 1: 2, 2: 3, 3: 4, 4: 5, 5: 7 }

async function main() {
  // ── 1. Update the playbook in tenant settings ──────────────────────
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
      { role: 'lead qualification specialist', responsibilities: 'Score and qualify inbound leads from CRM, storm events, and web forms. Verify property address, confirm active insurance, assess storm damage likelihood. Route qualified leads to Will (Sales).' },
      { role: 'sales assistant', responsibilities: 'Conduct sales consultation with homeowner. Recommend financing options, handle objections, present value proposition, schedule inspection, send e-signature requests, track conversion rates.' },
      { role: 'executive assistant', responsibilities: 'Schedule all inspections and appointments, coordinate team handoffs, manage daily pipeline, send customer confirmation emails, follow up on no-shows.' },
      { role: 'field inspector', responsibilities: 'Coordinate on-site inspection logistics, review photos submitted by contractor, write damage assessment report, flag underreported damage.' },
      { role: 'insurance specialist', responsibilities: 'Analyze insurance estimates, identify missing and underpaid line items, prepare supplement requests, track carrier responses.' },
      { role: 'estimator', responsibilities: 'Prepare Xactimate estimates, write Scope of Work documents, coordinate with contractors on pricing.' },
      { role: 'storm analyst', responsibilities: 'Formally verify storm event data (NOAA, NEXRAD, hail swaths, wind reports) for the property address and attach to the claim file before compliance review.' },
      { role: 'compliance', responsibilities: 'Review permits required by local building codes, verify contractor licensing, confirm code compliance before work starts.' },
    ],
  }

  await db.tenant.update({
    where: { id: tenant.id },
    data: { settings: { ...settings, brain: { ...brain, operationalPlaybook: newPlaybook } } },
  })
  console.log('✓ Playbook updated — 8 stages written to DB')

  // ── 2. Re-index existing pipeline tickets ──────────────────────────
  const tickets = await db.activityTicket.findMany({
    where: { source: 'PIPELINE' },
    select: { id: true, ticketNumber: true, title: true, metadata: true },
  })

  let reindexed = 0
  for (const t of tickets) {
    const meta = t.metadata || {}
    const oldIdx = meta.pipelineStageIndex
    if (oldIdx === undefined) continue

    const newIdx = OLD_TO_NEW[oldIdx]
    if (newIdx === undefined || newIdx === oldIdx) continue

    const newStageName = NEW_STAGES[newIdx]?.name ?? meta.pipelineStageName
    await db.activityTicket.update({
      where: { id: t.id },
      data: {
        metadata: {
          ...meta,
          pipelineStageIndex: newIdx,
          pipelineStageName: newStageName,
        },
      },
    })
    console.log(`  ✓ #${String(t.ticketNumber).padStart(4,'0')} stage ${oldIdx} → ${newIdx}  (${newStageName})  "${t.title.slice(0,45)}"`)
    reindexed++
  }

  console.log(`\n✓ ${reindexed} ticket(s) re-indexed`)
  console.log('\nNew stage map:')
  NEW_STAGES.forEach((s, i) => console.log(`  [${i}] ${s.name.padEnd(35)} ownerRole: "${s.ownerRole}"`))
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
