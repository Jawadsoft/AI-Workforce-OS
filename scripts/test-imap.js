/**
 * Test IMAP connection (reads credentials from .env)
 * Run: node scripts/test-imap.js
 */

require('./load-env')

const path = require('path')
let ImapFlow
try {
  ImapFlow = require(path.join(__dirname, '../apps/api/node_modules/imapflow')).ImapFlow
} catch {
  ImapFlow = require('imapflow').ImapFlow
}

const configs = [
  { label: 'One.com IMAP SSL  (993)', host: 'imap.one.com',    port: 993, secure: true  },
  { label: 'One.com IMAP STARTTLS (143)', host: 'imap.one.com', port: 143, secure: false },
  { label: 'webmail.one.com SSL (993)', host: 'webmail.one.com', port: 993, secure: true  },
]

const USER = process.env.IMAP_TEST_EMAIL || process.env.SEED_IMAP_EMAIL
const PASS = process.env.IMAP_TEST_PASSWORD || process.env.SEED_IMAP_PASSWORD

if (!USER || !PASS) {
  console.error('Set IMAP_TEST_EMAIL and IMAP_TEST_PASSWORD (or SEED_IMAP_*) in .env')
  process.exit(1)
}

async function testOne(cfg) {
  console.log(`\n🔌 Testing: ${cfg.label}`)
  console.log(`   Host: ${cfg.host}:${cfg.port}  SSL:${cfg.secure}`)

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: USER, pass: PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  })

  client.on('error', () => {}) // prevent unhandled crash

  try {
    await client.connect()
    console.log('   ✅ Connected!')

    await client.mailboxOpen('INBOX')
    const status = await client.status('INBOX', { messages: true, unseen: true })
    console.log(`   📬 Total messages: ${status.messages}`)
    console.log(`   📩 Unread messages: ${status.unseen}`)

    await client.logout()
    return true
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}`)
    try { client.close() } catch {}
    return false
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log(`IMAP Connection Test — ${USER}`)
  console.log('='.repeat(60))

  let anySuccess = false
  for (const cfg of configs) {
    const ok = await testOne(cfg)
    if (ok) { anySuccess = true; break }
  }

  if (!anySuccess) {
    console.log('\n⚠️  All connections failed. Possible reasons:')
    console.log('   1. IMAP not enabled in One.com webmail settings')
    console.log('      → Login to webmail.one.com → Settings → Email → IMAP/POP3 → Enable IMAP')
    console.log('   2. Wrong password — try logging into webmail.one.com to verify')
    console.log('   3. Two-factor auth blocking access')
    console.log('   4. Firewall blocking outbound ports 993/143')
  }

  console.log('\n' + '='.repeat(60))
}

main().catch(console.error)
