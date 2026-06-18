/**
 * Fixes email rules and clears the blocked test email for rescan.
 */
const fs = require('fs'), path = require('path')
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // 1. Delete the blocked/archived email so it gets rescanned
  const d = await prisma.processedEmail.deleteMany({
    where: { fromEmail: 'syedtradeleads@gmail.com' },
  })
  console.log('Deleted processed records for syedtradeleads@gmail.com:', d.count)

  // 2. Change internal_team from 'block' to 'notify_only' — safer default
  const r1 = await prisma.emailAgentRule.updateMany({
    where: { emailType: 'internal_team' },
    data: { mode: 'notify_only' },
  })
  console.log('Updated internal_team rule to notify_only:', r1.count)

  // 3. Change newsletter from 'block' to 'notify_only' — safer default
  const r2 = await prisma.emailAgentRule.updateMany({
    where: { emailType: 'newsletter' },
    data: { mode: 'notify_only' },
  })
  console.log('Updated newsletter rule to notify_only:', r2.count)

  // 4. Show current rules
  const rules = await prisma.emailAgentRule.findMany({ orderBy: { emailType: 'asc' } })
  console.log('\nCurrent rules:')
  rules.forEach(r => console.log(' ', r.emailType.padEnd(22), r.mode))
}

main().catch(console.error).finally(() => prisma['$disconnect']())
