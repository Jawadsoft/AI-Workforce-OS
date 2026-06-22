require('./load-env')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  // Get all agents grouped by tenantId + templateId
  const agents = await prisma.agent.findMany({
    where: { templateId: { not: null } },
    orderBy: { createdAt: 'desc' },
  })

  // Group by tenantId + templateId
  const groups = {}
  for (const agent of agents) {
    const key = `${agent.tenantId}__${agent.templateId}`
    if (!groups[key]) groups[key] = []
    groups[key].push(agent)
  }

  let deleted = 0
  for (const [key, group] of Object.entries(groups)) {
    if (group.length <= 1) continue
    // Keep the first (newest due to orderBy desc), delete the rest
    const [keep, ...duplicates] = group
    console.log(`Keeping  : ${keep.name} (${keep.id}) — created ${keep.createdAt}`)
    for (const dup of duplicates) {
      console.log(`  Deleting: ${dup.name} (${dup.id}) — created ${dup.createdAt}`)
      await prisma.agent.delete({ where: { id: dup.id } })
      deleted++
    }
  }

  console.log(`\n✓ Removed ${deleted} duplicate agent(s).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
