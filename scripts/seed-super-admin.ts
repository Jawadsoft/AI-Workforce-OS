/**
 * Creates the first super admin user.
 * Usage: npx ts-node scripts/seed-super-admin.ts
 *
 * Edit the credentials below before running.
 */

import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const SUPER_ADMIN_EMAIL = 'superadmin@platform.com'
const SUPER_ADMIN_PASSWORD = 'SuperAdmin@2024!'
const SUPER_ADMIN_NAME = 'Platform Admin'

async function main() {
  // Ensure platform tenant exists
  let platformTenant = await prisma.tenant.findFirst({ where: { slug: 'platform-admin' } })
  if (!platformTenant) {
    platformTenant = await prisma.tenant.create({
      data: { name: 'Platform Admin', slug: 'platform-admin' },
    })
    console.log('Created platform tenant:', platformTenant.id)
  }

  // Check if super admin already exists
  const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } })
  if (existing) {
    console.log('Super admin already exists:', existing.email)
    process.exit(0)
  }

  const hashed = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12)
  const user = await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      name: SUPER_ADMIN_NAME,
      password: hashed,
      role: 'SUPER_ADMIN',
      tenantId: platformTenant.id,
    },
  })

  console.log('Super admin created!')
  console.log('  Email:', user.email)
  console.log('  Password:', SUPER_ADMIN_PASSWORD)
  console.log('  Role:', user.role)
  console.log('')
  console.log('Login at: http://localhost:3000/super-admin/login')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
