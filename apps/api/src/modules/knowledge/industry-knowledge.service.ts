import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

function chunkText(text: string, maxChars = 1500, overlap = 200): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
  const chunks: string[] = []
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

@Injectable()
export class IndustryKnowledgeService {
  private readonly logger = new Logger(IndustryKnowledgeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  // ── Admin: list all packs ─────────────────────────────────────────

  findAllPacks() {
    return this.prisma.industryKnowledgePack.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { industry: 'asc' },
    })
  }

  findPackByIndustry(industry: string) {
    return this.prisma.industryKnowledgePack.findUnique({
      where: { industry: industry.toUpperCase() },
      include: {
        documents: {
          where: { isActive: true },
          select: { id: true, name: true, category: true, agentRoles: true },
        },
      },
    })
  }

  // ── Admin: create / update pack ───────────────────────────────────

  async upsertPack(industry: string, name: string, description?: string) {
    return this.prisma.industryKnowledgePack.upsert({
      where: { industry: industry.toUpperCase() },
      create: { industry: industry.toUpperCase(), name, description },
      update: { name, description },
    })
  }

  // ── Admin: add document to pack and embed it ──────────────────────

  async addDocument(packId: string, dto: {
    name: string
    category: string
    agentRoles: string[]
    content: string
  }) {
    const doc = await this.prisma.industryKnowledgeDoc.create({
      data: { packId, ...dto },
    })

    // Embed async
    this.embedDocument(doc.id, dto.content).catch(e =>
      this.logger.warn(`[IndustryKnowledge] Embed failed for doc ${doc.id}: ${e.message}`)
    )

    return doc
  }

  async embedDocument(docId: string, content: string) {
    const chunks = chunkText(content)
    this.logger.log(`[IndustryKnowledge] Embedding doc ${docId} — ${chunks.length} chunks`)

    // Delete old chunks first (re-embed support)
    await this.prisma.industryKnowledgeChunk.deleteMany({ where: { docId } })

    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await this.ai.embed(chunks[i])
        await this.prisma.industryKnowledgeChunk.create({
          data: { docId, content: chunks[i], embedding: embedding as any, chunkIndex: i },
        })
      } catch (e: any) {
        this.logger.warn(`[IndustryKnowledge] Chunk ${i} embed failed: ${e.message}`)
      }
    }

    this.logger.log(`[IndustryKnowledge] Doc ${docId} fully embedded`)
  }

  // ── Embed all unembedded docs in a pack ───────────────────────────

  async embedAllInPack(industry: string) {
    const pack = await this.prisma.industryKnowledgePack.findUnique({
      where: { industry: industry.toUpperCase() },
      include: { documents: { where: { isActive: true } } },
    })
    if (!pack) { this.logger.warn(`No pack found for industry: ${industry}`); return }

    for (const doc of pack.documents) {
      const existing = await this.prisma.industryKnowledgeChunk.count({ where: { docId: doc.id } })
      if (existing === 0) {
        await this.embedDocument(doc.id, doc.content)
      }
    }
  }

  // ── RAG retrieval — called by KnowledgeService.retrieveContext ────
  //
  // Returns top-K chunks from the industry pack relevant to the query,
  // filtered by the agent's role so each specialist gets their slice.

  async retrieveForRole(industry: string, agentRole: string, query: string, topK = 3): Promise<string> {
    try {
      const roleLC = agentRole.toLowerCase()

      // Find relevant docs for this role in this industry
      const docs = await this.prisma.industryKnowledgeDoc.findMany({
        where: {
          isActive: true,
          pack: { industry: industry.toUpperCase(), isActive: true },
          // Match docs whose agentRoles array contains a role keyword matching this agent
          // We do a broad fetch and filter in memory for simplicity
        },
        select: { id: true, agentRoles: true },
      })

      // Filter by role match in memory
      const matchingDocIds = docs
        .filter(d => d.agentRoles.length === 0 || d.agentRoles.some(r => roleLC.includes(r.toLowerCase()) || r.toLowerCase().includes(roleLC.split(' ')[0])))
        .map(d => d.id)

      if (!matchingDocIds.length) {
        // Fallback: return any doc in this industry pack
        const fallbackDocs = docs.map(d => d.id)
        if (!fallbackDocs.length) return ''
        matchingDocIds.push(...fallbackDocs)
      }

      const chunks = await this.prisma.industryKnowledgeChunk.findMany({
        where: { docId: { in: matchingDocIds } },
        select: { content: true, embedding: true, doc: { select: { name: true, category: true } } },
      })

      if (!chunks.length) return ''

      const queryEmbedding = await this.ai.embed(query)

      const scored = chunks
        .filter(c => Array.isArray(c.embedding) && (c.embedding as number[]).length > 0)
        .map(c => ({
          content: c.content,
          label: `${(c.doc as any)?.category ?? 'INDUSTRY'} — ${(c.doc as any)?.name ?? ''}`,
          score: cosineSimilarity(queryEmbedding, c.embedding as number[]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter(c => c.score > 0.25)  // slightly lower threshold than tenant docs

      if (!scored.length) return ''

      const lines = scored.map(c => `[Industry: ${c.label}]\n${c.content}`)
      return lines.join('\n\n---\n')
    } catch (e: any) {
      this.logger.warn(`[IndustryKnowledge] Retrieval failed: ${e.message}`)
      return ''
    }
  }
}
