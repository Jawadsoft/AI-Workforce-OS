/**
 * test-communications.js
 * Tests the full Communications module (SMS / WhatsApp / Voice)
 *
 * Run:  node test-communications.js
 *
 * Requirements:
 *  - API server running on http://localhost:3001
 *  - A valid tenant + user already seeded (from previous tests)
 */

const BASE = 'http://localhost:3001/api/v1'

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
let token = ''
let tenantId = ''

function ok(label) {
  console.log(`  ✅  ${label}`)
  passed++
}

function fail(label, err) {
  console.error(`  ❌  ${label}`)
  console.error(`       ${err?.message || err}`)
  failed++
}

async function req(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`), { status: res.status, data })
  return data
}

// ── Step 0: Login ─────────────────────────────────────────────────────────────

async function login() {
  console.log('\n🔐  Authenticating...')
  try {
    const data = await req('POST', '/auth/login', {
      email: 'syedtradeleads@gmail.com',
      password: 'Test1234!',
    }, false)
    token = data.access_token
    // Decode JWT payload (base64) to extract tenantId
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    tenantId = payload.tenantId
    ok(`Logged in — tenantId: ${tenantId}`)
    return true
  } catch (err) {
    fail('Login failed', err)
    return false
  }
}

// ── Step 1: Get settings ──────────────────────────────────────────────────────

async function testGetSettings() {
  console.log('\n⚙️   GET /communications/settings')
  try {
    const data = await req('GET', '/communications/settings')
    ok(`Settings fetched — keys: ${Object.keys(data).join(', ')}`)

    const expected = [
      'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber',
      'twilioWhatsAppNumber', 'notificationPhone', 'notificationWhatsApp',
      'smsAgentId', 'whatsappAgentId', 'voiceAgentId',
    ]
    const missing = expected.filter((k) => !(k in data))
    if (missing.length) fail(`Missing settings keys: ${missing.join(', ')}`, new Error('schema mismatch'))
    else ok('All expected settings keys present')

    return data
  } catch (err) {
    fail('GET settings failed', err)
    return null
  }
}

// ── Step 2: Save settings ─────────────────────────────────────────────────────

async function testSaveSettings() {
  console.log('\n💾  PUT /communications/settings')
  try {
    const data = await req('PUT', '/communications/settings', {
      twilioPhoneNumber: '+15005550006',        // Twilio magic test number
      twilioWhatsAppNumber: '+15005550006',
      notificationPhone: '+15005550006',
      notificationWhatsApp: '+15005550006',
    })
    if (data.success) ok('Settings saved successfully')
    else fail('Save returned unexpected response', new Error(JSON.stringify(data)))
  } catch (err) {
    fail('PUT settings failed', err)
  }
}

// ── Step 3: Get logs (empty initially) ────────────────────────────────────────

async function testGetLogs() {
  console.log('\n📋  GET /communications/logs')
  try {
    const data = await req('GET', '/communications/logs?limit=10')
    ok(`Logs fetched — total: ${data.total}, returned: ${data.logs?.length ?? 0}`)

    if (!Array.isArray(data.logs)) {
      fail('logs should be an array', new Error('got: ' + typeof data.logs))
    } else {
      ok('logs is an array')
    }

    // Filter by channel
    for (const ch of ['SMS', 'WHATSAPP', 'VOICE']) {
      const filtered = await req('GET', `/communications/logs?channel=${ch}&limit=5`)
      ok(`Channel filter ${ch} → ${filtered.total} messages`)
    }
  } catch (err) {
    fail('GET logs failed', err)
  }
}

// ── Step 4: Simulate inbound SMS (webhook, no auth) ───────────────────────────

async function testInboundSms() {
  console.log(`\n💬  POST /communications/sms/inbound?tenantId=${tenantId}`)
  try {
    const res = await fetch(
      `${BASE}/communications/sms/inbound?tenantId=${tenantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: '+15551112222',
          To: '+15005550006',
          Body: 'Hi, what are your business hours?',
          MessageSid: 'SM_TEST_' + Date.now(),
          NumMedia: '0',
        }),
      },
    )
    const text = await res.text()
    if (res.ok && text.includes('<Response>')) {
      ok(`Inbound SMS processed — TwiML returned`)
      // Extract reply
      const match = text.match(/<Message>([\s\S]*?)<\/Message>/)
      if (match) console.log(`       AI replied: "${match[1].slice(0, 120)}"`)
    } else {
      fail(`Inbound SMS returned HTTP ${res.status}`, new Error(text.slice(0, 200)))
    }
  } catch (err) {
    fail('Inbound SMS webhook failed', err)
  }
}

// ── Step 5: Simulate inbound WhatsApp ─────────────────────────────────────────

async function testInboundWhatsApp() {
  console.log(`\n📱  POST /communications/whatsapp/inbound?tenantId=${tenantId}`)
  try {
    const res = await fetch(
      `${BASE}/communications/whatsapp/inbound?tenantId=${tenantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: 'whatsapp:+15553334444',
          To: 'whatsapp:+15005550006',
          Body: 'Can I get a quote for a roof inspection?',
          MessageSid: 'WA_TEST_' + Date.now(),
          NumMedia: '0',
        }),
      },
    )
    const text = await res.text()
    if (res.ok && text.includes('<Response>')) {
      ok(`Inbound WhatsApp processed — TwiML returned`)
      const match = text.match(/<Message>([\s\S]*?)<\/Message>/)
      if (match) console.log(`       AI replied: "${match[1].slice(0, 120)}"`)
    } else {
      fail(`Inbound WhatsApp returned HTTP ${res.status}`, new Error(text.slice(0, 200)))
    }
  } catch (err) {
    fail('Inbound WhatsApp webhook failed', err)
  }
}

// ── Step 6: Simulate inbound Voice ────────────────────────────────────────────

async function testInboundVoice() {
  console.log(`\n📞  POST /communications/voice/inbound?tenantId=${tenantId}`)
  try {
    const res = await fetch(
      `${BASE}/communications/voice/inbound?tenantId=${tenantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: '+15557778888',
          To: '+15005550006',
          CallSid: 'CA_TEST_' + Date.now(),
          CallStatus: 'ringing',
        }),
      },
    )
    const text = await res.text()
    if (res.ok && text.includes('<Response>') && text.includes('<Say')) {
      ok(`Inbound Voice processed — TwiML with <Say> returned`)
      const match = text.match(/<Say[^>]*>([\s\S]*?)<\/Say>/)
      if (match) console.log(`       AI speaks: "${match[1].slice(0, 120)}"`)
    } else {
      fail(`Inbound Voice returned HTTP ${res.status}`, new Error(text.slice(0, 200)))
    }
  } catch (err) {
    fail('Inbound Voice webhook failed', err)
  }
}

// ── Step 7: Voice gather (speech input mid-call) ──────────────────────────────

async function testVoiceGather() {
  console.log(`\n🎙️   POST /communications/voice/gather?tenantId=${tenantId}`)
  try {
    const res = await fetch(
      `${BASE}/communications/voice/gather?tenantId=${tenantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          From: '+15557778888',
          To: '+15005550006',
          CallSid: 'CA_TEST_GATHER_' + Date.now(),
          SpeechResult: 'I need to schedule a roof inspection',
          Confidence: '0.92',
        }),
      },
    )
    const text = await res.text()
    if (res.ok && text.includes('<Say')) {
      ok(`Voice gather processed — AI responded to speech`)
      const match = text.match(/<Say[^>]*>([\s\S]*?)<\/Say>/)
      if (match) console.log(`       AI says: "${match[1].slice(0, 120)}"`)
    } else {
      fail(`Voice gather returned HTTP ${res.status}`, new Error(text.slice(0, 200)))
    }
  } catch (err) {
    fail('Voice gather webhook failed', err)
  }
}

// ── Step 8: Check logs are now populated ──────────────────────────────────────

async function testLogsAfterMessages() {
  console.log('\n📊  Checking logs were recorded...')
  try {
    const data = await req('GET', '/communications/logs?limit=20')
    ok(`Total logs after test: ${data.total}`)
    if (data.logs?.length > 0) {
      const channels = [...new Set(data.logs.map((l) => l.channel))]
      ok(`Channels present in logs: ${channels.join(', ')}`)
      const inbound = data.logs.filter((l) => l.direction === 'INBOUND').length
      const outbound = data.logs.filter((l) => l.direction === 'OUTBOUND').length
      ok(`Directions — Inbound: ${inbound}, Outbound: ${outbound}`)
    }
  } catch (err) {
    fail('Post-test log check failed', err)
  }
}

// ── Step 9: Manual send endpoint ─────────────────────────────────────────────

async function testSendMessage() {
  console.log('\n📤  POST /communications/send (manual send — Twilio not configured, expect graceful error)')
  try {
    await req('POST', '/communications/send', {
      to: '+15551234567',
      message: 'Test notification from AI Workforce OS',
      channel: 'SMS',
    })
    ok('Manual send succeeded (Twilio configured)')
  } catch (err) {
    if (err.status === 500 || err.message?.includes('credentials')) {
      ok('Graceful error: Twilio credentials not configured (expected in test env)')
    } else if (err.status === 401) {
      fail('Auth guard rejected the request', err)
    } else {
      fail('Unexpected error from manual send', err)
    }
  }
}

// ── Run all ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  Communications Module — Integration Tests')
  console.log('═══════════════════════════════════════════════')

  const loggedIn = await login()
  if (!loggedIn) {
    console.log('\n⚠️  Cannot continue without auth. Is the server running on port 3001?\n')
    process.exit(1)
  }

  await testGetSettings()
  await testSaveSettings()
  await testGetLogs()
  await testInboundSms()
  await testInboundWhatsApp()
  await testInboundVoice()
  await testVoiceGather()
  await testLogsAfterMessages()
  await testSendMessage()

  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════════\n')

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\nUnhandled error:', err)
  process.exit(1)
})
