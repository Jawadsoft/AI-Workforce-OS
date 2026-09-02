/**
 * Merge StormBuddi agents back to the canonical 8 defined in setup-stormbuddi.js
 *
 * Merges:
 *   Jackie (Customer Intake)    → Charlie (Lead Qualification)
 *   Will   (Sales Assistant)    → Charlie (Lead Qualification)
 *   Leo    (Operations)         → Hanna   (Executive Assistant)
 *   Eric   (Property Care)      → Jared   (Field Inspector)
 *
 * Also reactivates Linda (Compliance) and Nora (Customer Service) which are INACTIVE.
 */

require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

// ── Copy of agent-merge.util.ts logic (pure JS) ───────────────────────────────
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
  const out = []
  let skipping = false
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

function buildMergedPrompt(primary, secondary) {
  const primaryBlock = (primary.prompt || '').trim()
  if (!secondary?.prompt?.trim()) return primaryBlock
  const primaryName = firstName(primary.name)
  const secRole = skillLabel(secondary.role)
  const skills = extractAdditionalSkills(secondary.prompt, secondary.name)
  const capabilityLines = skills.trim() || `Handle ${secRole} enquiries: understand the scope and book.`
  return `${primaryBlock}

You also handle ${secRole} requests directly — this is part of your role, not a referral.
When a customer asks about ${secRole} work, qualify it, give a realistic price range, and book it yourself.
Do not name or refer to any other colleague for this — you own it end-to-end.

${capabilityLines}

UNIFIED ROLE RULES:
- One identity (${primaryName}), one conversation, one booking.
- Handle all service areas in your prompt yourself — never split the customer across agents.
- One question at a time; keep replies short and natural (especially on WhatsApp/SMS).
- Log the correct job type in CRM when creating a ticket.`
}

function mergeTools(primary, secondary) {
  return [...new Set([...(primary.tools ?? []), ...(secondary?.tools ?? []), ...TICKET_TOOLS])]
}

function mergePermissions(primary, secondary) {
  return [...new Set([...(primary.permissions ?? []), ...(secondary?.permissions ?? [])])]
}

function mergeApprovalRules(primary, secondary, meta) {
  const p = primary.approvalRules ?? {}
  const s = secondary?.approvalRules ?? {}
  const reqA = Array.isArray(p.requireApprovalFor) ? p.requireApprovalFor : []
  const reqB = Array.isArray(s?.requireApprovalFor) ? s.requireApprovalFor : []
  return { ...p, ...s, requireApprovalFor: [...new Set([...reqA, ...reqB])], mergeSource: meta }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

const MERGES = [
  // { primaryId, secondaryId } — resolved below by name
  { primary: 'Charlie', secondary: 'Jackie' },
  { primary: 'Charlie', secondary: 'Will'   },
  { primary: 'Hanna',   secondary: 'Leo'    },
  { primary: 'Jared',   secondary: 'Eric'   },
]

const REACTIVATE = ['Linda', 'Nora']

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'jawadsyed501@gmail.com' },
    include: { tenant: true },
  })
  if (!user) { console.error('User not found'); process.exit(1) }

  const tenantId = user.tenant.id
  console.log(`Tenant: ${user.tenant.name} (${tenantId})`)
  console.log()

  // Load all agents for this tenant
  const allAgents = await prisma.agent.findMany({ where: { tenantId } })
  const byName = name => allAgents.find(a => a.name.toLowerCase().includes(name.toLowerCase()))

  // ── 1. Reactivate Linda & Nora ──────────────────────────────────────────
  console.log('── Reactivating INACTIVE agents ──────────────────────────────')
  for (const name of REACTIVATE) {
    const agent = byName(name)
    if (!agent) { console.log(`  ⚠  ${name} not found — skipping`); continue }
    if (agent.status === 'ACTIVE') { console.log(`  ✓  ${agent.name} already ACTIVE`); continue }
    await prisma.agent.update({ where: { id: agent.id }, data: { status: 'ACTIVE' } })
    console.log(`  ✅ Reactivated: ${agent.name} (${agent.id})`)
  }
  console.log()

  // ── 2. Run merges (update primary in-place, deactivate secondary) ────────
  console.log('── Merging agents ────────────────────────────────────────────')
  for (const m of MERGES) {
    const primary   = byName(m.primary)
    const secondary = byName(m.secondary)

    if (!primary)   { console.log(`  ⚠  Primary "${m.primary}" not found — skipping`);   continue }
    if (!secondary) { console.log(`  ⚠  Secondary "${m.secondary}" not found — skipping`); continue }

    if (secondary.status === 'INACTIVE') {
      console.log(`  ⚠  Secondary "${secondary.name}" is already INACTIVE — skipping merge`)
      continue
    }

    console.log(`  Merging ${secondary.name} → ${primary.name} ...`)

    const mergeMeta = {
      primaryAgentId:   primary.id,
      primaryName:      primary.name,
      secondaryAgentId: secondary.id,
      secondaryName:    secondary.name,
      mergedAt:         new Date().toISOString(),
    }

    // Re-fetch primary fresh (may have been updated by an earlier merge in this run)
    const freshPrimary = await prisma.agent.findUnique({ where: { id: primary.id } })

    const prompt       = buildMergedPrompt(freshPrimary, secondary)
    const tools        = mergeTools(freshPrimary, secondary)
    const permissions  = mergePermissions(freshPrimary, secondary)
    const approvalRules = mergeApprovalRules(freshPrimary, secondary, mergeMeta)

    // Update primary in-place
    await prisma.agent.update({
      where: { id: primary.id },
      data: { prompt, tools, permissions, approvalRules },
    })

    // Union knowledge docs
    const secLinks = await prisma.agentKnowledge.findMany({
      where: { agentId: secondary.id }, select: { documentId: true },
    })
    if (secLinks.length) {
      await prisma.agentKnowledge.createMany({
        data: secLinks.map(k => ({ agentId: primary.id, documentId: k.documentId })),
        skipDuplicates: true,
      })
    }

    // Union CRM access
    const secCrm = await prisma.agentCRMAccess.findMany({ where: { agentId: secondary.id } })
    for (const row of secCrm) {
      const existing = await prisma.agentCRMAccess.findUnique({
        where: { agentId_connectionId: { agentId: primary.id, connectionId: row.connectionId } },
      })
      const merged = [...new Set([...(existing?.permissions ?? []), ...row.permissions])]
      await prisma.agentCRMAccess.upsert({
        where: { agentId_connectionId: { agentId: primary.id, connectionId: row.connectionId } },
        create: { agentId: primary.id, connectionId: row.connectionId, permissions: merged },
        update: { permissions: merged },
      })
    }

    // Deactivate secondary
    await prisma.agent.update({ where: { id: secondary.id }, data: { status: 'INACTIVE' } })

    // Refresh local cache so next merge in same primary picks up updated record
    const updated = await prisma.agent.findUnique({ where: { id: primary.id } })
    const idx = allAgents.findIndex(a => a.id === primary.id)
    if (idx >= 0) allAgents[idx] = updated

    console.log(`  ✅ Done: ${primary.name} now includes ${secondary.name}'s skills. ${secondary.name} deactivated.`)
  }
  console.log()

  // ── 3. Final summary ──────────────────────────────────────────────────────
  const finalAgents = await prisma.agent.findMany({
    where: { tenantId },
    select: { id: true, name: true, role: true, status: true, approvalRules: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log('── Final agent roster ────────────────────────────────────────')
  finalAgents.forEach(a => {
    const src = (a.approvalRules || {}).mergeSource
    const tag = src ? ` [+${src.secondaryName}]` : ''
    console.log(`  ${a.status === 'ACTIVE' ? '✅' : '❌'} ${a.name.padEnd(14)} ${a.role}${tag}`)
  })
  console.log()
  console.log(`Total agents: ${finalAgents.length} (${finalAgents.filter(a => a.status === 'ACTIVE').length} active)`)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
