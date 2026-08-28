/**
 * STEP 1 — Run this LOCALLY to export your team + hierarchy data.
 * Usage: node scripts/export-hierarchy.js
 * Output: scripts/hierarchy-export.json  (upload this file to your server)
 */

const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const fs = require('fs')
const path = require('path')

const p = new PrismaClient()

async function main() {
  // ── Users (staff profiles) ─────────────────────────────────────
  const users = await p.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      designation: true,
      department: true,
      phone: true,
      managerId: true,
      tenantId: true,
    },
  })

  // ── Agents with supervisor links ───────────────────────────────
  const agents = await p.agent.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      role: true,
      supervisorUserId: true,
      tenantId: true,
    },
  })

  // ── Saved hierarchy canvas layouts ────────────────────────────
  const hierarchies = await p.tenantHierarchy.findMany({
    include: {
      tenant: { select: { name: true, id: true } },
    },
  })

  // ── Escalation rules ──────────────────────────────────────────
  const escalationRules = await p.agentEscalationRule.findMany({
    include: {
      agent: { select: { name: true, role: true } },
      targetUser: { select: { email: true, name: true } },
    },
  })

  const exportData = {
    exportedAt: new Date().toISOString(),
    users: users.map(u => ({
      ...u,
      // Include manager email for cross-env matching
      _managerEmail: users.find(m => m.id === u.managerId)?.email ?? null,
    })),
    agents,
    hierarchies: hierarchies.map(h => ({
      tenantId: h.tenantId,
      tenantName: h.tenant.name,
      layout: h.layout,
      updatedAt: h.updatedAt,
    })),
    escalationRules: escalationRules.map(r => ({
      tenantId: r.tenantId,
      agentId: r.agentId,
      agentName: r.agent.name,
      agentRole: r.agent.role,
      trigger: r.trigger,
      triggerLabel: r.triggerLabel,
      action: r.action,
      targetUserEmail: r.targetUser?.email ?? null,
      targetAgentId: r.targetAgentId ?? null,
      urgency: r.urgency,
    })),
  }

  const outPath = path.join(__dirname, 'hierarchy-export.json')
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2))

  console.log(`\n✅ Export complete → ${outPath}`)
  console.log(`   Users:            ${exportData.users.length}`)
  console.log(`   Agents:           ${exportData.agents.length}`)
  console.log(`   Hierarchy layouts: ${exportData.hierarchies.length}`)
  console.log(`   Escalation rules:  ${exportData.escalationRules.length}`)
  console.log(`\n📤 Upload scripts/hierarchy-export.json to your server`)
  console.log(`   Then run: node scripts/import-hierarchy.js`)
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect() })
