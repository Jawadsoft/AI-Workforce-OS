require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'jawadsyed501@gmail.com' },
    include: { tenant: true },
  })
  if (!user) { console.log('User not found'); return }

  const tenant = user.tenant
  console.log('Tenant ID  :', tenant.id)
  console.log('Tenant Name:', tenant.name)
  console.log('WhatsApp Agent:', (tenant.settings || {}).whatsappAgentId || 'NOT SET')
  console.log()

  const agents = await prisma.agent.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, role: true, status: true, tools: true, approvalRules: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Total agents: ${agents.length}`)
  console.log()

  agents.forEach(a => {
    const src = (a.approvalRules || {}).mergeSource
    const mergedTag = src
      ? ` [MERGED: ${src.primaryName} + ${src.secondaryName || 'none'} @ ${src.mergedAt}]`
      : ''
    const status = a.status === 'ACTIVE' ? '[ACTIVE]' : '[INACT ]'
    console.log(`${status} ${a.name.padEnd(14)} | ${a.role.padEnd(42)} | ${a.id}${mergedTag}`)
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
