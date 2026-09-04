const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const email = 'nm.infozone@gmail.com'

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenant: { select: { id: true, name: true, isActive: true } },
    },
  })

  if (!user) {
    console.log('User not found — already clean.')
    return
  }

  console.log('Found user:', JSON.stringify({ id: user.id, email: user.email, role: user.role, tenant: user.tenant }, null, 2))

  await prisma.user.delete({ where: { email } })
  console.log(`✅ Deleted user ${email} from database.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
