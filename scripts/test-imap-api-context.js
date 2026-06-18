/**
 * Tests IMAP exactly as the API server does (same ImapFlow version, same options)
 * Run: node scripts/test-imap-api-context.js
 */
require('./load-env')

const path = require('path')

const EMAIL = process.env.IMAP_TEST_EMAIL || process.env.SEED_IMAP_EMAIL
const PASS = process.env.IMAP_TEST_PASSWORD || process.env.SEED_IMAP_PASSWORD

if (!EMAIL || !PASS) {
  console.error('Set IMAP_TEST_EMAIL and IMAP_TEST_PASSWORD (or SEED_IMAP_*) in .env')
  process.exit(1)
}

// Use the exact same imapflow the API uses
const imapflowPath = path.join(__dirname, '../apps/api/node_modules/imapflow')
let ImapFlow
try {
  ImapFlow = require(imapflowPath).ImapFlow
  console.log(`Using imapflow from: ${imapflowPath}`)
} catch {
  ImapFlow = require('imapflow').ImapFlow
  console.log('Using imapflow from node_modules')
}

async function test(host, port, secure) {
  console.log(`\n🔌 ${host}:${port} SSL=${secure}`)
  const client = new ImapFlow({
    host, port, secure,
    auth: { user: EMAIL, pass: PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  })

  let lastErr = ''
  client.on('error', e => { lastErr = e?.message || String(e) })

  try {
    await client.connect()
    const s = await client.status('INBOX', { messages: true, unseen: true })
    console.log(`   ✅ OK — ${s.messages} total, ${s.unseen} unread`)
    await client.logout()
    return true
  } catch (err) {
    const inner = err?.errors?.map(e => e?.message || String(e)).join('; ') || err?.message || lastErr || String(err)
    console.log(`   ❌ ${inner}`)
    try { client.close() } catch {}
    return false
  }
}

async function main() {
  console.log('Testing IMAP using the same code path as the API server...\n')
  const ok1 = await test('imap.one.com', 993, true)
  if (!ok1) {
    await test('imap.one.com', 143, false)
    await test('mail.one.com', 993, true)
  }
}

main().catch(console.error)
