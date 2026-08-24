/**
 * Rebuild existing merged-agent prompts using the latest skill-absorption logic.
 *
 * Usage:
 *   node scripts/rebuild-merged-prompts.js                     # all tenants
 *   node scripts/rebuild-merged-prompts.js <tenantId>          # one tenant by ID
 *   node scripts/rebuild-merged-prompts.js xtreme-cleaner      # one tenant by slug or name (partial match)
 *
 * On Render: run from the API service shell, DATABASE_URL is already in the environment.
 * Locally: needs a .env with DATABASE_URL at the repo root.
 */
require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

// ── Prompt helpers (mirrors agent-merge.util.ts) ─────────────────────────────

const IDENTITY_PREFIX = /^(you are|you'?re|i am|i'?m|my name is)\b/i
const COMPANY_HEADER  = /^(company context|company|brand)\s*:?\s*$/i
const SECTION_HEADER  = /^[A-Z][A-Z0-9 /&().,+\-]{2,}:?\s*$/

function firstName(agentName) {
  return agentName.split(/[—(]/)[0].trim().split(/\s+/)[0] || agentName
}

function skillLabel(role) {
  const cleaned = (role || 'additional services')
    .split(/[—(]/)[0]
    .replace(/\b(coordinator|specialist|manager|executive|assistant|officer)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'additional services'
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function identityNames(agentName) {
  const cleaned = agentName.split(/[—(]/)[0].trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  return [...new Set([cleaned, parts[0], parts.join(' ')].filter(Boolean))]
}

function stripCompanySections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let skipping = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!skipping && COMPANY_HEADER.test(trimmed)) { skipping = true; continue }
    if (skipping) {
      if (trimmed && SECTION_HEADER.test(trimmed) && !COMPANY_HEADER.test(trimmed)) {
        skipping = false
        out.push(line)
      }
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
  text = text.split('\n').filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    if (IDENTITY_PREFIX.test(trimmed) && names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(trimmed))) return false
    return true
  }).join('\n')
  for (const name of names) {
    text = text.replace(new RegExp(`\\b(you are|you'?re|i am|i'?m)\\s+${escapeRegExp(name)}\\b`, 'gi'), 'you')
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

  const capabilityLines = skills.trim()
    || `Handle ${secRole} enquiries: understand the scope, give a typical price range, and book.`

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

// ── Main ─────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

async function rebuildForTenant(tenant) {
  const agents = await prisma.agent.findMany({ where: { tenantId: tenant.id } })
  let rebuilt = 0

  for (const agent of agents) {
    const src = (agent.approvalRules || {}).mergeSource
    if (!src?.primaryAgentId) continue

    const primary = await prisma.agent.findFirst({ where: { id: src.primaryAgentId, tenantId: tenant.id } })
    if (!primary) {
      console.log(`  skip "${agent.name}" — primary agent not found`)
      continue
    }

    const secondary = src.secondaryAgentId
      ? await prisma.agent.findFirst({ where: { id: src.secondaryAgentId, tenantId: tenant.id } })
      : null

    const prompt = buildMergedPrompt(primary, secondary)
    await prisma.agent.update({ where: { id: agent.id }, data: { prompt } })
    rebuilt++

    const hasOldIdentity = /you are (jake|alex|[a-z]+)[^a-z]/i.test(prompt.slice(0, 200))
    console.log(`  rebuilt: "${agent.name}" [${agent.id}]${hasOldIdentity ? ' ⚠ still has old identity line — check manually' : ' ✓'}`)
  }

  // Report current WhatsApp agent for this tenant
  const wa = (tenant.settings || {}).whatsappAgentId
  if (wa) {
    const waAgent = await prisma.agent.findUnique({ where: { id: wa }, select: { name: true, id: true } })
    console.log(`  WhatsApp agent: ${waAgent?.name || wa}`)
  } else {
    console.log(`  WhatsApp agent: not set`)
  }

  return rebuilt
}

async function main() {
  const filter = process.argv[2]

  let tenants
  if (filter) {
    tenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { id: filter },
          { slug: { contains: filter, mode: 'insensitive' } },
          { name: { contains: filter, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, slug: true, settings: true },
    })
    if (!tenants.length) {
      console.error(`No tenant found matching "${filter}"`)
      process.exit(1)
    }
  } else {
    tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, settings: true },
    })
  }

  console.log(`\nRebuilding merged-agent prompts for ${tenants.length} tenant(s)...\n`)

  let totalRebuilt = 0
  for (const tenant of tenants) {
    console.log(`Tenant: ${tenant.name} (${tenant.slug || tenant.id})`)
    const count = await rebuildForTenant(tenant)
    console.log(`  => ${count} agent(s) rebuilt\n`)
    totalRebuilt += count
  }

  console.log(`Done. Total rebuilt: ${totalRebuilt}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
