const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  try {
    const t = await prisma.tenant.delete({ where: { id: 'cmtn0j89x004qfk3w44yc8byn' } })
    console.log('Deleted orphaned tenant:', t.name)
  } catch (e) {
    console.log('Tenant already gone or error:', e.message)
  }
}

main().finally(() => prisma.$disconnect())
