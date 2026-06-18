/**
 * Marks emails from a specific sender as unread so the scanner picks them up again.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const { ImapFlow } = require('../node_modules/.pnpm/imapflow@1.4.0/node_modules/imapflow')
const ALGORITHM = 'aes-256-cbc', KEY_LENGTH = 32
function getKey() { const raw = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-chars!!'; return Buffer.from(raw.slice(0, KEY_LENGTH).padEnd(KEY_LENGTH, '0')) }
function decrypt(text) { const [ivHex, encHex] = text.split(':'); const iv = Buffer.from(ivHex, 'hex'); const enc = Buffer.from(encHex, 'hex'); const d = crypto.createDecipheriv(ALGORITHM, getKey(), iv); return Buffer.concat([d.update(enc), d.final()]).toString('utf8') }

const TARGET_SENDER = 'jawadsyed501@gmail.com'
const prisma = new PrismaClient()

async function main() {
  const account = await prisma.connectedAccount.findFirst({ where: { provider: 'imap', status: 'active' } })
  const meta = account.metadata
  const password = decrypt(account.encryptedAccessToken)
  const client = new ImapFlow({
    host: meta.imapHost, port: meta.imapPort, secure: meta.imapSecure,
    auth: { user: account.accountEmail, pass: password },
    logger: false, tls: { rejectUnauthorized: false },
  })
  client.on('error', () => {})
  await client.connect()
  await client.mailboxOpen('INBOX')

  // Find emails from target sender (search all, not just unseen)
  const uids = await client.search({ from: TARGET_SENDER }, { uid: true })
  if (!uids.length) {
    console.log(`No emails found from ${TARGET_SENDER}`)
  } else {
    console.log(`Found ${uids.length} email(s) from ${TARGET_SENDER}, marking as unread...`)
    await client.messageFlagsRemove({ uid: uids.join(',') }, ['\\Seen'], { uid: true })
    console.log('Marked as unread')
  }
  await client.logout()
}

main().catch(console.error).finally(() => prisma['$disconnect']())
