const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const OLD_NAMES = [
  // Old main seed names
  'Stan — Sales Assistant',
  'Rachel — AI Receptionist',
  'Ava — Executive Assistant',
  'Linda — Insurance Assistant',
  'Storm Analyst',
  'Estimator',
  'Inspector',
  'Lead Qualification Assistant',
  // Old marketplace names
  'Receptionist',
  'Sales Assistant',
  'Insurance Assistant',
  'Executive Assistant',
  'Project Coordinator',
  'HR Coordinator',
  'Property Manager Assistant',
]

async function main() {
  console.log('Deleting old agent templates...')
  const result = await prisma.agentTemplate.deleteMany({
    where: { name: { in: OLD_NAMES } },
  })
  console.log(`✓ Deleted ${result.count} old template(s).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
