const { PrismaClient } = require('@prisma/client')
const bcrypt = require('./node_modules/.pnpm/bcryptjs@2.4.3/node_modules/bcryptjs')

const p = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('Test1234!', 10)
  const user = await p.user.update({
    where: { email: 'syedtradeleads@gmail.com' },
    data: { password: hash },
    select: { email: true, role: true },
  })
  console.log('Password reset to Test1234! for:', user.email, '(' + user.role + ')')
}

main().finally(() => p.$disconnect())
