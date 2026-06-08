const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@platform.com'
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@2024!'
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Platform Admin'

async function main() {
  let platformTenant = await prisma.tenant.findFirst({
    where: { slug: 'platform-admin' },
  })

  if (!platformTenant) {
    platformTenant = await prisma.tenant.create({
      data: {
        name: 'Platform Admin',
        slug: 'platform-admin',
      },
    })

    console.log('Created platform tenant:', platformTenant.id)
  }

  const existing = await prisma.user.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  })

  if (existing) {
    console.log('Super admin already exists:', existing.email)
    return
  }

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12)

  const user = await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      name: SUPER_ADMIN_NAME,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      tenantId: platformTenant.id,
    },
  })

  console.log('Super admin created!')
  console.log('Email:', user.email)
  console.log('Password:', SUPER_ADMIN_PASSWORD)
  console.log('Role:', user.role)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
