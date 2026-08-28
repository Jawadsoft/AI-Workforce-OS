const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const p = new PrismaClient()

async function main() {
  // All users in all tenants
  const users = await p.user.findMany({
    select: { id: true, name: true, tenantId: true, isActive: true, phone: true, designation: true, managerId: true },
  })
  console.log('\n=== ALL USERS ===')
  for (const u of users) {
    console.log(`  ${u.name} | active:${u.isActive} | phone:${u.phone || 'NONE'} | designation:${u.designation || '-'} | managerId:${u.managerId || 'none'} | tenantId:...${u.tenantId.slice(-6)} | id:...${u.id.slice(-6)}`)
  }

  // Saved hierarchy layouts
  const hierarchies = await p.tenantHierarchy.findMany({
    select: { tenantId: true, updatedAt: true, layout: true },
  })
  console.log('\n=== SAVED HIERARCHIES ===')
  for (const h of hierarchies) {
    const layout = h.layout
    const nodes = layout?.nodes || []
    console.log(`  Tenant ...${h.tenantId.slice(-6)} | nodes: ${nodes.length} | updated: ${h.updatedAt}`)
    for (const n of nodes) {
      console.log(`    Node: ${n.data?.label || n.id} | type:${n.type} | id:${n.id.slice(-6)}`)
    }
  }

  // Agents with supervisorUserId set
  const agents = await p.agent.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, role: true, supervisorUserId: true, tenantId: true },
  })
  console.log('\n=== AGENTS (supervisor links) ===')
  for (const a of agents) {
    console.log(`  ${a.name} | role:${a.role} | supervisorUserId:${a.supervisorUserId || 'NONE'} | tenantId:...${a.tenantId.slice(-6)}`)
  }

  // Escalation rules
  const rules = await p.agentEscalationRule.findMany({
    include: { targetUser: { select: { name: true, phone: true } } }
  })
  console.log('\n=== ESCALATION RULES ===')
  for (const r of rules) {
    console.log(`  Agent:${r.agentId.slice(-6)} | trigger:"${r.triggerLabel}" → ${r.targetUser?.name || r.targetAgentId || 'N/A'} (${r.urgency})`)
  }
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
