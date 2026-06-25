/**
 * Embeds all industry knowledge documents that don't yet have chunks.
 * Calls OpenAI embeddings API directly using the same key as the app.
 *
 * Usage:  node scripts/embed-industry-knowledge.js
 */

require('./load-env')
const https = require('https')
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client')

const prisma = new PrismaClient()
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set in .env')
  process.exit(1)
}

function chunkText(text, maxChars = 1500, overlap = 200) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
  const chunks = []
  let current = ''
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      const words = current.split(' ')
      current = words.slice(-Math.floor(overlap / 6)).join(' ') + '\n\n' + para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 50)
}

function embedText(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'text-embedding-3-small', input: text })
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          if (parsed.error) reject(new Error(parsed.error.message))
          else resolve(parsed.data[0].embedding)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('\n\x1b[1m=== Embedding Industry Knowledge Packs ===\x1b[0m\n')

  const docs = await prisma.industryKnowledgeDoc.findMany({
    where: { isActive: true },
    include: {
      pack: { select: { industry: true } },
      _count: { select: { chunks: true } },
    },
  })

  const toEmbed = docs.filter(d => d._count.chunks === 0)

  if (!toEmbed.length) {
    console.log('All documents already have embeddings. Nothing to do.')
    console.log(`Total docs: ${docs.length}, all embedded.`)
    return
  }

  console.log(`Found ${toEmbed.length} document(s) to embed (out of ${docs.length} total)\n`)

  for (const doc of toEmbed) {
    const chunks = chunkText(doc.content)
    console.log(`[${doc.pack.industry}] "${doc.name}" — ${chunks.length} chunks`)

    // Delete any stale chunks first
    await prisma.industryKnowledgeChunk.deleteMany({ where: { docId: doc.id } })

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await embedText(chunks[i])
        await prisma.industryKnowledgeChunk.create({
          data: { docId: doc.id, content: chunks[i], embedding, chunkIndex: i },
        })
        process.stdout.write(`.`)
        await sleep(200) // respect rate limits
      } catch (e) {
        console.warn(`\n  ⚠ Chunk ${i} failed: ${e.message}`)
      }
    }
    console.log(` ✔`)
  }

  // Summary
  const total = await prisma.industryKnowledgeChunk.count()
  console.log(`\n\x1b[32m✔ Done — ${total} total chunks embedded across all industry packs\x1b[0m\n`)
}

main()
  .catch(e => { console.error('\x1b[31m✘ Error:\x1b[0m', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
