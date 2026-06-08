const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true, NOT: { slug: 'platform-admin' } },
    include: {
      agents: { where: { status: 'ACTIVE' }, select: { id: true, name: true, role: true }, take: 5 }
    },
    take: 5,
  })

  tenants.forEach(t => {
    console.log(`\nTenant: ${t.name}`)
    console.log(`  ID: ${t.id}`)
    t.agents.forEach(a => {
      console.log(`  Agent: ${a.name} (${a.role}) | ID: ${a.id}`)
    })
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
