require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const agent = await prisma.agent.findUnique({
    where: { id: 'cmqz393kz000okpop4dcjt8mc' },
    select: { name: true, role: true, tools: true, prompt: true },
  })
  console.log('NAME:', agent.name)
  console.log('ROLE:', agent.role)
  console.log('TOOLS:', JSON.stringify(agent.tools, null, 2))
  console.log('\n--- PROMPT ---')
  console.log(agent.prompt)
}

main().catch(console.error).finally(() => prisma.$disconnect())
