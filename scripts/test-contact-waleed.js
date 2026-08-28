/**
 * Simulates the contact_human tool calling Waleed Nizam directly via WhatsApp.
 * Run: node scripts/test-contact-waleed.js
 */

const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const Twilio = require('../apps/api/node_modules/twilio')

const p = new PrismaClient()

async function main() {
  // 1. Find Waleed
  const waleed = await p.user.findFirst({
    where: { name: { contains: 'Waleed' }, isActive: true },
    select: { id: true, name: true, phone: true, designation: true, tenantId: true },
  })

  if (!waleed) {
    console.log('❌ Waleed not found in DB')
    return
  }

  console.log(`✅ Found: ${waleed.name} | phone: ${waleed.phone || 'NONE'} | id: ${waleed.id}`)

  if (!waleed.phone) {
    console.log('❌ Waleed has no phone number set')
    return
  }

  // 2. Get Twilio creds from tenant
  const tenant = await p.tenant.findUnique({
    where: { id: waleed.tenantId },
    select: { name: true, settings: true },
  })

  const s = tenant?.settings || {}
  const sid = s.twilioAccountSid
  const token = s.twilioAuthToken
  const waNumber = s.twilioWhatsAppNumber

  console.log(`✅ Tenant: ${tenant?.name}`)
  console.log(`   Twilio SID: ${sid ? sid.slice(0, 10) + '...' : 'MISSING'}`)
  console.log(`   WhatsApp sender: ${waNumber || 'MISSING'}`)

  if (!sid || !token || !waNumber) {
    console.log('❌ Twilio not fully configured for this tenant')
    return
  }

  // 3. Send WhatsApp
  const from = waNumber.startsWith('whatsapp:') ? waNumber : `whatsapp:${waNumber}`
  const to = waleed.phone.startsWith('whatsapp:') ? waleed.phone : `whatsapp:${waleed.phone}`

  const body = [
    `🚨 *URGENT — ESCALATION*`,
    `*From:* Jake — Handyman Services Coordinator`,
    ``,
    `A customer has reported damaged flooring at 45 Oak Street. Immediate attention required.`,
    `Customer is requesting a site visit and damage assessment today.`,
    ``,
    `_Reply to this message and your response will be forwarded back to the agent._`,
    `_Ref: #test02_`,
  ].join('\n')

  console.log(`\n📱 Sending WhatsApp to ${waleed.phone}...`)
  console.log(`   From: ${from}`)
  console.log(`   To:   ${to}`)

  try {
    const client = typeof Twilio === 'function' ? Twilio(sid, token) : Twilio.default(sid, token)
    const msg = await client.messages.create({ from, to, body })
    console.log(`\n✅ SUCCESS!`)
    console.log(`   SID:    ${msg.sid}`)
    console.log(`   Status: ${msg.status}`)
    console.log(`\n📲 WhatsApp sent to ${waleed.phone}`)
    console.log(`   Reply to that message to test the round-trip back to the agent.`)
  } catch (err) {
    console.log(`\n❌ Twilio error: ${err.message}`)
    if (err.message.includes('not a valid phone number')) {
      console.log(`   Fix: phone must be E.164 format, e.g. +447775232926 (no spaces)`)
    }
    if (err.message.includes('not verified') || err.message.includes('sandbox')) {
      console.log(`   Fix: ${waleed.phone} needs to join the Twilio WhatsApp Sandbox first.`)
      console.log(`   Go to: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn`)
    }
  }
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
