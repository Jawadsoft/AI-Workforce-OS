require('./load-env')
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main() {
  console.log('\n=== Debugging RAG for Cris (Estimator) ===\n')

  // Get all ROOFING chunks and check embedding status
  const chunks = await db.industryKnowledgeChunk.findMany({
    where: { doc: { pack: { industry: 'ROOFING' }, isActive: true } },
    select: { id: true, content: true, embedding: true, doc: { select: { name: true, category: true, agentRoles: true } } },
  })

  console.log(`Total ROOFING chunks: ${chunks.length}\n`)
  let withEmbedding = 0
  for (const c of chunks) {
    const hasEmbed = Array.isArray(c.embedding) && c.embedding.length > 0
    if (hasEmbed) withEmbedding++
    console.log(`  Doc: "${c.doc.name}" [${c.doc.category}]`)
    console.log(`    Roles: ${JSON.stringify(c.doc.agentRoles)}`)
    console.log(`    Embedding: ${hasEmbed ? `✔ (${c.embedding.length} dims)` : '✘ EMPTY'}`)
    console.log(`    Content preview: "${c.content.slice(0, 80)}..."`)
    console.log()
  }

  console.log(`Chunks with valid embeddings: ${withEmbedding}/${chunks.length}`)

  // Check role matching for "Estimator"
  const roleLC = 'estimator'
  const matchingDocs = chunks.filter(c =>
    c.doc.agentRoles.length === 0 ||
    c.doc.agentRoles.some(r => roleLC.includes(r.toLowerCase()) || r.toLowerCase().includes(roleLC.split(' ')[0]))
  )
  console.log(`\nChunks that role-match "Estimator": ${matchingDocs.length}/${chunks.length}`)
  console.log(`Chunks with BOTH valid embedding AND role match: ${matchingDocs.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0).length}`)

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
