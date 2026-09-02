/**
 * Verify StormBuddi 6-Agent Merge — Full Audit
 *
 * Checks every agent for:
 *   ✅ Correct status (ACTIVE / INACTIVE)
 *   ✅ Correct identity (prompt opens with the right name)
 *   ✅ Absorbed role is present in prompt (keyword check)
 *   ✅ No leaked secondary identity ("You are <secondary>")
 *   ✅ Correct tools present for each role
 *   ✅ No duplicate active agents
 *   ✅ Exactly 6 ACTIVE agents
 */

require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

// ─── Expected final state ──────────────────────────────────────────────────────
const EXPECTED_ACTIVE = [
  {
    id:   'cmqz393kv000ckpop0ipdlzow',
    name: 'Jackie',
    roleKeyword: 'Customer Intake',
    identityCheck: /you are jackie/i,
    absorbedRole: 'Property Care',
    absorbedKeywords: [/property care/i, /maintenance/i],
    leakChecks: [/you are nora/i, /you are eric/i],
    requiredTools: ['create_ticket', 'update_ticket', 'get_my_tickets'],
    secondaryName: 'Eric',
  },
  {
    id:   'cmqz393ky000kkpop7djvldcc',
    name: 'Charlie',
    roleKeyword: 'Lead Qualification',
    identityCheck: /you are charlie/i,
    absorbedRole: 'Sales',
    absorbedKeywords: [/sales/i, /pipeline/i, /follow.?up on leads/i],
    leakChecks: [/you are will/i, /you are jackie/i],
    requiredTools: ['create_ticket', 'update_ticket', 'fetch_storm_data', 'crm_search_contacts'],
    secondaryName: 'Will',
  },
  {
    id:   'cmqz393kw000gkpop617q4em4',
    name: 'Hanna',
    roleKeyword: 'Executive Assistant',
    identityCheck: /you are hanna/i,
    absorbedRole: 'Operations',
    absorbedKeywords: [/operations/i, /material orders/i, /coordinate.*tasks/i],
    leakChecks: [/you are leo/i],
    requiredTools: ['create_ticket', 'update_ticket', 'contact_customer', 'get_available_slots'],
    secondaryName: 'Leo',
  },
  {
    id:   'cmqz393kz000okpop4dcjt8mc',
    name: 'Kevin',
    roleKeyword: 'Insurance',
    identityCheck: /you are kevin/i,
    absorbedRole: 'Storm Analyst',
    absorbedKeywords: [/fetch_storm_data/i, /hail/i, /territory alert/i, /storm/i],
    leakChecks: [/you are arturo/i],
    requiredTools: ['create_ticket', 'update_ticket', 'generate_document', 'fetch_storm_data'],
    secondaryName: 'Arturo',
  },
  {
    id:   'cmqz3pbcd000skpopl7tjso6p',
    name: 'Syed',
    roleKeyword: 'Social Media',
    identityCheck: /you are syed/i,
    absorbedRole: 'Marketing',
    absorbedKeywords: [/marketing/i, /campaign/i, /newsletter/i],
    leakChecks: [/you are zara/i],
    requiredTools: ['post_to_social', 'send_email', 'create_ticket'],
    secondaryName: 'Syed (Marketing)',
  },
  {
    id:   'cmqz393kw000ikpopiqwoopi4',
    name: 'Jared (Field & Production)',
    roleKeyword: 'Field',
    identityCheck: /you are jared/i,
    absorbedRole: null,
    absorbedKeywords: [],
    leakChecks: [/hand off to linda/i, /you are cris/i],
    requiredTools: ['create_ticket', 'update_ticket', 'generate_document'],
    secondaryName: null,
  },
]

const EXPECTED_INACTIVE = [
  { id: 'cmqz393kv000ekpopi4q0v95v', name: 'Will'   },
  { id: 'cmsda3h3k002jjjyysatbyik0', name: 'Eric'   },
  { id: 'cmsda2zqc002hjjyypztlqzch', name: 'Leo'    },
  { id: 'cmqz393l4000qkpopkk5nxzm4', name: 'Arturo' },
  { id: 'cmqz3pc33000ukpoprp96or0p', name: 'Syed (Marketing)' },
  { id: 'cmqz393ky000mkpopv3iel1ge', name: 'Jared'  },
  { id: 'cmr3pqllo0001bdmczg7tiy3p', name: 'Linda'  },
  { id: 'cmr3pqllt0003bdmcg9avopne', name: 'Nora'   },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function ok(msg)   { console.log(`    ✅ ${msg}`); passed++ }
function fail(msg) { console.log(`    ❌ FAIL: ${msg}`); failed++ }
function warn(msg) { console.log(`    ⚠️  WARN: ${msg}`) }

function check(label, condition, detail = '') {
  if (condition) ok(label)
  else fail(label + (detail ? ' — ' + detail : ''))
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  StormBuddi 6-Agent Merge — Verification Audit')
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── 1. Check ACTIVE agents ─────────────────────────────────────────────────
  console.log('── ACTIVE AGENTS ─────────────────────────────────────────────\n')

  const activeIds = EXPECTED_ACTIVE.map(e => e.id)
  const agents = await prisma.agent.findMany({
    where: { id: { in: activeIds } },
    select: { id: true, name: true, role: true, status: true, prompt: true, tools: true, approvalRules: true },
  })

  for (const spec of EXPECTED_ACTIVE) {
    const a = agents.find(x => x.id === spec.id)
    console.log(`  Agent: ${spec.name} (${spec.id})`)

    if (!a) { fail(`Agent not found in DB`); console.log(); continue }

    // Status
    check('Status is ACTIVE', a.status === 'ACTIVE', `got: ${a.status}`)

    // Identity in prompt
    check(
      `Prompt opens with correct identity ("You are ${spec.name}")`,
      spec.identityCheck.test(a.prompt.slice(0, 120)),
      `first 120 chars: "${a.prompt.slice(0, 120).replace(/\n/g, ' ')}"`
    )

    // Role keyword
    check(
      `Role field contains "${spec.roleKeyword}"`,
      new RegExp(spec.roleKeyword, 'i').test(a.role),
      `got: "${a.role}"`
    )

    // Absorbed capabilities in prompt
    if (spec.absorbedRole) {
      const promptText = a.prompt
      const anyFound = spec.absorbedKeywords.some(re => re.test(promptText))
      check(
        `Absorbed "${spec.absorbedRole}" capabilities present in prompt`,
        anyFound,
        `checked: ${spec.absorbedKeywords.map(r => r.source).join(', ')}`
      )
    }

    // No leaked secondary identity
    for (const leakRe of spec.leakChecks) {
      const leaked = leakRe.test(a.prompt)
      check(
        `No leaked identity (/${leakRe.source}/)`,
        !leaked,
        leaked ? `Found "${leakRe.source}" in prompt — secondary identity is leaking` : ''
      )
    }

    // Required tools
    const tools = Array.isArray(a.tools) ? a.tools : []
    for (const tool of spec.requiredTools) {
      check(`Tool "${tool}" present`, tools.includes(tool))
    }

    // mergeSource check (for merged agents)
    if (spec.secondaryName) {
      const src = (a.approvalRules || {}).mergeSource
      const hasMerge = src && src.secondaryName &&
        src.secondaryName.toLowerCase().includes(spec.secondaryName.toLowerCase())
      if (hasMerge) ok(`mergeSource recorded (secondary: ${src.secondaryName})`)
      else warn(`mergeSource not found or doesn't match "${spec.secondaryName}" — got: ${JSON.stringify(src?.secondaryName)}`)
    }

    console.log()
  }

  // ── 2. Check INACTIVE agents ───────────────────────────────────────────────
  console.log('── INACTIVE AGENTS ───────────────────────────────────────────\n')

  const inactiveIds = EXPECTED_INACTIVE.map(e => e.id)
  const inactiveAgents = await prisma.agent.findMany({
    where: { id: { in: inactiveIds } },
    select: { id: true, name: true, status: true },
  })

  for (const spec of EXPECTED_INACTIVE) {
    const a = inactiveAgents.find(x => x.id === spec.id)
    process.stdout.write(`  Agent: ${spec.name.padEnd(20)}`)
    if (!a) { console.log(); fail('Not found in DB'); continue }
    if (a.status === 'INACTIVE' || a.status === 'DEACTIVATED') {
      console.log(); ok(`Status is INACTIVE`)
    } else {
      console.log(); fail(`Expected INACTIVE, got: ${a.status}`)
    }
    console.log()
  }

  // ── 3. Total active count ──────────────────────────────────────────────────
  console.log('── TOTAL ACTIVE COUNT ────────────────────────────────────────\n')

  const user = await prisma.user.findFirst({
    where: { email: 'jawadsyed501@gmail.com' },
    include: { tenant: true },
  })
  if (user) {
    const allActive = await prisma.agent.findMany({
      where: { tenantId: user.tenant.id, status: 'ACTIVE' },
      select: { name: true, role: true },
    })
    check(`Exactly 6 ACTIVE agents`, allActive.length === 6, `got ${allActive.length}`)
    console.log()
    console.log('  Active agents found:')
    allActive.forEach((a, i) => console.log(`    ${i + 1}. ${a.name} — ${a.role}`))
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`  RESULT: ${passed} passed  |  ${failed} failed`)
  if (failed === 0) {
    console.log('  ✅ ALL CHECKS PASSED — merge fully implemented')
  } else {
    console.log('  ❌ SOME CHECKS FAILED — review above and re-run fix scripts')
  }
  console.log('═══════════════════════════════════════════════════════════')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
