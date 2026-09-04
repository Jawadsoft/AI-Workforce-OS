require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const bcrypt = require('../apps/api/node_modules/bcryptjs')
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'info@stormbuddy.co' },
    select: {
      id: true, email: true, name: true, role: true,
      isActive: true,
      password: true, tenantId: true, createdAt: true,
    },
  })

  if (!user) { console.log('❌ User not found'); return }

  console.log('User details:')
  console.log('  Email         :', user.email)
  console.log('  Name          :', user.name)
  console.log('  Role          :', user.role)
  console.log('  isActive      :', user.isActive)
  console.log('  tenantId      :', user.tenantId)
  console.log('  hasPassword   :', !!user.password)

  // Verify the new password matches
  const match = await bcrypt.compare('StormBuddy@2026', user.password)
  console.log('\n  Password "StormBuddy@2026" matches hash:', match ? '✅ YES' : '❌ NO')
}

main().catch(console.error).finally(() => prisma.$disconnect())
