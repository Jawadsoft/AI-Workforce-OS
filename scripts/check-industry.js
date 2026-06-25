require('./load-env')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const tenants = await db.tenant.findMany({
    select: { id: true, name: true, industry: true, settings: true },
  })

  console.log('\n=== Tenant Industry Fields ===\n')
  for (const t of tenants) {
    const brainIndustry = (t.settings)?.brain?.industry ?? null
    console.log(`Tenant: ${t.name}`)
    console.log(`  tenant.industry = "${t.industry}"`)
    console.log(`  settings.brain.industry = "${brainIndustry}"`)
    const effective = brainIndustry ?? t.industry ?? ''
    console.log(`  Effective (used by RAG) = "${effective}" → ${effective ? '✔ Will search industry pack' : '✘ MISSING — industry knowledge SKIPPED'}`)
    console.log()
  }

  // Also check IndustryKnowledgePacks
  const packs = await db.industryKnowledgePack.findMany({
    select: { industry: true, _count: { select: { documents: true } } },
  })
  console.log('=== Industry Packs in DB ===\n')
  for (const p of packs) { console.log(`  Pack: "${p.industry}" — ${p._count.documents} docs`) }

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
