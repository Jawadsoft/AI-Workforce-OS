const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const p = new PrismaClient()

async function main() {
  // Set phone for Waleed Nizam and Syed Jawad Ikram (test number for now)
  const waleed = await p.user.updateMany({
    where: { name: { contains: 'Waleed' }, isActive: true },
    data: { phone: '+447775232926' },
  })
  console.log(`Updated Waleed: ${waleed.count} record(s)`)

  // Also set Syed Jawad Ikram as backup
  const jawad = await p.user.updateMany({
    where: { name: { contains: 'Jawad Ikram' }, isActive: true },
    data: { phone: '+447775232926' },
  })
  console.log(`Updated Syed Jawad Ikram: ${jawad.count} record(s)`)

  // Verify
  const check = await p.user.findMany({
    where: { tenantId: 'cmtcx29jy0001wcfvxm8qztufz' },
    select: { name: true, phone: true, designation: true },
  })
  console.log('\nAll staff phones now:')
  for (const u of check) {
    console.log(`  ${u.name} | ${u.designation || '-'} | ${u.phone || 'NO PHONE'}`)
  }
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
