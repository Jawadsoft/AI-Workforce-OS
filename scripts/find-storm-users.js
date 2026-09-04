require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'storm', mode: 'insensitive' } },
        { email: { contains: 'jawadsyed', mode: 'insensitive' } },
      ],
    },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${users.length} user(s):\n`)
  users.forEach(u => {
    console.log(`  ${u.isActive ? '✅' : '❌'} ${u.email}`)
    console.log(`     Name: ${u.name}  |  Role: ${u.role}  |  ID: ${u.id}`)
    console.log()
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
