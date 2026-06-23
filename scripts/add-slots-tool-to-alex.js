require('./load-env')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  // Find all operations/controller agents across all tenants
  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { role: { contains: 'Operations', mode: 'insensitive' } },
        { role: { contains: 'Controller', mode: 'insensitive' } },
        { role: { contains: 'Scheduler', mode: 'insensitive' } },
        { name: { contains: 'Alex', mode: 'insensitive' } },
      ],
      status: 'ACTIVE',
    },
  })

  if (!agents.length) {
    console.log('No operations/controller agents found.')
    return
  }

  for (const agent of agents) {
    const currentTools = Array.isArray(agent.tools) ? agent.tools : []
    if (currentTools.includes('get_available_slots')) {
      console.log(`${agent.name} (${agent.id}) already has get_available_slots — skipping`)
      continue
    }

    const updatedTools = [...currentTools, 'get_available_slots']
    await prisma.agent.update({
      where: { id: agent.id },
      data: { tools: updatedTools },
    })
    console.log(`✅ Added get_available_slots to ${agent.name} (${agent.role}) [${agent.id}]`)
    console.log(`   Tools: ${updatedTools.join(', ')}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
