require('./load-env')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Find tenant by email domain or name
  const user = await prisma.user.findFirst({
    where: { email: 'curtis@stormbuddi.co' },
    include: { tenant: true },
  })
  if (!user) { console.log('User not found'); return }
  
  const tenant = user.tenant
  console.log('Tenant:', tenant.id, '|', tenant.name)
  console.log()

  const agents = await prisma.agent.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, role: true, status: true, tools: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Agents (${agents.length}):`)
  agents.forEach(a => {
    console.log(`  ${a.status === 'ACTIVE' ? '✅' : '❌'} ${a.name} | Role: "${a.role}" | Tools: ${(a.tools || []).join(', ') || 'none'}`)
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
