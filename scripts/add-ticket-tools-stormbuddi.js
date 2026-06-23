require('./load-env')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TICKET_TOOLS = ['create_ticket', 'update_ticket', 'get_my_tickets']

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'curtis@stormbuddi.co' },
    include: { tenant: true },
  })
  if (!user) { console.log('User not found'); return }

  const tenantId = user.tenant.id
  console.log('Tenant:', tenantId, '|', user.tenant.name)
  console.log()

  const agents = await prisma.agent.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true, name: true, role: true, tools: true },
  })

  for (const agent of agents) {
    const current = Array.isArray(agent.tools) ? agent.tools : []
    const toAdd = TICKET_TOOLS.filter(t => !current.includes(t))
    if (!toAdd.length) {
      console.log(`✅ ${agent.name} already has ticket tools`)
      continue
    }
    await prisma.agent.update({
      where: { id: agent.id },
      data: { tools: [...current, ...toAdd] },
    })
    console.log(`✅ Added [${toAdd.join(', ')}] to ${agent.name} (${agent.role})`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
