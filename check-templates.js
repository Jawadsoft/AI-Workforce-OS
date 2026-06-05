const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const templates = await prisma.agentTemplate.findMany({
    select: { id: true, name: true, avatar: true },
    orderBy: { id: 'asc' },
  })

  console.log(`\nTotal templates in DB: ${templates.length}\n`)
  templates.forEach(t => {
    console.log(`  ID: ${t.id.padEnd(35)} Name: ${t.name}  Avatar: ${t.avatar ?? 'none'}`)
  })

  // Check which ROOFING templates exist
  const roofingIds = ['receptionist', 'sales-assistant', 'executive-assistant', 'estimator', 'inspector', 'storm-analyst', 'insurance-assistant', 'lead-qualification-assistant']
  const found = templates.map(t => t.id)
  
  console.log('\n--- ROOFING template check ---')
  roofingIds.forEach(id => {
    const exists = found.includes(id)
    console.log(`  ${exists ? '✅' : '❌'} ${id}`)
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
