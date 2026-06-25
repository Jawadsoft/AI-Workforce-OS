/**
 * audit-agent-prompts.js
 *
 * Scans every agent prompt in the database and flags:
 *   1. Hardcoded prices / dollar amounts
 *   2. Hardcoded colleague/person names that may not exist in every tenant
 *   3. Hardcoded location references (cities, states)
 *   4. Hardcoded product/material names that are industry-specific
 *   5. Outdated roofing-specific terminology in non-roofing contexts
 *   6. Generic filler phrases that weaken responses
 *
 * Usage:
 *   node scripts/audit-agent-prompts.js
 *   node scripts/audit-agent-prompts.js --tenant <tenantId>   (filter by tenant)
 *   node scripts/audit-agent-prompts.js --fix-report          (export JSON report)
 */

require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const fs = require('fs')

const prisma = new PrismaClient()

// ── Audit rule definitions ──────────────────────────────────────────────────

const RULES = [
  {
    id: 'hardcoded_price',
    label: '💰 Hardcoded price/dollar amount',
    severity: 'HIGH',
    pattern: /\$[\d,]+(?:\s*[–-]\s*\$[\d,]+)?|\d+\s*(?:dollars?|per\s+(?:linear\s+)?foot|per\s+square)/gi,
    suggestion: 'Replace with "refer to the PRICING section in the knowledge base" or use dynamic pricing from brain.pricingTable',
  },
  {
    id: 'hardcoded_name',
    label: '👤 Hardcoded colleague name',
    severity: 'HIGH',
    // Common hardcoded names found in roofing tenant prompts
    pattern: /\b(Cris|Jackie|Kevin|Maya|Jared|Nora|Will|Chris|Sarah|John|Mike|Tom|Jake|Emma|Lisa)\b(?=\s+(?:just|can|will|has|is|from|said|confirmed|got|handles|manages|deals|covers))/g,
    suggestion: 'Replace with dynamic ${estimatorName}, ${opsName}, ${insuranceName} etc. from the team roster',
  },
  {
    id: 'hardcoded_location',
    label: '📍 Hardcoded location/city/state',
    severity: 'MEDIUM',
    pattern: /\b(Seattle|Houston|Dallas|Texas|Chicago|Miami|Atlanta|Denver|Phoenix|Portland|Austin|Nashville|Boston|New York|Los Angeles|San Diego|Las Vegas)\b/gi,
    suggestion: 'Remove or replace with a variable from brain.serviceAreas',
  },
  {
    id: 'roofing_specific',
    label: '🏠 Roofing-specific terminology (may not apply to all industries)',
    severity: 'MEDIUM',
    pattern: /\b(asphalt shingle|GAF|Owens Corning|CertainTeed|hail damage|granule loss|shingle mat|fiberglass mat|decking|ridge cap|soffit|fascia|drip edge|ice dam|NOAA hail|adjuster|RCV|ACV|supplement|tear.off|roof pitch|square footage of roof)\b/gi,
    suggestion: 'Move to knowledge base documents rather than the agent prompt. Use generic terms like "our primary service" in the prompt.',
  },
  {
    id: 'hardcoded_product',
    label: '🔧 Hardcoded product/brand name',
    severity: 'MEDIUM',
    pattern: /\b(GAF HDZ|Timberline|Duration|Landmark|Owens Corning|CertainTeed|IKO|Malarkey|Atlas|TAMKO)\b/gi,
    suggestion: 'Move product recommendations to knowledge base. Agents should pull pricing from knowledge base, not their prompt.',
  },
  {
    id: 'generic_filler',
    label: '⚠️  Weak filler phrase that reduces response quality',
    severity: 'LOW',
    pattern: /\b(feel free to (ask|reach out|contact)|don't hesitate to|please let me know|I'll look into|someone (from our team|will) (will )?(reach out|contact|get back))\b/gi,
    suggestion: 'Replace with a specific next action: date, number, or concrete step.',
  },
  {
    id: 'old_price_range',
    label: '💰 Specific old price range ($14,000–$19,500 or similar)',
    severity: 'HIGH',
    pattern: /\$1[0-9],\d{3}\s*[–-]\s*\$[1-9]\d,\d{3}/g,
    suggestion: 'Remove — this specific range was hardcoded for roofing. Use knowledge base pricing instead.',
  },
  {
    id: 'hardcoded_sq_footage',
    label: '📐 Hardcoded square footage example',
    severity: 'LOW',
    pattern: /\b(30.square|2[,.]?500\s*sq|3[,.]?600\s*sq|1[,.]?000\s*sq\s*ft)\b/gi,
    suggestion: 'Remove example measurements from prompt — let the LLM use whatever figures the owner provides.',
  },
]

// ── Colour helpers ──────────────────────────────────────────────────────────
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const GREEN  = '\x1b[32m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

function severityColour(s) {
  if (s === 'HIGH')   return RED
  if (s === 'MEDIUM') return YELLOW
  return CYAN
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const tenantFilter = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null
  const exportReport = args.includes('--fix-report')

  console.log(`\n${BOLD}🔍 Agent Prompt Audit${RESET}`)
  console.log('Scanning all agent prompts for hardcoded values and outdated content...\n')

  const agents = await prisma.agent.findMany({
    where: tenantFilter ? { tenantId: tenantFilter } : {},
    include: { tenant: { select: { name: true, id: true } } },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  })

  if (!agents.length) {
    console.log('No agents found.')
    return
  }

  let totalIssues = 0
  let highCount = 0
  let mediumCount = 0
  let lowCount = 0
  const report = []

  let currentTenant = null

  for (const agent of agents) {
    if (!agent.prompt) continue

    const agentIssues = []

    for (const rule of RULES) {
      const matches = [...agent.prompt.matchAll(rule.pattern)]
      if (!matches.length) continue

      // Get unique matched strings with surrounding context
      const findings = matches.map(m => {
        const start  = Math.max(0, m.index - 40)
        const end    = Math.min(agent.prompt.length, m.index + m[0].length + 40)
        const before = agent.prompt.slice(start, m.index).replace(/\n/g, ' ')
        const after  = agent.prompt.slice(m.index + m[0].length, end).replace(/\n/g, ' ')
        return `"...${before}${BOLD}${m[0]}${RESET}${severityColour(rule.severity)}...${after}"${RESET}`
      }).slice(0, 3)  // max 3 examples per rule per agent

      agentIssues.push({ rule, findings, count: matches.length })
      totalIssues += matches.length
      if (rule.severity === 'HIGH')   highCount += matches.length
      if (rule.severity === 'MEDIUM') mediumCount += matches.length
      if (rule.severity === 'LOW')    lowCount += matches.length
    }

    if (!agentIssues.length) continue

    // Print tenant header when it changes
    if (agent.tenant?.id !== currentTenant) {
      currentTenant = agent.tenant?.id
      console.log(`\n${BOLD}═══ Tenant: ${agent.tenant?.name ?? agent.tenantId} ═══${RESET}`)
    }

    console.log(`\n  ${BOLD}Agent: ${agent.name}${RESET} — ${agent.role}`)

    for (const { rule, findings, count } of agentIssues) {
      const col = severityColour(rule.severity)
      console.log(`    ${col}[${rule.severity}] ${rule.label}${RESET} (${count} occurrence${count > 1 ? 's' : ''})`)
      findings.forEach(f => console.log(`      ${col}↳ ${f}`))
      console.log(`      ${GREEN}✏  Fix: ${rule.suggestion}${RESET}`)
    }

    if (exportReport) {
      report.push({
        tenantId: agent.tenantId,
        tenantName: agent.tenant?.name,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        issues: agentIssues.map(({ rule, findings, count }) => ({
          ruleId: rule.id,
          label: rule.label,
          severity: rule.severity,
          count,
          examples: findings.map(f => f.replace(/\x1b\[[0-9;]*m/g, '')),  // strip ANSI
          suggestion: rule.suggestion,
        })),
      })
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}─────────────────────────────────────────${RESET}`)
  console.log(`${BOLD}Summary${RESET}`)
  console.log(`  Agents scanned : ${agents.filter(a => a.prompt).length}`)
  console.log(`  Total issues   : ${totalIssues}`)
  console.log(`  ${RED}HIGH   : ${highCount}${RESET}`)
  console.log(`  ${YELLOW}MEDIUM : ${mediumCount}${RESET}`)
  console.log(`  ${CYAN}LOW    : ${lowCount}${RESET}`)

  if (totalIssues === 0) {
    console.log(`\n  ${GREEN}✅ All prompts look clean!${RESET}`)
  } else {
    console.log(`\n  ${YELLOW}⚠  Review HIGH and MEDIUM issues — they can cause wrong prices or names to appear in responses.${RESET}`)
  }

  if (exportReport && report.length) {
    const outPath = './scripts/prompt-audit-report.json'
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log(`\n  📄 Full report saved to: ${outPath}`)
  }

  console.log()
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
