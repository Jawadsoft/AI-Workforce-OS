require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const bcrypt = require('../apps/api/node_modules/bcryptjs')

const prisma = new PrismaClient()

const EMAIL = 'info@stormbuddy.co'
const NEW_PASSWORD = 'StormBuddy@2026'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (!user) {
    console.error(`❌ User not found: ${EMAIL}`)
    process.exit(1)
  }
  console.log(`Found: ${user.name} (${user.role})`)
  const hashed = await bcrypt.hash(NEW_PASSWORD, 12)
  await prisma.user.update({ where: { email: EMAIL }, data: { password: hashed } })
  console.log(`✅ Password reset for ${EMAIL}`)
  console.log(`   New password: ${NEW_PASSWORD}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
