/**
 * Diagnostic script: tests IMAP connection, reads email from addresses,
 * and tests saving a draft to the Drafts folder.
 * Run: node scripts/test-imap-draft.js
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Load .env
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}

// Decrypt the stored IMAP password from DB
const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32
function getKey() {
  const raw = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-chars!!'
  return Buffer.from(raw.slice(0, KEY_LENGTH).padEnd(KEY_LENGTH, '0'))
}
function decrypt(text) {
  const [ivHex, encHex] = text.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const { ImapFlow } = require('../node_modules/.pnpm/imapflow@1.4.0/node_modules/imapflow')

const prisma = new PrismaClient()

async function main() {
  // Get connected account from DB
  const account = await prisma.connectedAccount.findFirst({
    where: { provider: 'imap', status: 'active' },
  })
  if (!account) { console.error('No IMAP account found'); return }

  const meta = account.metadata
  const password = decrypt(account.encryptedAccessToken)

  console.log(`Account: ${account.accountEmail}`)
  console.log(`IMAP: ${meta.imapHost}:${meta.imapPort} secure=${meta.imapSecure}`)
  console.log(`SMTP: ${meta.smtpHost}:${meta.smtpPort}`)

  const client = new ImapFlow({
    host: meta.imapHost,
    port: meta.imapPort,
    secure: meta.imapSecure,
    auth: { user: account.accountEmail, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
  })
  client.on('error', err => console.error('IMAP error:', err.message))

  await client.connect()
  console.log('\n✅ Connected to IMAP server')

  // List mailboxes
  const mailboxes = await client.list()
  console.log('\nMailboxes:')
  mailboxes.forEach(m => {
    const flags = [...m.flags].join(', ')
    console.log(`  ${m.path.padEnd(30)} flags: ${flags}`)
  })

  // Open INBOX and read first 3 unread messages
  await client.mailboxOpen('INBOX')
  console.log('\nFirst 3 unread emails:')
  const messages = client.fetch({ seen: false }, { uid: true, envelope: true }, { uid: false })
  let count = 0
  for await (const msg of messages) {
    if (count++ >= 3) break
    const env = msg.envelope
    const from = env?.from?.[0]
    console.log(`\n  UID: ${msg.uid}`)
    console.log(`  Subject: ${env?.subject}`)
    console.log(`  from object: ${JSON.stringify(from)}`)
    console.log(`  from.address: ${from?.address}`)
    console.log(`  from.name: ${from?.name}`)
    console.log(`  from.mailbox: ${from?.mailbox}`)
    console.log(`  from.host: ${from?.host}`)
  }

  // Find Drafts folder
  const draftsFolder = mailboxes.find(m =>
    m.flags.has('\\Drafts') ||
    /^(Drafts|Draft|INBOX\.Drafts|INBOX\.Draft)$/i.test(m.path)
  )
  const folder = draftsFolder?.path ?? 'Drafts'
  console.log(`\nDrafts folder: "${folder}"`)

  // Test saving a draft
  console.log('\nTesting saveDraft...')
  const boundary = `boundary_${Date.now()}`
  const testTo = 'test@example.com'
  const rawMessage = [
    `From: ${account.accountEmail}`,
    `To: ${testTo}`,
    `Subject: Re: Test Draft`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `X-Draft: true`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    `This is a test draft reply.`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    `<p>This is a <strong>test draft reply</strong>.</p>`,
    ``,
    `--${boundary}--`,
  ].join('\r\n')

  try {
    const result = await client.append(folder, Buffer.from(rawMessage), ['\\Draft', '\\Seen'])
    console.log(`✅ Draft saved! Result: ${JSON.stringify(result)}`)
  } catch (err) {
    console.error(`❌ saveDraft failed: ${err.message}`)
    // Try with string instead of Buffer
    try {
      console.log('Retrying with string...')
      const result2 = await client.append(folder, rawMessage, ['\\Draft', '\\Seen'])
      console.log(`✅ Draft saved with string! Result: ${JSON.stringify(result2)}`)
    } catch (err2) {
      console.error(`❌ Still failed: ${err2.message}`)
    }
  }

  await client.logout()
  console.log('\n✅ Done')
}

main()
  .catch(console.error)
  .finally(() => prisma['$disconnect']())
