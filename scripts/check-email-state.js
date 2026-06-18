// Script to check current email integration state
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('=== EMAIL RULES ===')
  const rules = await prisma.emailAgentRule.findMany({ orderBy: { emailType: 'asc' } })
  rules.forEach(r =>
    console.log(
      r.emailType.padEnd(22),
      r.mode.padEnd(22),
      'threshold:', String(r.confidenceThreshold).padEnd(5),
      'active:', r.isActive,
    )
  )

  console.log('\n=== LAST 10 PROCESSED EMAILS ===')
  const emails = await prisma.processedEmail.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  if (!emails.length) console.log('(none)')
  emails.forEach(e =>
    console.log(
      e.fromEmail.padEnd(35),
      (e.classification || 'unknown').padEnd(20),
      (e.action || 'null').padEnd(12),
      e.status.padEnd(10),
      e.createdAt.toISOString(),
      e.errorMessage ? '| ERR: ' + e.errorMessage : '',
    )
  )

  console.log('\n=== CONNECTED ACCOUNTS ===')
  const accounts = await prisma.connectedAccount.findMany()
  accounts.forEach(a => {
    const m = a.metadata || {}
    console.log(
      a.accountEmail,
      a.provider,
      a.status,
      '| SMTP:', m.smtpHost || 'N/A', m.smtpPort || '',
      '| hasSmtpPw:', !!(m.encryptedSmtpPassword),
    )
  })
}

main()
  .catch(console.error)
  .finally(() => prisma['$disconnect']())
