const { PrismaClient } = require('@prisma/client')
const bcrypt = require('C:/Users/kk/Documents/AI Agents-OS/apps/api/node_modules/bcryptjs')
const prisma = new PrismaClient()

async function main() {
  let pt = await prisma.tenant.findFirst({ where: { slug: 'platform-admin' } })
  if (!pt) {
    pt = await prisma.tenant.create({ data: { name: 'Platform Admin', slug: 'platform-admin' } })
    console.log('Created platform tenant:', pt.id)
  }

  const ex = await prisma.user.findUnique({ where: { email: 'superadmin@platform.com' } })
  const hashed = await bcrypt.hash('SuperAdmin@2024!', 12)

  if (ex) {
    await prisma.user.update({
      where: { email: 'superadmin@platform.com' },
      data: { password: hashed, role: 'SUPER_ADMIN', isActive: true, tenantId: pt.id },
    })
    console.log('Updated super admin password/role:', ex.email)
  } else {
    const u = await prisma.user.create({
      data: {
        email: 'superadmin@platform.com',
        name: 'Platform Admin',
        password: hashed,
        role: 'SUPER_ADMIN',
        tenantId: pt.id,
        isActive: true,
      },
    })
    console.log('Created super admin:', u.email, u.role)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
