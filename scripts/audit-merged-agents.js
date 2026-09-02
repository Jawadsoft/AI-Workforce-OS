require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

const AGENT_IDS = {
  Jackie:  'cmqz393kv000ckpop0ipdlzow',
  Charlie: 'cmqz393ky000kkpop7djvldcc',
  Hanna:   'cmqz393kw000gkpop617q4em4',
  Kevin:   'cmqz393kz000okpop4dcjt8mc',
  Syed:    'cmqz3pbcd000skpopl7tjso6p', // renamed Zara
  Cris:    'cmqz393kw000ikpopiqwoopi4',
}

async function main() {
  for (const [label, id] of Object.entries(AGENT_IDS)) {
    const a = await prisma.agent.findUnique({
      where: { id },
      select: { name: true, role: true, status: true, prompt: true, tools: true, approvalRules: true },
    })
    const src = (a.approvalRules || {}).mergeSource
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`AGENT : ${a.name}`)
    console.log(`ROLE  : ${a.role}`)
    console.log(`STATUS: ${a.status}`)
    console.log(`MERGED: ${src ? src.secondaryName + ' @ ' + src.mergedAt : 'none'}`)
    console.log(`TOOLS : ${(a.tools || []).join(', ')}`)
    console.log('--- PROMPT ---')
    console.log(a.prompt)
    console.log()
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
