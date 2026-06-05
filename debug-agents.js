const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Get all tenants
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, industry: true, settings: true },
  })
  console.log('\n=== TENANTS ===')
  tenants.forEach(t => {
    console.log(`  ID: ${t.id}`)
    console.log(`  Name: ${t.name}`)
    console.log(`  Industry: ${t.industry}`)
    console.log(`  Settings: ${JSON.stringify(t.settings)}`)
    console.log()
  })

  // Get all agents
  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, role: true, status: true, tenantId: true, industry: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`=== AGENTS (${agents.length} total) ===`)
  agents.forEach(a => {
    console.log(`  [${a.status}] ${a.name} (${a.role}) — tenant: ${a.tenantId}`)
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
