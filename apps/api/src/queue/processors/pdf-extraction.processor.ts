import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { PrismaService } from '../../common/prisma/prisma.service'
import { RealtimeGateway } from '../../realtime/realtime.gateway'

export interface PdfExtractionJob {
  conversationId: string
  tenantId: string
  fileName: string
  /** Base64-encoded file buffer — passed directly to avoid Cloudinary dependency */
  fileBufferBase64: string
  mimeType: string
}

@Processor('knowledge-processing')
export class PdfExtractionProcessor {
  private readonly logger = new Logger(PdfExtractionProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Process('extract-pdf')
  async handlePdfExtraction(job: Job<PdfExtractionJob>) {
    const { conversationId, tenantId, fileName, fileBufferBase64, mimeType } = job.data
    this.logger.log(`[PDF] Starting extraction for ${fileName} in conversation ${conversationId}`)

    try {
      const buffer = Buffer.from(fileBufferBase64, 'base64')
      let extractedText = ''

      if (mimeType === 'application/pdf') {
        try {
          const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer, opts?: any) => Promise<{ text: string }>
          const result = await pdfParse(buffer, { max: 0 })
          extractedText = result?.text?.trim() ?? ''
        } catch (err: any) {
          this.logger.warn(`[PDF] pdf-parse failed for ${fileName}: ${err.message}`)
          // Raw text fallback
          const raw = buffer.toString('latin1')
          const matches = raw.match(/\(([^\)]{3,})\)/g) ?? []
          extractedText = matches.map((m: string) => m.slice(1, -1)).join(' ')
        }
      } else if (mimeType === 'text/plain' || mimeType === 'text/csv') {
        extractedText = buffer.toString('utf-8')
      } else if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
        try {
          const mod = await import('mammoth')
          const mammoth = (mod as any).default ?? mod
          const result = await mammoth.extractRawText({ buffer })
          extractedText = result.value ?? ''
        } catch (err: any) {
          this.logger.warn(`[PDF] mammoth failed for ${fileName}: ${err.message}`)
          extractedText = buffer.toString('utf-8')
        }
      }

      if (!extractedText.trim()) {
        this.logger.warn(`[PDF] No text extracted from ${fileName}`)
        this.realtime.emitToTenant(tenantId, 'document-ready', {
          conversationId,
          fileName,
          status: 'empty',
          message: `No readable text found in ${fileName}`,
        })
        return
      }

      const text = extractedText.slice(0, 15000)

      // Save extracted text to conversation metadata
      const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } })
      if (!conv) {
        this.logger.warn(`[PDF] Conversation ${conversationId} not found`)
        return
      }

      const meta = (conv.metadata as any) ?? {}
      const existingDocs: { name: string; text: string }[] = meta.documentContext ?? []
      const alreadySaved = existingDocs.find(d => d.name === fileName)

      if (!alreadySaved) {
        existingDocs.push({ name: fileName, text })
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { metadata: { ...meta, documentContext: existingDocs } },
        })
      }

      this.logger.log(`[PDF] Extraction complete for ${fileName} — ${text.length} chars saved`)

      const readyMessage = `I've finished processing "${fileName}". The document is ready now — send "summarize it" or ask any specific question about it.`
      await this.prisma.message.create({
        data: { conversationId, role: 'ASSISTANT', content: readyMessage },
      })

      // Notify the frontend via WebSocket
      this.realtime.emitToTenant(tenantId, 'document-ready', {
        conversationId,
        fileName,
        status: 'ready',
        message: readyMessage,
        preview: text.slice(0, 300),
      })

    } catch (err: any) {
      this.logger.error(`[PDF] Extraction failed for ${fileName}: ${err.message}`)
      this.realtime.emitToTenant(tenantId, 'document-ready', {
        conversationId,
        fileName,
        status: 'error',
        message: `Failed to process ${fileName}: ${err.message}`,
      })
    }
  }
}
