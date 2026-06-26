import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { IndustryKnowledgeService } from './industry-knowledge.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Simple text chunker — splits by paragraphs then limits token count
function chunkText(text: string, maxChars = 1500, overlap = 200): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      // Overlap: keep last portion of previous chunk
      const words = current.split(' ')
      current = words.slice(-Math.floor(overlap / 6)).join(' ') + '\n\n' + para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 50)
}

// Cosine similarity between two embedding vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)
  private readonly localUploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly industryKnowledge: IndustryKnowledgeService,
    private readonly cloudinary: CloudinaryService,
  ) {
    if (!fs.existsSync(this.localUploadDir)) fs.mkdirSync(this.localUploadDir, { recursive: true })
  }

  // ── List documents ────────────────────────────────────────────────

  findAll(tenantId: string) {
    return this.prisma.knowledgeDocument.findMany({
      where: { tenantId },
      include: { _count: { select: { chunks: true, agents: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.knowledgeDocument.findFirst({ where: { id, tenantId } })
  }

  // ── Upload & process ──────────────────────────────────────────────

  async upload(tenantId: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    const ext = path.extname(file.originalname).toLowerCase()
    const allowed = ['.pdf', '.txt', '.md', '.docx', '.csv']
    if (!allowed.includes(ext)) throw new BadRequestException(`File type ${ext} not supported. Use: ${allowed.join(', ')}`)

    const filename = `${crypto.randomUUID()}${ext}`

    // Upload to Cloudinary (or local disk in dev) — per-tenant folder
    const fileUrl = await this.cloudinary.upload(tenantId, 'knowledge', filename, file.buffer, file.mimetype, 'raw')

    // Create DB record (status = processing)
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        name: file.originalname,
        fileType: ext.replace('.', ''),
        fileUrl,
        fileSize: file.size,
        status: 'processing',
      },
    })

    // Process async (non-blocking) — we already have the buffer so no need to read from disk
    this.processDocument(doc.id, null, file.buffer, ext).catch(err => {
      this.logger.error(`Failed to process doc ${doc.id}: ${err.message}`)
      this.prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: 'error' } }).catch(() => {})
    })

    return doc
  }

  private async processDocument(docId: string, _filePath: string | null, buffer: Buffer, ext: string) {
    this.logger.log(`Processing document ${docId} (${ext})`)

    // Extract text
    const text = await this.extractText(buffer, ext)
    if (!text || text.length < 50) throw new Error('Could not extract text from document')

    // Chunk text
    const chunks = chunkText(text)
    this.logger.log(`Document ${docId}: ${chunks.length} chunks`)

    // Embed each chunk
    const embedded: { content: string; embedding: number[] }[] = []
    for (const chunk of chunks) {
      try {
        const embedding = await this.ai.embed(chunk)
        embedded.push({ content: chunk, embedding })
      } catch (err: any) {
        this.logger.warn(`Embedding failed for chunk: ${err.message}`)
        embedded.push({ content: chunk, embedding: [] })
      }
    }

    // Save chunks to DB
    await this.prisma.knowledgeChunk.createMany({
      data: embedded.map((e, idx) => ({
        documentId: docId,
        content: e.content,
        embedding: e.embedding as any,
        chunkIndex: idx,
      })),
    })

    await this.prisma.knowledgeDocument.update({
      where: { id: docId },
      data: { status: 'ready' },
    })

    this.logger.log(`Document ${docId} ready — ${embedded.length} chunks embedded`)
  }

  // ── Text extraction by file type ──────────────────────────────────

  async extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/csv': '.csv',
      'text/plain': '.txt',
    }
    const ext = mimeToExt[mimeType] ?? filename.slice(filename.lastIndexOf('.')) ?? '.txt'
    return this.extractText(buffer, ext)
  }

  private async extractText(buffer: Buffer, ext: string): Promise<string> {
    switch (ext) {
      case '.txt':
      case '.md':
        return buffer.toString('utf-8')

      case '.csv': {
        const text = buffer.toString('utf-8')
        // Convert CSV to readable text
        const lines = text.split('\n').filter(l => l.trim())
        const headers = lines[0]?.split(',').map(h => h.trim().replace(/"/g, '')) ?? []
        const rows = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/"/g, ''))
          return headers.map((h, i) => `${h}: ${vals[i] ?? ''}`).join(', ')
        })
        return [headers.join(' | '), ...rows].join('\n')
      }

      case '.pdf':
        return this.extractPDF(buffer)

      case '.docx':
        return this.extractDOCX(buffer)

      default:
        return buffer.toString('utf-8')
    }
  }

  private async extractPDF(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = await import('pdf-parse').then(m => (m as any).default ?? m) as any
      const result = await pdfParse(buffer)
      return result.text
    } catch (err: any) {
      this.logger.warn(`pdf-parse not available (${err.message}), extracting raw text`)
      // Fallback: extract readable strings from PDF bytes
      const raw = buffer.toString('latin1')
      const matches = raw.match(/\(([^\)]{3,})\)/g) ?? []
      return matches.map(m => m.slice(1, -1)).join(' ')
    }
  }

  private async extractDOCX(buffer: Buffer): Promise<string> {
    try {
      const mod = await import('mammoth')
      const mammoth = (mod as any).default ?? mod
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    } catch (err: any) {
      this.logger.warn(`mammoth not available: ${err.message}`)
      return buffer.toString('utf-8')
    }
  }

  // ── Assign / unassign agents ──────────────────────────────────────

  async assignToAgent(tenantId: string, docId: string, agentId: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({ where: { id: docId, tenantId } })
    if (!doc) throw new NotFoundException('Document not found')
    return this.prisma.agentKnowledge.upsert({
      where: { agentId_documentId: { agentId, documentId: docId } },
      create: { agentId, documentId: docId },
      update: {},
    })
  }

  async unassignFromAgent(tenantId: string, docId: string, agentId: string) {
    return this.prisma.agentKnowledge.deleteMany({ where: { agentId, documentId: docId } })
  }

  // ── RAG retrieval ─────────────────────────────────────────────────
  // Called by chat.service to inject relevant context into the prompt

  async retrieveContext(agentId: string, query: string, industry?: string, agentRole?: string, topK = 4): Promise<string> {
    try {
      // Run tenant docs + industry pack search in parallel for minimum latency
      const [tenantChunks, industryContext] = await Promise.all([
        // Layer 1 — Tenant-specific docs assigned to this agent
        this.prisma.knowledgeChunk.findMany({
          where: {
            document: {
              status: 'ready',
              agents: { some: { agentId } },
            },
          },
          select: { content: true, embedding: true, document: { select: { name: true } } },
        }),
        // Layer 2 — Industry pack for this tenant's industry + agent role
        industry && agentRole
          ? this.industryKnowledge.retrieveForRole(industry, agentRole, query, 3)
          : Promise.resolve(''),
      ])

      const lines: string[] = []

      // Score and add tenant docs (highest priority — most specific)
      if (tenantChunks.length) {
        const queryEmbedding = await this.ai.embed(query)
        const scored = tenantChunks
          .filter(c => Array.isArray(c.embedding) && (c.embedding as number[]).length > 0)
          .map(c => ({
            content: c.content,
            docName: (c.document as any)?.name ?? '',
            score: cosineSimilarity(queryEmbedding, c.embedding as number[]),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
          .filter(c => c.score > 0.28)

        scored.forEach(c => lines.push(`[${c.docName}]\n${c.content}`))
      }

      // Add industry pack context (general industry knowledge)
      if (industryContext) {
        lines.push(industryContext)
      }

      if (!lines.length) return ''

      return `\n\nKNOWLEDGE BASE (use this to answer accurately):\n${lines.join('\n\n---\n')}`
    } catch (err: any) {
      this.logger.warn(`RAG retrieval failed: ${err.message}`)
      return ''
    }
  }

  // ── Delete document ───────────────────────────────────────────────

  async remove(tenantId: string, id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({ where: { id, tenantId } })
    if (!doc) throw new NotFoundException('Document not found')
    await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: id } })
    await this.prisma.agentKnowledge.deleteMany({ where: { documentId: id } })
    await this.cloudinary.delete(doc.fileUrl)
    return this.prisma.knowledgeDocument.delete({ where: { id } })
  }
}
