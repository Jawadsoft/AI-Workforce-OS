/**
 * Rebuild existing merged-agent prompts (skills, not second identity).
 * Usage: node scripts/rebuild-merged-prompts.js
 */
require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

const IDENTITY_PREFIX = /^(you are|you'?re|i am|i'?m|my name is)\b/i
const COMPANY_HEADER = /^(company context|company|brand)\s*:?\s*$/i
const SECTION_HEADER = /^[A-Z][A-Z0-9 /&().,+\-]{2,}:?\s*$/

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
    if (!skipping && COMPANY_HEADER.test(trimmed)) {
      skipping = true
      continue
    }
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
  text = text.replace(/^(You are|You're|I am|I'm|My name is)\s+[A-Z][A-Za-z'’.\-]+[^.]*\.\s*/i, '')
  text = text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (IDENTITY_PREFIX.test(trimmed) && names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(trimmed))) {
        return false
      }
      return true
    })
    .join('\n')
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
  const skillsBlock =
    skills || `Handle ${secRole} enquiries: qualify, give a typical price or range, and book.`
  return `${primaryBlock}

═══════════════════════════════════════
ADDITIONAL SKILLS — ${secRole}
═══════════════════════════════════════
You are still ${primaryName} only. The block below is extra capability you handle yourself.
Never name other staff and never say you will consult, coordinate with, or transfer the customer.

${skillsBlock}

COMBINED ROLE RULES:
• One identity (${primaryName}), one conversation, one booking.
• Use your primary role for matching asks; use the additional skills above when the job is in that area.
• If the job spans both, treat it as one job — do not split the customer across agents.
• One question at a time; short, human replies (especially on WhatsApp).
• Log the correct job type in CRM when creating tickets.`
}

const prisma = new PrismaClient()

async function main() {
  const agents = await prisma.agent.findMany()
  let rebuilt = 0
  for (const agent of agents) {
    const src = (agent.approvalRules || {}).mergeSource
    if (!src?.primaryAgentId) continue
    const primary = await prisma.agent.findUnique({ where: { id: src.primaryAgentId } })
    if (!primary) {
      console.log(`skip ${agent.name} — primary missing`)
      continue
    }
    const secondary = src.secondaryAgentId
      ? await prisma.agent.findUnique({ where: { id: src.secondaryAgentId } })
      : null
    const prompt = buildMergedPrompt(primary, secondary)
    await prisma.agent.update({ where: { id: agent.id }, data: { prompt } })
    rebuilt++
    const stillJake = /you are jake/i.test(prompt)
    console.log(`rebuilt: ${agent.name} (${agent.id}) jakeIdentity=${stillJake}`)
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, settings: true } })
  for (const t of tenants) {
    const wa = (t.settings || {}).whatsappAgentId
    if (!wa) continue
    const a = await prisma.agent.findUnique({ where: { id: wa }, select: { name: true, prompt: true } })
    console.log(`WhatsApp agent for ${t.name}: ${a?.name || wa}`)
    if (a?.prompt && /you are jake/i.test(a.prompt)) {
      console.log('  WARNING: WhatsApp agent prompt still contains "You are Jake"')
    }
    if (a?.prompt && /coordinate with Jake/i.test(a.prompt)) {
      console.log('  WARNING: prompt still tells model to coordinate with Jake')
    }
  }
  console.log(`Done. Rebuilt ${rebuilt} merged agent(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
