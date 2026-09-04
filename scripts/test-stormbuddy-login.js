/**
 * Test login API directly to pinpoint "Invalid credentials" cause
 */
require('./load-env')
const http = require('http')

const payload = JSON.stringify({ email: 'info@stormbuddy.co', password: 'StormBuddy@2026' })

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/v1/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
}

console.log(`Testing login for info@stormbuddy.co against http://localhost:3001/api/v1/auth/login ...`)

const req = http.request(options, (res) => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', () => {
    console.log(`HTTP Status: ${res.statusCode}`)
    try {
      const parsed = JSON.parse(data)
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log('✅ LOGIN SUCCESS')
        console.log('   User:', parsed.user?.name, '|', parsed.user?.email, '|', parsed.user?.role)
        console.log('   Token:', parsed.access_token ? parsed.access_token.slice(0, 40) + '...' : 'none')
      } else {
        console.log('❌ LOGIN FAILED')
        console.log('   Response:', JSON.stringify(parsed, null, 2))
      }
    } catch {
      console.log('Raw response:', data)
    }
  })
})

req.on('error', e => console.error('Request error:', e.message))
req.write(payload)
req.end()
