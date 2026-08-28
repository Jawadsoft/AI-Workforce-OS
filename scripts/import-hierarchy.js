/**
 * STEP 2 — Run this ON YOUR SERVER after uploading hierarchy-export.json.
 * It matches users by email and agents by name+role, then applies:
 *   - designation, department, phone, managerId on users
 *   - supervisorUserId on agents
 *   - TenantHierarchy canvas layout
 *   - AgentEscalationRules
 *
 * Usage: node scripts/import-hierarchy.js
 * Safe to run multiple times — all operations are upserts.
 */

const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const fs = require('fs')
const path = require('path')

const p = new PrismaClient()

async function main() {
  const exportPath = path.join(__dirname, 'hierarchy-export.json')
  if (!fs.existsSync(exportPath)) {
    console.log('❌ hierarchy-export.json not found. Run export-hierarchy.js locally first.')
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(exportPath, 'utf-8'))
  console.log(`\n📥 Importing from export dated: ${data.exportedAt}`)

  // ── Build email→id map for server users ────────────────────────
  const serverUsers = await p.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, name: true, tenantId: true },
  })
  const emailToServerId = new Map(serverUsers.map(u => [u.email?.toLowerCase(), u.id]))
  const nameToServerId = new Map(serverUsers.map(u => [u.name?.toLowerCase(), u.id]))

  // ── Build agent name+role → id map for server agents ───────────
  const serverAgents = await p.agent.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, role: true, tenantId: true },
  })
  const agentNameToId = new Map(serverAgents.map(a => [`${a.name}|${a.role}`, a.id]))

  // Helper: resolve a local userId to server userId
  function resolveUserId(localId, localEmail) {
    if (!localId && !localEmail) return null
    const byEmail = localEmail ? emailToServerId.get(localEmail?.toLowerCase()) : null
    if (byEmail) return byEmail
    // fallback: try same ID (if same DB)
    const sameId = serverUsers.find(u => u.id === localId)
    return sameId?.id ?? null
  }

  // ── 1. Update user profiles ─────────────────────────────────────
  console.log('\n👥 Updating user profiles...')
  let userUpdated = 0, userSkipped = 0

  for (const u of data.users) {
    const serverId = resolveUserId(u.id, u.email)
    if (!serverId) { userSkipped++; continue }

    // Resolve managerId to server user id
    const managerServerId = resolveUserId(u.managerId, u._managerEmail)

    await p.user.update({
      where: { id: serverId },
      data: {
        designation: u.designation ?? undefined,
        department: u.department ?? undefined,
        phone: u.phone ?? undefined,
        managerId: managerServerId ?? undefined,
      },
    })
    userUpdated++
  }
  console.log(`   ✅ Updated: ${userUpdated} | Skipped (not found): ${userSkipped}`)

  // ── 2. Update agent supervisor links ───────────────────────────
  console.log('\n🤖 Updating agent supervisor links...')
  let agentUpdated = 0, agentSkipped = 0

  for (const a of data.agents) {
    const serverAgentId = agentNameToId.get(`${a.name}|${a.role}`)
    if (!serverAgentId) { agentSkipped++; continue }

    if (!a.supervisorUserId) { agentSkipped++; continue }

    // Find the local supervisor's email from exported users
    const localSupervisor = data.users.find(u => u.id === a.supervisorUserId)
    const serverSupervisorId = resolveUserId(a.supervisorUserId, localSupervisor?.email)

    await p.agent.update({
      where: { id: serverAgentId },
      data: { supervisorUserId: serverSupervisorId ?? null },
    })
    agentUpdated++
  }
  console.log(`   ✅ Updated: ${agentUpdated} | Skipped (not found): ${agentSkipped}`)

  // ── 3. Upsert hierarchy canvas layouts ─────────────────────────
  console.log('\n🗺️  Importing hierarchy canvas layouts...')

  for (const h of data.hierarchies) {
    // Find matching tenant on server by name
    const serverTenant = await p.tenant.findFirst({
      where: { name: h.tenantName },
      select: { id: true },
    })
    if (!serverTenant) {
      console.log(`   ⚠️  Tenant not found: ${h.tenantName} — skipping layout`)
      continue
    }

    // Remap node IDs in the layout from local user/agent IDs to server IDs
    const layout = h.layout
    if (layout?.nodes) {
      for (const node of layout.nodes) {
        if (node.type === 'staff') {
          const localUser = data.users.find(u => u.id === node.id)
          if (localUser) {
            const serverUserId = resolveUserId(localUser.id, localUser.email)
            if (serverUserId) node.id = serverUserId
          }
          if (node.data?.managerId) {
            const localManager = data.users.find(u => u.id === node.data.managerId)
            if (localManager) {
              const serverManagerId = resolveUserId(localManager.id, localManager.email)
              if (serverManagerId) node.data.managerId = serverManagerId
            }
          }
        } else if (node.type === 'agent') {
          const localAgent = data.agents.find(a => a.id === node.id)
          if (localAgent) {
            const serverAgentId = agentNameToId.get(`${localAgent.name}|${localAgent.role}`)
            if (serverAgentId) node.id = serverAgentId
          }
          if (node.data?.supervisorUserId) {
            const localSupervisor = data.users.find(u => u.id === node.data.supervisorUserId)
            if (localSupervisor) {
              const serverSupervisorId = resolveUserId(localSupervisor.id, localSupervisor.email)
              if (serverSupervisorId) node.data.supervisorUserId = serverSupervisorId
            }
          }
        }
      }

      // Remap edge source/target IDs too
      if (layout.edges) {
        for (const edge of layout.edges) {
          const srcUser = data.users.find(u => u.id === edge.source)
          const srcAgent = data.agents.find(a => a.id === edge.source)
          if (srcUser) edge.source = resolveUserId(srcUser.id, srcUser.email) ?? edge.source
          if (srcAgent) edge.source = agentNameToId.get(`${srcAgent.name}|${srcAgent.role}`) ?? edge.source

          const tgtUser = data.users.find(u => u.id === edge.target)
          const tgtAgent = data.agents.find(a => a.id === edge.target)
          if (tgtUser) edge.target = resolveUserId(tgtUser.id, tgtUser.email) ?? edge.target
          if (tgtAgent) edge.target = agentNameToId.get(`${tgtAgent.name}|${tgtAgent.role}`) ?? edge.target

          // Fix edge ID to match new source/target
          edge.id = `e-${edge.source}-${edge.target}`
        }
      }
    }

    await p.tenantHierarchy.upsert({
      where: { tenantId: serverTenant.id },
      update: { layout },
      create: { tenantId: serverTenant.id, layout },
    })
    console.log(`   ✅ Layout saved for tenant: ${h.tenantName}`)
  }

  // ── 4. Upsert escalation rules ─────────────────────────────────
  console.log('\n⚡ Importing escalation rules...')
  let rulesImported = 0

  for (const r of data.escalationRules) {
    const serverAgent = agentNameToId.get(`${r.agentName}|${r.agentRole}`)
    if (!serverAgent) continue

    const serverAgent2 = serverAgents.find(a => a.id === serverAgent)
    if (!serverAgent2) continue

    const targetUserId = r.targetUserEmail
      ? emailToServerId.get(r.targetUserEmail.toLowerCase()) ?? null
      : null

    const targetAgentId = r.targetAgentId
      ? agentNameToId.get(Object.entries(Object.fromEntries(agentNameToId)).find(([k]) => k.startsWith(r.targetAgentId ?? ''))?.[0] ?? '') ?? null
      : null

    // Delete old rules for this agent, then recreate
    await p.agentEscalationRule.deleteMany({
      where: { agentId: serverAgent, tenantId: serverAgent2.tenantId, trigger: r.trigger },
    })

    await p.agentEscalationRule.create({
      data: {
        tenantId: serverAgent2.tenantId,
        agentId: serverAgent,
        trigger: r.trigger,
        triggerLabel: r.triggerLabel,
        action: r.action ?? 'notify',
        targetUserId,
        targetAgentId: targetAgentId ?? null,
        urgency: r.urgency ?? 'NORMAL',
      },
    })
    rulesImported++
  }
  console.log(`   ✅ Escalation rules imported: ${rulesImported}`)

  console.log('\n🎉 Import complete! Your server hierarchy now matches local.')
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
