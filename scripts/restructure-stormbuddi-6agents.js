/**
 * StormBuddi — Final 6-Agent Restructure
 *
 * Final roster:
 *   1. Jackie  — Customer Intake Specialist  (+Eric Property Care)
 *   2. Charlie — Lead Qualification          (+Will Sales)
 *   3. Hanna   — Executive Assistant & PM    (+Leo Ops — ALREADY DONE, skip)
 *   4. Syed    — Social Media + Marketing    (Zara absorbs Syed skills, renamed "Syed")
 *   5. Kevin   — Insurance Specialist        (+Arturo Storm Analyst)
 *   6. Cris    — Estimator                   (unchanged)
 *
 * Deactivated: Jared, Linda, Nora
 *
 * Run: node scripts/restructure-stormbuddi-6agents.js
 */

require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

// ─── IDs (confirmed from live DB) ─────────────────────────────────────────────
const ID = {
  Jackie:  'cmqz393kv000ckpop0ipdlzow',
  Will:    'cmqz393kv000ekpopi4q0v95v',
  Cris:    'cmqz393kw000ikpopiqwoopi4',
  Hanna:   'cmqz393kw000gkpop617q4em4',
  Kevin:   'cmqz393kz000okpop4dcjt8mc',
  Charlie: 'cmqz393ky000kkpop7djvldcc',
  Jared:   'cmqz393ky000mkpopv3iel1ge',
  Arturo:  'cmqz393l4000qkpopkk5nxzm4',
  Zara:    'cmqz3pbcd000skpopl7tjso6p',
  Syed:    'cmqz3pc33000ukpoprp96or0p',
  Linda:   'cmr3pqllo0001bdmczg7tiy3p',
  Nora:    'cmr3pqllt0003bdmcg9avopne',
  Leo:     'cmsda2zqc002hjjyypztlqzch',
  Eric:    'cmsda3h3k002jjjyysatbyik0',
}

// ─── Original canonical prompts (from setup-stormbuddi.js) ────────────────────
const CHARLIE_ORIGINAL = `You are Charlie, the Lead Qualification Specialist at StormBuddi. Your job is to qualify every new inbound lead and determine if they are a good fit for a storm damage claim.

RESPONSIBILITIES:
- Review new lead tickets from the CRM, storm events, and web forms
- Verify the homeowner's property address and confirm it was in the storm impact zone
- Confirm the homeowner has active homeowner's insurance
- Assess the likelihood of significant damage (roof age, storm severity, property type)
- Score the lead: HOT (immediate action), WARM (follow up in 48h), COLD (not viable)
- For HOT/WARM leads: create a ticket and hand off to Hanna (scheduling) immediately
- For COLD leads: update the ticket with reason and set to CANCELLED

QUALIFICATION CHECKLIST:
1. Property in affected ZIP code? (use fetch_storm_data to verify)
2. Active homeowner insurance policy?
3. Roof more than 3 years old?
4. Homeowner willing to schedule an inspection?

If all 4 = YES → HOT lead. Hand off to Hanna immediately.
If 2-3 = YES → WARM lead. Note follow-up in 48 hours.
If fewer than 2 = YES → COLD. Close the ticket.

TOOLS: Use crm_search_contacts to check CRM history. Use fetch_storm_data to verify storm impact. Use create_ticket or update_ticket to progress. Use contact_customer to reach out.`

const JARED_ORIGINAL = `You are Jared, the Field Inspector at StormBuddi. You coordinate and review all property inspections and damage assessments.

RESPONSIBILITIES:
- Receive inspection assignments from Hanna when inspection day arrives
- Coordinate with the on-site contractor to ensure they attend with the right equipment
- Review all damage photos submitted after the inspection
- Write or review the official damage assessment report
- Flag any damage that exceeds what the initial storm report predicted
- Ensure all required documentation is complete before handing off to Kevin

AI PHOTO REVIEW CHECKLIST:
When reviewing inspection photos, look for and document:
- [ ] Missing or displaced shingles (count affected areas)
- [ ] Hail impact marks on shingles (size, pattern, density)
- [ ] Damaged ridge caps or hip caps
- [ ] Dented or creased metal flashings
- [ ] Damaged gutters or downspouts
- [ ] Soft metal damage (vents, A/C fins, skylights)
- [ ] Interior water damage (ceiling stains, attic moisture)
- [ ] Fence or outbuilding damage (often missed in initial claims)

DAMAGE SEVERITY GUIDE:
- Minor: < 10 squares affected, cosmetic damage only
- Moderate: 10-30 squares, functional damage present
- Severe: > 30 squares or structural compromise — URGENT

COMPLETION CRITERIA:
Ticket is COMPLETED when: photos reviewed, damage report written, severity classified, and all findings documented in the ticket notes.

TOOLS: Use update_ticket to add findings and progress. Use get_my_tickets to see inspection queue. Hand off to Kevin (insurance specialist) when complete.`

// ─── Merge utilities (mirrors agent-merge.util.ts) ────────────────────────────
const IDENTITY_PREFIX = /^(you are|you'?re|i am|i'?m|my name is)\b/i
const COMPANY_HEADER  = /^(company context|company|brand)\s*:?\s*$/i
const SECTION_HEADER  = /^[A-Z][A-Z0-9 /&().,+\-]{2,}:?\s*$/
const TICKET_TOOLS    = ['create_ticket', 'update_ticket', 'get_my_tickets']

function firstName(n) { return n.split(/[—(]/)[0].trim().split(/\s+/)[0] || n }

function skillLabel(role) {
  const c = (role || 'additional services')
    .split(/[—(]/)[0]
    .replace(/\b(coordinator|specialist|manager|executive|assistant|officer)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
  return c || 'additional services'
}

function escapeRe(v) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function identityNames(n) {
  const c = n.split(/[—(]/)[0].trim()
  const parts = c.split(/\s+/).filter(Boolean)
  return [...new Set([c, parts[0], parts.join(' ')].filter(Boolean))]
}

function stripCompanySections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out = []; let skipping = false
  for (const line of lines) {
    const t = line.trim()
    if (!skipping && COMPANY_HEADER.test(t)) { skipping = true; continue }
    if (skipping) {
      if (t && SECTION_HEADER.test(t) && !COMPANY_HEADER.test(t)) { skipping = false; out.push(line) }
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

function extractAdditionalSkills(prompt, secondaryName) {
  let text = (prompt || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  const names = identityNames(secondaryName)
  text = stripCompanySections(text)
  text = text.replace(/^(You are|You're|I am|I'm|My name is)\s+[A-Z][A-Za-z''.\-]+[^.]*\.\s*/i, '')
  text = text.split('\n').filter(line => {
    const t = line.trim()
    if (!t) return true
    if (IDENTITY_PREFIX.test(t) && names.some(n => new RegExp(`\\b${escapeRe(n)}\\b`, 'i').test(t))) return false
    return true
  }).join('\n')
  for (const name of names) {
    text = text.replace(new RegExp(`\\b(you are|you'?re|i am|i'?m)\\s+${escapeRe(name)}\\b`, 'gi'), 'you')
  }
  text = text.replace(/\bYOU COORDINATE\b/g, '')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function buildMergedPrompt(primaryPrompt, primaryName, secondary) {
  const primaryBlock = (primaryPrompt || '').trim()
  if (!secondary?.prompt?.trim()) return primaryBlock
  const secRole = skillLabel(secondary.role)
  const skills = extractAdditionalSkills(secondary.prompt, secondary.name)
  const capabilityLines = skills.trim() || `Handle ${secRole} enquiries: understand the scope and book.`
  return `${primaryBlock}

You also handle ${secRole} requests directly — this is part of your role, not a referral.
When a customer asks about ${secRole} work, qualify it, give a realistic price range, and book it yourself.
Do not name or refer to any other colleague for this — you own it end-to-end.

${capabilityLines}

UNIFIED ROLE RULES:
- One identity (${firstName(primaryName)}), one conversation, one booking.
- Handle all service areas in your prompt yourself — never split the customer across agents.
- One question at a time; keep replies short and natural (especially on WhatsApp/SMS).
- Log the correct job type in CRM when creating a ticket.`
}

function mergeTools(a, b) {
  return [...new Set([...(a.tools ?? []), ...(b?.tools ?? []), ...TICKET_TOOLS])]
}
function mergePermissions(a, b) {
  return [...new Set([...(a.permissions ?? []), ...(b?.permissions ?? [])])]
}
function buildApprovalRules(primary, secondary, meta) {
  const p = primary.approvalRules ?? {}
  const s = secondary?.approvalRules ?? {}
  const reqA = Array.isArray(p.requireApprovalFor) ? p.requireApprovalFor : []
  const reqB = Array.isArray(s?.requireApprovalFor) ? s.requireApprovalFor : []
  return { ...p, ...s, requireApprovalFor: [...new Set([...reqA, ...reqB])], mergeSource: meta }
}

// ─── Helper: absorb secondary into primary in-place ───────────────────────────
async function absorbInto(primaryId, primaryOriginalPrompt, primaryDisplayName, secondaryId, label) {
  console.log(`\n  Absorbing ${label} → ${primaryDisplayName} ...`)
  const primary   = await prisma.agent.findUnique({ where: { id: primaryId } })
  const secondary = await prisma.agent.findUnique({ where: { id: secondaryId } })
  if (!primary)   { console.log(`    ⚠  Primary ${primaryDisplayName} not found — skip`);  return }
  if (!secondary) { console.log(`    ⚠  Secondary ${label} not found — skip`); return }

  const basePrompt = primaryOriginalPrompt || primary.prompt
  const meta = {
    primaryAgentId:   primaryId,
    primaryName:      primary.name,
    secondaryAgentId: secondaryId,
    secondaryName:    secondary.name,
    mergedAt:         new Date().toISOString(),
  }

  const prompt      = buildMergedPrompt(basePrompt, primary.name, secondary)
  const tools       = mergeTools(primary, secondary)
  const permissions = mergePermissions(primary, secondary)
  const approvalRules = buildApprovalRules(primary, secondary, meta)

  await prisma.agent.update({
    where: { id: primaryId },
    data: { prompt, tools, permissions, approvalRules, status: 'ACTIVE' },
  })

  // Union knowledge docs
  const secLinks = await prisma.agentKnowledge.findMany({ where: { agentId: secondaryId }, select: { documentId: true } })
  if (secLinks.length) {
    await prisma.agentKnowledge.createMany({
      data: secLinks.map(k => ({ agentId: primaryId, documentId: k.documentId })),
      skipDuplicates: true,
    })
  }

  // Union CRM access
  const secCrm = await prisma.agentCRMAccess.findMany({ where: { agentId: secondaryId } })
  for (const row of secCrm) {
    const existing = await prisma.agentCRMAccess.findUnique({
      where: { agentId_connectionId: { agentId: primaryId, connectionId: row.connectionId } },
    })
    const merged = [...new Set([...(existing?.permissions ?? []), ...row.permissions])]
    await prisma.agentCRMAccess.upsert({
      where: { agentId_connectionId: { agentId: primaryId, connectionId: row.connectionId } },
      create: { agentId: primaryId, connectionId: row.connectionId, permissions: merged },
      update: { permissions: merged },
    })
  }

  // Deactivate secondary
  await prisma.agent.update({ where: { id: secondaryId }, data: { status: 'INACTIVE' } })
  console.log(`    ✅ Done — ${secondary.name} skills absorbed into ${primary.name}. ${secondary.name} deactivated.`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'jawadsyed501@gmail.com' },
    include: { tenant: true },
  })
  if (!user) { console.error('User jawadsyed501@gmail.com not found'); process.exit(1) }

  const tenantId = user.tenant.id
  console.log(`Tenant: ${user.tenant.name} (${tenantId})`)
  console.log('═══════════════════════════════════════════════════════════')

  // ── STEP 1: Reset Charlie — strip Jackie skills, keep original + Will only ──
  console.log('\n── STEP 1: Reset Charlie to original prompt ──────────────')
  const will = await prisma.agent.findUnique({ where: { id: ID.Will } })
  if (!will) {
    console.log('  ⚠  Will not found — resetting Charlie to original only')
    await prisma.agent.update({
      where: { id: ID.Charlie },
      data: { prompt: CHARLIE_ORIGINAL, approvalRules: {} },
    })
    console.log('  ✅ Charlie reset to original (no Will merge — Will not found)')
  } else {
    // Rebuild Charlie = original + Will
    const meta = {
      primaryAgentId: ID.Charlie, primaryName: 'Charlie — Lead Qualification Specialist',
      secondaryAgentId: ID.Will,  secondaryName: will.name,
      mergedAt: new Date().toISOString(),
    }
    const prompt = buildMergedPrompt(CHARLIE_ORIGINAL, 'Charlie — Lead Qualification Specialist', will)
    const charlieCurrent = await prisma.agent.findUnique({ where: { id: ID.Charlie } })
    const tools       = mergeTools({ tools: charlieCurrent.tools }, will)
    const permissions = mergePermissions({ permissions: charlieCurrent.permissions }, will)
    await prisma.agent.update({
      where: { id: ID.Charlie },
      data: { prompt, tools, permissions, approvalRules: buildApprovalRules(charlieCurrent, will, meta) },
    })
    console.log('  ✅ Charlie rebuilt: original Charlie + Will (Sales) only — Jackie removed')
  }

  // ── STEP 2: Reset Jared — strip Eric, restore original prompt ───────────────
  console.log('\n── STEP 2: Reset Jared to original prompt ────────────────')
  await prisma.agent.update({
    where: { id: ID.Jared },
    data: { prompt: JARED_ORIGINAL, approvalRules: {} },
  })
  console.log('  ✅ Jared reset to original Field Inspector prompt — Eric removed')

  // ── STEP 3: Reactivate Jackie ────────────────────────────────────────────────
  console.log('\n── STEP 3: Reactivate Jackie ──────────────────────────────')
  await prisma.agent.update({
    where: { id: ID.Jackie },
    data: { status: 'ACTIVE', approvalRules: {} },
  })
  console.log('  ✅ Jackie reactivated')

  // ── STEP 4: Reactivate Eric ──────────────────────────────────────────────────
  console.log('\n── STEP 4: Reactivate Eric ────────────────────────────────')
  await prisma.agent.update({
    where: { id: ID.Eric },
    data: { status: 'ACTIVE' },
  })
  console.log('  ✅ Eric reactivated')

  // ── STEP 5: Merge Eric → Jackie ──────────────────────────────────────────────
  console.log('\n── STEP 5: Merge Eric → Jackie ────────────────────────────')
  const jackie = await prisma.agent.findUnique({ where: { id: ID.Jackie } })
  await absorbInto(ID.Jackie, jackie.prompt, 'Jackie', ID.Eric, 'Eric (Property Care)')

  // ── STEP 6: Hanna + Leo already done — verify ───────────────────────────────
  console.log('\n── STEP 6: Hanna + Leo ────────────────────────────────────')
  const hanna = await prisma.agent.findUnique({ where: { id: ID.Hanna }, select: { name: true, approvalRules: true } })
  const hannaSrc = (hanna.approvalRules || {}).mergeSource
  if (hannaSrc?.secondaryAgentId === ID.Leo) {
    console.log('  ✅ Hanna already has Leo absorbed — nothing to do')
  } else {
    await absorbInto(ID.Hanna, null, 'Hanna', ID.Leo, 'Leo (Operations)')
  }

  // ── STEP 7: Merge Syed(Marketing) → Zara, rename to "Syed" ─────────────────
  console.log('\n── STEP 7: Merge Syed(Marketing) → Zara, rename to "Syed" ─')
  const syedMarketing = await prisma.agent.findUnique({ where: { id: ID.Syed } })
  const zara          = await prisma.agent.findUnique({ where: { id: ID.Zara } })
  if (!syedMarketing || !zara) {
    console.log('  ⚠  Syed or Zara not found — skipping')
  } else {
    const meta = {
      primaryAgentId: ID.Zara, primaryName: zara.name,
      secondaryAgentId: ID.Syed, secondaryName: syedMarketing.name,
      mergedAt: new Date().toISOString(),
    }
    const prompt      = buildMergedPrompt(zara.prompt, zara.name, syedMarketing)
    const tools       = mergeTools(zara, syedMarketing)
    const permissions = mergePermissions(zara, syedMarketing)
    const approvalRules = buildApprovalRules(zara, syedMarketing, meta)

    await prisma.agent.update({
      where: { id: ID.Zara },
      data: {
        name: 'Syed',
        role: 'Social Media & Marketing Agent',
        prompt, tools, permissions, approvalRules, status: 'ACTIVE',
      },
    })
    await prisma.agent.update({ where: { id: ID.Syed }, data: { status: 'INACTIVE' } })
    console.log('  ✅ Zara updated with Syed\'s marketing skills, renamed to "Syed". Old Syed deactivated.')
  }

  // ── STEP 8: Merge Arturo → Kevin ─────────────────────────────────────────────
  console.log('\n── STEP 8: Merge Arturo → Kevin ───────────────────────────')
  const kevin = await prisma.agent.findUnique({ where: { id: ID.Kevin } })
  await absorbInto(ID.Kevin, kevin.prompt, 'Kevin', ID.Arturo, 'Arturo (Storm Analyst)')

  // ── STEP 9: Deactivate Jared, Linda, Nora ───────────────────────────────────
  console.log('\n── STEP 9: Deactivate Jared, Linda, Nora ──────────────────')
  for (const [name, id] of [['Jared', ID.Jared], ['Linda', ID.Linda], ['Nora', ID.Nora]]) {
    await prisma.agent.update({ where: { id }, data: { status: 'INACTIVE' } })
    console.log(`  ✅ ${name} deactivated`)
  }

  // ── STEP 10: Final summary ────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('FINAL AGENT ROSTER')
  console.log('═══════════════════════════════════════════════════════════')
  const all = await prisma.agent.findMany({
    where: { tenantId },
    select: { id: true, name: true, role: true, status: true, approvalRules: true },
    orderBy: { createdAt: 'asc' },
  })
  const active   = all.filter(a => a.status === 'ACTIVE')
  const inactive = all.filter(a => a.status !== 'ACTIVE')

  console.log(`\nACTIVE (${active.length}):`)
  active.forEach((a, i) => {
    const src = (a.approvalRules || {}).mergeSource
    const tag = src?.secondaryName ? ` [+${src.secondaryName}]` : ''
    console.log(`  ${i + 1}. ${a.name.padEnd(16)} — ${a.role}${tag}`)
  })

  console.log(`\nINACTIVE (${inactive.length}):`)
  inactive.forEach(a => console.log(`  ❌ ${a.name} — ${a.role}`))
}

main()
  .catch(e => { console.error('\nERROR:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
