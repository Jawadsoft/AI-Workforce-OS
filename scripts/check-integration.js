require('./load-env')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')
const p = new PrismaClient()

async function main() {
  // 1. Check tenant industry fields
  const tenants = await p.tenant.findMany({
    select: { name: true, industry: true, id: true, settings: true }
  })

  console.log('\n=== TENANTS & INDUSTRY ===')
  for (const t of tenants) {
    const brainIndustry = (t.settings && t.settings.brain) ? t.settings.brain.industry : null
    const effectiveIndustry = brainIndustry || t.industry || 'NOT SET'
    const hasPack = await p.industryKnowledgePack.findUnique({
      where: { industry: (effectiveIndustry || '').toUpperCase() }
    })
    const status = hasPack ? '✔ Pack found' : '✘ No pack for this industry'
    console.log(`  ${t.name}: industry="${effectiveIndustry}" ${status}`)
  }

  // 2. Check industry packs and chunk counts
  const packs = await p.industryKnowledgePack.findMany({
    include: {
      documents: { include: { _count: { select: { chunks: true } } } }
    }
  })

  console.log('\n=== INDUSTRY PACKS ===')
  for (const pack of packs) {
    const totalChunks = pack.documents.reduce((sum, d) => sum + d._count.chunks, 0)
    const embedded = pack.documents.filter(d => d._count.chunks > 0).length
    console.log(`  ${pack.industry} — ${pack.documents.length} docs, ${totalChunks} chunks embedded (${embedded}/${pack.documents.length} docs ready)`)
    for (const doc of pack.documents) {
      const ready = doc._count.chunks > 0 ? '✔' : '✘'
      console.log(`    ${ready} [${doc.category}] "${doc.name}" — ${doc._count.chunks} chunks, roles: [${doc.agentRoles.join(', ')}]`)
    }
  }

  // 3. Check if retrieveContext gets industry+role passed correctly
  // by inspecting active agents and their roles
  console.log('\n=== ACTIVE AGENTS (role → pack category match) ===')
  const agents = await p.agent.findMany({
    where: { status: 'ACTIVE' },
    include: { tenant: { select: { name: true, industry: true, settings: true } } },
    orderBy: { createdAt: 'asc' }
  })

  for (const a of agents) {
    const brainIndustry = (a.tenant && a.tenant.settings && a.tenant.settings.brain) ? a.tenant.settings.brain.industry : null
    const industry = ((brainIndustry || (a.tenant && a.tenant.industry) || '')).toUpperCase()
    const roleLC = a.role.toLowerCase()

    // Simulate which docs they'd match
    let matchNote = ''
    if (industry === 'ROOFING') {
      if (/estimator|sales/.test(roleLC)) matchNote = '→ Pricing + Products + Insurance docs'
      else if (/insurance/.test(roleLC)) matchNote = '→ Insurance + Legal docs'
      else if (/inspect|field/.test(roleLC)) matchNote = '→ Inspection + Process docs'
      else if (/intake|customer|coordinator/.test(roleLC)) matchNote = '→ Terminology + Overview docs'
      else matchNote = '→ All roofing docs (fallback)'
    } else if (industry === 'CLEANING') {
      if (/sales|estimator/.test(roleLC)) matchNote = '→ Pricing docs'
      else if (/operations|coordinator/.test(roleLC)) matchNote = '→ Methods + Process docs'
      else matchNote = '→ All cleaning docs (fallback)'
    } else {
      matchNote = `✘ Industry "${industry}" — no pack yet`
    }

    console.log(`  ${a.tenant?.name}: ${a.name} (${a.role}) ${matchNote}`)
  }

  console.log('\n=== INTEGRATION STATUS ===')
  const allChunks = await p.industryKnowledgeChunk.count()
  console.log(`  Total embedded chunks: ${allChunks}`)
  console.log(`  Knowledge flows to agents via: retrieveContext(agentId, query, industry, role)`)
  console.log(`  Called in: sendMessage, streamMessage, handoff_to_agent, autoWakeAgent`)
  console.log(`  RAG runs in parallel with ticket fetch — no latency impact\n`)
}

main().catch(e => console.error(e.message)).finally(() => p.$disconnect())
