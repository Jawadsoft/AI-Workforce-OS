const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true, settings: true } })
  for (const tenant of tenants) {
    const s = tenant.settings || {}
    const stages = (s.brain && s.brain.operationalPlaybook && s.brain.operationalPlaybook.pipelineStages) || []
    if (stages.length > 0) {
      console.log('Tenant:', tenant.name, '(', tenant.id, ')')
      console.log('Stages:')
      stages.forEach((st, i) => {
        console.log(`  [${i}] ${st.name} → ownerRole: "${st.ownerRole}"`)
      })
      console.log('\nFull playbook JSON:')
      console.log(JSON.stringify(s.brain.operationalPlaybook, null, 2))
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
