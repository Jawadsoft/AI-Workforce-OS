/**
 * test-api.js  — Quick API tester
 * Usage: node test-api.js
 */

const BASE = 'http://localhost:3001/api/v1'

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  console.log('==============================================')
  console.log('  AI Workforce OS — API Tester')
  console.log('==============================================\n')

  // ── 1. Login ──────────────────────────────────────────────
  console.log('1. Logging in...')
  const loginRes = await req('POST', '/auth/login', {
    email: 'syedtradeleads@gmail.com',
    password: 'Test1234!',
  })

  if (!loginRes.ok) {
    console.error('   Login failed:', loginRes.data)
    process.exit(1)
  }

  const token = loginRes.data.access_token
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  const tenantId = payload.tenantId

  console.log('   Token:', token.slice(0, 40) + '...')
  console.log('   TenantId:', tenantId)
  console.log('   Role:', payload.role)
  console.log()

  // ── 2. GET /auth/me ───────────────────────────────────────
  console.log('2. GET /auth/me')
  const me = await req('GET', '/auth/me', null, token)
  console.log('   ', JSON.stringify(me.data, null, 2).split('\n').slice(0, 8).join('\n   '))
  console.log()

  // ── 3. GET /agents ────────────────────────────────────────
  console.log('3. GET /agents')
  const agents = await req('GET', '/agents', null, token)
  const agentList = agents.data || []
  console.log(`   Found ${agentList.length} agents:`)
  agentList.slice(0, 5).forEach(a => console.log(`   - [${a.status}] ${a.name} (${a.role})`))
  console.log()

  // ── 4. GET /communications/settings ──────────────────────
  console.log('4. GET /communications/settings')
  const commsSettings = await req('GET', '/communications/settings', null, token)
  console.log('   ', JSON.stringify(commsSettings.data, null, 2))
  console.log()

  // ── 5. GET /tenants/email-settings ───────────────────────
  console.log('5. GET /tenants/email-settings')
  const emailSettings = await req('GET', '/tenants/email-settings', null, token)
  console.log('   smtpHost:', emailSettings.data.smtpHost || '(not set)')
  console.log('   smtpUser:', emailSettings.data.smtpUser || '(not set)')
  console.log('   smtpPass:', emailSettings.data.smtpPass ? 'configured' : '(not set)')
  console.log()

  // ── 6. POST /tenants/test-email ───────────────────────────
  console.log('6. POST /tenants/test-email (verifying SMTP connection)')
  const testEmail = await req('POST', '/tenants/test-email', { to: 'syedtradeleads@gmail.com' }, token)
  console.log('   Result:', JSON.stringify(testEmail.data))
  console.log()

  // ── 7. GET /analytics/summary ────────────────────────────
  console.log('7. GET /analytics/summary')
  const analytics = await req('GET', '/analytics/summary', null, token)
  console.log('   ', JSON.stringify(analytics.data))
  console.log()

  // ── 8. GET /approvals ─────────────────────────────────────
  console.log('8. GET /approvals?status=PENDING')
  const approvals = await req('GET', '/approvals?status=PENDING', null, token)
  console.log('   Pending approvals:', Array.isArray(approvals.data) ? approvals.data.length : approvals.data)
  console.log()

  // ── 9. GET /communications/logs ──────────────────────────
  console.log('9. GET /communications/logs')
  const logs = await req('GET', '/communications/logs?limit=5', null, token)
  console.log('   Total logs:', logs.data.total)
  console.log()

  // ── 10. Test forgot-password (no auth needed) ─────────────
  console.log('10. POST /auth/forgot-password (no auth)')
  const forgot = await req('POST', '/auth/forgot-password', { email: 'syedtradeleads@gmail.com' })
  console.log('   ', forgot.data.message)
  console.log()

  console.log('==============================================')
  console.log('  All tests complete!')
  console.log()
  console.log('  Your Bearer token (copy for Postman/curl):')
  console.log()
  console.log('  Authorization: Bearer', token)
  console.log('==============================================\n')
}

main().catch(console.error)
