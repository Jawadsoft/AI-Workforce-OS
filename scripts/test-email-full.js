/**
 * Full email diagnostic — tests both IMAP (read) and SMTP (send)
 * Run: node scripts/test-email-full.js
 */

require('./load-env')

const path = require('path')
let ImapFlow
try {
  ImapFlow = require(path.join(__dirname, '../apps/api/node_modules/imapflow')).ImapFlow
} catch {
  ImapFlow = require('imapflow').ImapFlow
}

let nodemailer
try {
  nodemailer = require(path.join(__dirname, '../apps/api/node_modules/nodemailer'))
} catch {
  nodemailer = require('nodemailer')
}

const EMAIL = process.env.IMAP_TEST_EMAIL || process.env.SEED_IMAP_EMAIL
const PASS = process.env.IMAP_TEST_PASSWORD || process.env.SEED_IMAP_PASSWORD

if (!EMAIL || !PASS) {
  console.error('Set IMAP_TEST_EMAIL and IMAP_TEST_PASSWORD (or SEED_IMAP_*) in .env')
  process.exit(1)
}

async function testImap() {
  console.log('\n📥 Testing IMAP (incoming) — imap.one.com:993')
  const client = new ImapFlow({
    host: 'imap.one.com', port: 993, secure: true,
    auth: { user: EMAIL, pass: PASS },
    logger: false, tls: { rejectUnauthorized: false },
    connectionTimeout: 10000, greetingTimeout: 8000,
  })
  client.on('error', () => {})
  try {
    await client.connect()
    const status = await client.status('INBOX', { messages: true, unseen: true })
    console.log(`   ✅ IMAP OK — ${status.messages} total, ${status.unseen} unread`)
    await client.logout()
    return true
  } catch (err) {
    console.log(`   ❌ IMAP Failed: ${err.message}`)
    try { client.close() } catch {}
    return false
  }
}

async function testSmtp() {
  console.log('\n📤 Testing SMTP (outgoing) — send.one.com:587')
  const transporter = nodemailer.createTransport({
    host: 'send.one.com', port: 587, secure: false,
    auth: { user: EMAIL, pass: PASS },
    tls: { rejectUnauthorized: false },
  })
  try {
    await transporter.verify()
    console.log(`   ✅ SMTP OK — ready to send from ${EMAIL}`)
    return true
  } catch (err) {
    console.log(`   ❌ SMTP Failed: ${err.message}`)

    // Try port 465 SSL
    console.log('\n📤 Trying SMTP SSL — send.one.com:465')
    const t2 = nodemailer.createTransport({
      host: 'send.one.com', port: 465, secure: true,
      auth: { user: EMAIL, pass: PASS },
      tls: { rejectUnauthorized: false },
    })
    try {
      await t2.verify()
      console.log(`   ✅ SMTP SSL OK — use port 465 with SSL enabled`)
      return true
    } catch (err2) {
      console.log(`   ❌ SMTP SSL also failed: ${err2.message}`)
      return false
    }
  }
}

async function main() {
  console.log('='.repeat(55))
  console.log(`Email Integration Test — ${EMAIL}`)
  console.log('='.repeat(55))

  const imapOk = await testImap()
  const smtpOk = await testSmtp()

  console.log('\n' + '='.repeat(55))
  console.log(`Summary: IMAP=${imapOk ? '✅' : '❌'}  SMTP=${smtpOk ? '✅' : '❌'}`)
  if (imapOk && smtpOk) {
    console.log('🎉 Full email integration ready!')
  } else if (imapOk && !smtpOk) {
    console.log('⚠️  Reading works but sending needs fixing.')
    console.log('   Tip: Check One.com control panel → Email → SMTP settings')
  }
  console.log('='.repeat(55))
}

main().catch(console.error)
