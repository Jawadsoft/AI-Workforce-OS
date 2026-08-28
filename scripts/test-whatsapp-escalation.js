/**
 * Test script: sets a staff member's phone to +44 7775 232926,
 * then sends a test WhatsApp escalation message via the tenant's Twilio config.
 *
 * Usage: node scripts/test-whatsapp-escalation.js
 */

const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const Twilio = require('../apps/api/node_modules/twilio')

const TEST_PHONE = '+447775232926'

const prisma = new PrismaClient()

async function main() {
  // 1. List tenants with Twilio configured
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, settings: true },
    take: 10,
  })

  let targetTenant = null
  let twilioSid, twilioToken, whatsappNumber

  for (const t of tenants) {
    const s = (t.settings || {})
    if (s.twilioAccountSid && s.twilioAccountSid.startsWith('AC') && s.twilioAuthToken && s.twilioWhatsAppNumber) {
      targetTenant = t
      twilioSid = s.twilioAccountSid
      twilioToken = s.twilioAuthToken
      whatsappNumber = s.twilioWhatsAppNumber
      break
    }
  }

  if (!targetTenant) {
    console.log('❌ No tenant found with Twilio configured (Account SID + Auth Token + WhatsApp Number)')
    console.log('   Available tenants:')
    for (const t of tenants) {
      const s = (t.settings || {})
      console.log(`   - ${t.name} (${t.id.slice(-6)}) | twilioAccountSid: ${s.twilioAccountSid ? s.twilioAccountSid.slice(0, 8) + '...' : 'MISSING'} | whatsappNumber: ${s.twilioWhatsAppNumber || 'MISSING'}`)
    }
    return
  }

  console.log(`✅ Using tenant: ${targetTenant.name} (${targetTenant.id.slice(-6)})`)
  console.log(`   WhatsApp sender: ${whatsappNumber}`)

  // 2. Find a staff member and update their phone to the test number
  const users = await prisma.user.findMany({
    where: { tenantId: targetTenant.id, isActive: true },
    select: { id: true, name: true, designation: true, phone: true },
    take: 5,
  })

  console.log('\n📋 Staff members in tenant:')
  for (const u of users) {
    console.log(`   - ${u.name} | ${u.designation || 'N/A'} | phone: ${u.phone || 'none'} | id: ${u.id.slice(-6)}`)
  }

  if (!users.length) {
    console.log('❌ No staff members found in tenant')
    return
  }

  // Pick the first staff member that doesn't have a phone yet (or any if all have phones)
  const target = users.find(u => !u.phone) || users[0]

  console.log(`\n🔧 Setting phone ${TEST_PHONE} on: ${target.name}`)
  await prisma.user.update({
    where: { id: target.id },
    data: { phone: TEST_PHONE },
  })
  console.log(`✅ Phone updated`)

  // 3. Send a test WhatsApp message
  const from = whatsappNumber.startsWith('whatsapp:') ? whatsappNumber : `whatsapp:${whatsappNumber}`
  const to = `whatsapp:${TEST_PHONE}`

  const waBody = [
    `🚨 *URGENT — ESCALATION*`,
    `*From:* Operations AI Agent`,
    ``,
    `TEST: A customer reported a damaged floor at 45 Oak Street. Needs immediate attention from ${target.name}.`,
    ``,
    `_Reply to this message and your response will be forwarded back to the agent._`,
    `_Ref: #test01_`,
  ].join('\n')

  console.log(`\n📱 Sending WhatsApp to ${TEST_PHONE}...`)

  try {
    const client = Twilio.default ? Twilio.default(twilioSid, twilioToken) : Twilio(twilioSid, twilioToken)
    const msg = await client.messages.create({ from, to, body: waBody })
    console.log(`✅ WhatsApp sent! SID: ${msg.sid} | Status: ${msg.status}`)
    console.log(`\n📲 Check your WhatsApp on ${TEST_PHONE}`)
    console.log(`   Reply to that message to test the round-trip routing.`)
  } catch (err) {
    console.error(`❌ WhatsApp send failed: ${err.message}`)
    console.log(`   Make sure the Twilio WhatsApp sandbox is set up or the number is approved.`)
    console.log(`   Twilio WhatsApp Sandbox join: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect() })
