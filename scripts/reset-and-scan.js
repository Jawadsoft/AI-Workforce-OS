/**
 * Clears all processed emails for a tenant and triggers a fresh IMAP scan.
 * Run:  node scripts/reset-and-scan.js
 */
const path = require('path')
const fs = require('fs')

// Load .env manually (strip surrounding quotes)
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}

const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const prisma = new PrismaClient()

const TENANT_ID = 'cmpv8kqw40000r5du9348rff3'

async function main() {
  // 1. Delete all processed emails for this tenant
  const deleted = await prisma.processedEmail.deleteMany({ where: { tenantId: TENANT_ID } })
  console.log(`✅ Cleared ${deleted.count} processed email records`)

  // 2. Show current rules
  const rules = await prisma.emailAgentRule.findMany({ where: { tenantId: TENANT_ID }, orderBy: { emailType: 'asc' } })
  console.log('\nCurrent email rules:')
  rules.forEach(r => console.log(' ', r.emailType.padEnd(22), r.mode.padEnd(20), 'threshold:', r.confidenceThreshold))

  // 3. Trigger scan via API
  console.log('\nTriggering scan via API...')
  const jwt = await getJwt()
  if (!jwt) {
    console.log('⚠️  Could not get JWT — start the API server then run scan manually from Settings → Integrations → Scan Now')
    return
  }

  const res = await fetch('http://localhost:3001/api/v1/integrations/email-scan', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  })
  const body = await res.text()
  console.log(`Scan response: ${res.status} ${body}`)
}

async function getJwt() {
  try {
    const user = await prisma.user.findFirst({ where: { tenantId: TENANT_ID, role: { in: ['TENANT_OWNER', 'TENANT_ADMIN'] } } })
    if (!user) return null
    // We can't sign a JWT here without the secret, so just inform the user
    console.log(`Tenant owner: ${user.email} — log in at http://localhost:3000 and click "Scan Now" in Settings → Integrations`)
    return null
  } catch {
    return null
  }
}

main()
  .catch(console.error)
  .finally(() => prisma['$disconnect']())
