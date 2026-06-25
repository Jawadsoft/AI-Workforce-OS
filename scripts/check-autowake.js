/**
 * Shows which tickets are eligible for auto-wake RIGHT NOW
 * and which will be eligible soon.
 */
require('./load-env')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  const now = new Date()
  const thirtyMinAgo = new Date(Date.now() - 5 * 60 * 1000)
  const fortyEightHAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

  const tickets = await db.activityTicket.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_AGENT', 'ESCALATED'] },
      assignedAgentId: { not: null },
      tenant: { isActive: true },
      createdAt: { gte: fortyEightHAgo },
    },
    include: { assignedAgent: { select: { name: true, role: true } } },
    orderBy: { updatedAt: 'asc' },
  })

  const PASS = '\x1b[32m✔\x1b[0m'
  const WAIT = '\x1b[33m⏳\x1b[0m'
  const FAIL = '\x1b[31m✘\x1b[0m'

  console.log(`\n=== Auto-wake Eligibility Check (${now.toLocaleTimeString()}) ===\n`)
  console.log(`Next cron run: every 2 min (idle threshold: 5 min)\n`)

  if (!tickets.length) {
    console.log('  No active tickets found within 48 hours.\n')
    console.log('  To test auto-wake: create a ticket via chat, assign it to an agent, then wait 30 min.\n')
    await db.$disconnect(); return
  }

  for (const t of tickets) {
    const idleMs = now - t.updatedAt
    const idleMin = Math.floor(idleMs / 60000)
    const isEligible = t.updatedAt < thirtyMinAgo
    const minUntilEligible = isEligible ? 0 : Math.ceil((now - t.updatedAt) / 60000 < 5 ? 5 - (now - t.updatedAt) / 60000 : 0)

    const icon = isEligible ? PASS : WAIT
    console.log(`  ${icon} Ticket #${String(t.ticketNumber || '?').padStart(4,'0')} — "${t.title?.slice(0, 50) || 'Untitled'}"`)
    console.log(`      Agent: ${t.assignedAgent?.name} (${t.assignedAgent?.role})`)
    console.log(`      Status: ${t.status} | Idle: ${idleMin} min`)
    if (isEligible) {
      console.log(`      ${PASS} ELIGIBLE — will be woken on next cron run`)
    } else {
      console.log(`      ${WAIT} Needs ${minUntilEligible} more min idle to qualify`)
    }
    console.log()
  }

  const eligible = tickets.filter(t => t.updatedAt < thirtyMinAgo)
  console.log(`Summary: ${eligible.length}/${tickets.length} ticket(s) ready for auto-wake now`)

  if (eligible.length === 0 && tickets.length > 0) {
    const soonest = tickets[0]
    const minLeft = Math.ceil((thirtyMinAgo - soonest.updatedAt) / 60000 * -1)
    console.log(`Next ticket becomes eligible in ~${minLeft} minutes`)
  }

  console.log()
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
