const fs = require('fs')
const path = require('path')

// Read .env file manually
const envPath = path.join(__dirname, '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const match = envContent.match(/OPENAI_API_KEY="([^"]+)"/)
const apiKey = match ? match[1] : null

if (!apiKey) {
  console.error('❌ OPENAI_API_KEY not found in .env')
  process.exit(1)
}

console.log(`🔑 Key found: ${apiKey.slice(0, 12)}...${apiKey.slice(-6)}`)
console.log(`📏 Key length: ${apiKey.length} characters`)
console.log('🚀 Testing connection to OpenAI...\n')

fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Say "OpenAI connection successful" and nothing else.' }],
    max_tokens: 20,
  }),
})
  .then(async (res) => {
    const data = await res.json()
    if (res.ok) {
      console.log('✅ SUCCESS! OpenAI API is working.')
      console.log(`💬 Response: ${data.choices[0].message.content}`)
      console.log(`📊 Model: ${data.model}`)
      console.log(`🔢 Tokens used: ${data.usage?.total_tokens}`)
    } else {
      console.error('❌ FAILED! OpenAI returned an error:')
      console.error(`   Status: ${res.status}`)
      console.error(`   Error: ${data.error?.message}`)
      console.error(`   Type: ${data.error?.type}`)
      console.log('\n👉 Fix: Go to https://platform.openai.com/api-keys and create a new key')
    }
  })
  .catch((err) => {
    console.error('❌ Network error:', err.message)
  })
