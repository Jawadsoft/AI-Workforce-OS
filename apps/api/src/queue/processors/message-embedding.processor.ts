import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'

export interface MessageEmbeddingJob {
  messageId: string
  conversationId: string
  tenantId: string
  agentId: string
  subjectKey?: string
  role: 'USER' | 'ASSISTANT'
  content: string
}

// Splits by paragraph then caps chunk size — mirrors KnowledgeService's chunker
// so raw chat messages are indexed the same way as uploaded documents.
function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  if (text.length <= maxChars) return [text.trim()].filter(Boolean)

  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
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
  return chunks.filter(c => c.length > 0)
}

@Processor('message-embedding')
export class MessageEmbeddingProcessor {
  private readonly logger = new Logger(MessageEmbeddingProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  @Process('embed-message')
  async handleEmbedMessage(job: Job<MessageEmbeddingJob>) {
    const { messageId, conversationId, tenantId, agentId, subjectKey, role, content } = job.data
    const trimmed = content?.trim()
    if (!trimmed || trimmed.length < 3) return

    try {
      const chunks = chunkText(trimmed)
      if (!chunks.length) return

      const rows: { content: string; embedding: number[] | null }[] = []
      for (const chunk of chunks) {
        try {
          const embedding = await this.ai.embed(chunk)
          rows.push({ content: chunk, embedding })
        } catch (err: any) {
          this.logger.warn(`[MessageEmbedding] Embed failed for a chunk of message ${messageId}: ${err.message}`)
          rows.push({ content: chunk, embedding: null })
        }
      }

      await this.prisma.messageChunk.createMany({
        data: rows.map((r, idx) => ({
          tenantId,
          agentId,
          conversationId,
          messageId,
          subjectKey: subjectKey ?? null,
          role,
          chunkIndex: idx,
          content: r.content,
          embedding: r.embedding as any,
        })),
      })
    } catch (err: any) {
      this.logger.warn(`[MessageEmbedding] Failed to embed message ${messageId}: ${err.message}`)
    }
  }
}
