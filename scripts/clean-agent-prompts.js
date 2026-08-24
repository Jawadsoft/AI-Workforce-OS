/**
 * Clean hardcoded colleague name references from all agent prompts.
 * Safe to run on any tenant — only removes "coordinate with / transfer to / consult [name]" patterns.
 * Does NOT touch the agent's own identity line ("You are Will...").
 *
 * Usage:
 *   node scripts/clean-agent-prompts.js                        # dry-run, all tenants (no DB changes)
 *   node scripts/clean-agent-prompts.js --apply                # apply fixes, all tenants
 *   node scripts/clean-agent-prompts.js xtreme                 # dry-run, one tenant
 *   node scripts/clean-agent-prompts.js xtreme --apply         # apply fixes, one tenant
 */
require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

const prisma = new PrismaClient()

const BOLD  = '\x1b[1m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED   = '\x1b[31m'
const RESET = '\x1b[0m'

// ── Patterns to strip from any agent prompt ──────────────────────────────────
// Each entry: { label, find (regex), replace (string or fn) }
const CLEAN_RULES = [
  {
    label: 'Coordinate with [name]',
    find: /[^\n]*\b(coordinate|coordinating|co-ordinate)\s+with\s+[A-Z][a-z]+[^\n]*/gi,
    replace: '',
  },
  {
    label: 'Transfer to [name]',
    find: /[^\n]*\b(transfer|transferring|hand(ing)?\s+off?|route|routing)\s+(to|this\s+to)\s+[A-Z][a-z]+[^\n]*/gi,
    replace: '',
  },
  {
    label: 'Consult / loop in [name]',
    find: /[^\n]*\b(consult|consulting|loop\s+in|loop\s+back\s+with|check\s+with|checking\s+with)\s+[A-Z][a-z]+[^\n]*/gi,
    replace: '',
  },
  {
    label: 'I\'ll get [name] to / ask [name] to',
    find: /[^\n]*(I'?ll\s+(get|ask|have|send)\s+[A-Z][a-z]+\s+to)[^\n]*/gi,
    replace: '',
  },
  {
    label: '[Name] will handle / [Name] can help',
    find: /[^\n]*\b[A-Z][a-z]+\s+(will\s+handle|will\s+help|handles?|covers?|deals?\s+with|is\s+responsible\s+for)[^\n]*/g,
    replace: '',
  },
]

function cleanPrompt(prompt) {
  if (!prompt) return { cleaned: prompt, changes: [] }
  let text = prompt
  const changes = []

  for (const rule of CLEAN_RULES) {
    const before = text
    text = text.replace(rule.find, typeof rule.replace === 'function' ? rule.replace : rule.replace)
    if (text !== before) {
      changes.push(rule.label)
    }
  }

  // Collapse multiple blank lines left by removed lines
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  return { cleaned: text, changes }
}

async function processAgents(tenantId, apply) {
  const where = tenantId ? { tenantId } : {}
  const agents = await prisma.agent.findMany({
    where,
    include: { tenant: { select: { name: true } } },
    orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
  })

  let totalFixed = 0
  let currentTenant = null

  for (const agent of agents) {
    const { cleaned, changes } = cleanPrompt(agent.prompt)
    if (!changes.length) continue

    if (agent.tenantId !== currentTenant) {
      currentTenant = agent.tenantId
      console.log(`\n${BOLD}Tenant: ${agent.tenant?.name ?? agent.tenantId}${RESET}`)
    }

    console.log(`\n  ${BOLD}${agent.name}${RESET} — ${agent.role}`)
    changes.forEach(c => console.log(`    ${YELLOW}removed:${RESET} ${c}`))

    if (apply) {
      await prisma.agent.update({ where: { id: agent.id }, data: { prompt: cleaned } })
      console.log(`    ${GREEN}✓ saved${RESET}`)
    } else {
      console.log(`    ${YELLOW}(dry-run — pass --apply to save)${RESET}`)
    }

    totalFixed++
  }

  return totalFixed
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const tenantArg = args.find(a => !a.startsWith('--'))

  let tenantId = null
  if (tenantArg) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { id: tenantArg },
          { slug: { contains: tenantArg, mode: 'insensitive' } },
          { name: { contains: tenantArg, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    })
    if (!tenant) {
      console.error(`${RED}No tenant found matching "${tenantArg}"${RESET}`)
      process.exit(1)
    }
    tenantId = tenant.id
    console.log(`\n${BOLD}Scope: ${tenant.name}${RESET}`)
  } else {
    console.log(`\n${BOLD}Scope: ALL tenants${RESET}`)
  }

  if (apply) {
    console.log(`${RED}Mode: APPLY — prompts will be updated in DB${RESET}\n`)
  } else {
    console.log(`${YELLOW}Mode: DRY-RUN — no changes saved (add --apply to save)${RESET}\n`)
  }

  const total = await processAgents(tenantId, apply)

  console.log(`\n${BOLD}Done.${RESET} ${total} agent(s) ${apply ? 'updated' : 'would be updated'}.`)
  if (!apply && total > 0) {
    console.log(`${YELLOW}Run with --apply to save the changes.${RESET}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
