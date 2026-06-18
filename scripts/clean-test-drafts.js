/**
 * Removes test drafts created by test-imap-draft.js from INBOX.Drafts
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
function decrypt(text) { const [ivHex, encHex] = text.split(':'); const iv = Buffer.from(ivHex, 'hex'); const encrypted = Buffer.from(encHex, 'hex'); const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8') }
const prisma = new PrismaClient()

async function main() {
  const account = await prisma.connectedAccount.findFirst({ where: { provider: 'imap', status: 'active' } })
  const meta = account.metadata
  const password = decrypt(account.encryptedAccessToken)
  const client = new ImapFlow({ host: meta.imapHost, port: meta.imapPort, secure: meta.imapSecure, auth: { user: account.accountEmail, pass: password }, logger: false, tls: { rejectUnauthorized: false } })
  client.on('error', () => {})
  await client.connect()
  const mb = await client.mailboxOpen('INBOX.Drafts')
  console.log(`Drafts folder: ${mb.exists} messages`)
  // Delete all messages with subject "Re: Test Draft"
  for await (const msg of client.fetch('1:*', { envelope: true, uid: true })) {
    if (msg.envelope?.subject?.includes('Test Draft')) {
      await client.messageDelete({ uid: String(msg.uid) }, { uid: true })
      console.log(`Deleted test draft UID ${msg.uid}: ${msg.envelope.subject}`)
    }
  }
  await client.logout()
  console.log('Done')
}
main().catch(console.error).finally(() => prisma['$disconnect']())
