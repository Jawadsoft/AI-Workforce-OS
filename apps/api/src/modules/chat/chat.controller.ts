import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Res, HttpCode, UseInterceptors, UploadedFile, Logger } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant, CurrentUser } from '../../common/decorators/tenant.decorator'
import { ChatService } from './chat.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import type { Response } from 'express'

class CreateConversationDto {
  @IsString() agentId: string
  @IsString() channel: string
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() callerPhone?: string
  @IsOptional() @IsString() callerEmail?: string
}

class SendMessageDto {
  @IsString() content: string
}

class TtsDto {
  @IsString() text: string
  @IsOptional() @IsString() agentName?: string
  @IsOptional() @IsString() agentId?: string
}

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name)

  constructor(
    private readonly service: ChatService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all conversations' })
  findAll(@CurrentTenant() tenantId: string, @Query('agentId') agentId?: string) {
    return this.service.findAll(tenantId, agentId)
  }

  @Post()
  @ApiOperation({ summary: 'Start a new conversation' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: any, @Body() dto: CreateConversationDto) {
    return this.service.create(tenantId, user.id, dto)
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  getMessages(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getMessages(tenantId, id)
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message and get AI response (non-streaming)' })
  sendMessage(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.service.sendMessage(tenantId, id, dto.content)
  }

  // ── Streaming SSE endpoint ────────────────────────────────────────
  // GET /chat/:id/stream?content=hello+world
  // Returns Server-Sent Events: data: {"token":"Hello"}\n\n
  //                              data: {"done":true,"messageId":"..."}\n\n

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream AI response as Server-Sent Events' })
  async streamMessage(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('content') content: string,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await this.service.streamMessage(tenantId, id, content, send)
    } catch (err: any) {
      send({ error: err.message ?? 'Stream error' })
    } finally {
      res.end()
    }
  }

  // ── Streaming with file attachment (multipart → SSE) ─────────────
  // POST /chat/:id/stream  (multipart/form-data: content + file?)
  // Returns same SSE format as GET /chat/:id/stream

  @Post(':id/stream')
  @ApiOperation({ summary: 'Stream AI response with optional file/image attachment' })
  @UseInterceptors(FileInterceptor('file'))
  async streamWithFile(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body('content') content: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const send = (data: object) => { res.write(`data: ${JSON.stringify(data)}\n\n`) }

    try {
      let attachments: { url: string; name: string; mimeType: string; extractedText?: string }[] | undefined

      if (file) {
        const docTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv', 'text/plain']
        const isDoc = docTypes.includes(file.mimetype)
        const isImage = file.mimetype.startsWith('image/')

        if (isDoc) {
          send({ attachment: { name: file.originalname, mimeType: file.mimetype, status: 'processing' } })
          send({ step: { label: `Reading ${file.originalname}`, status: 'active' } })

          let extractedText = ''
          let extractionThrew = false
          try {
            extractedText = await this.service.extractAttachmentText(file.buffer, file.mimetype, file.originalname)
            send({ step: { label: `Reading ${file.originalname}`, status: 'done' } })
            send({ step: { label: 'Extracting document content', status: 'active' } })
            send({ step: { label: 'Extracting document content', status: 'done' } })
          } catch (err: any) {
            extractionThrew = true
            this.logger.warn(`Inline extraction failed for ${file.originalname}: ${err.message}`)
            send({ step: { label: `Reading ${file.originalname}`, status: 'done' } })
            send({ step: { label: 'Processing in background...', status: 'active' } })
            this.service.queuePdfExtraction(id, tenantId, file.originalname, file.buffer, file.mimetype)
          }

          // Fire-and-forget Cloudinary upload (for persistent file reference)
          this.cloudinary.upload(
            tenantId, 'chat-attachments', `${Date.now()}-${file.originalname}`,
            file.buffer, file.mimetype, 'raw',
          ).catch((err: any) => this.logger.warn(`Cloudinary upload failed: ${err.message}`))

          const trimmedText = extractedText?.trim() ?? ''
          // IMPORTANT: an empty result from a successful extraction (e.g. a scanned/image-only
          // PDF with no text layer) is NOT the same as "still processing" — if we mislabel it as
          // __processing__, no background job gets queued (nothing threw) and the agent is left
          // with zero signal that a file ever arrived, so it wrongly asks the user to upload again.
          attachments = [{
            url: `local://${file.originalname}`,
            name: file.originalname,
            mimeType: file.mimetype,
            extractedText: trimmedText ? trimmedText : extractionThrew ? '__processing__' : '__empty__',
          }]

          if (trimmedText) {
            send({ step: { label: 'Preparing AI analysis', status: 'active' } })
          } else if (!extractionThrew) {
            send({ step: { label: 'No readable text found (may be a scanned/image file)', status: 'done' } })
          }

        } else if (isImage) {
          // Images: upload and pass URL for vision
          let url = ''
          try {
            url = await this.cloudinary.upload(tenantId, 'chat-attachments', `${Date.now()}-${file.originalname}`, file.buffer, file.mimetype, 'image')
          } catch (err: any) {
            this.logger.warn(`Image upload failed: ${err.message}`)
          }
          if (url) {
            attachments = [{ url, name: file.originalname, mimeType: file.mimetype }]
            send({ attachment: { url, name: file.originalname, mimeType: file.mimetype } })
          }
        }
      }

      await this.service.streamMessage(tenantId, id, content ?? '', send, attachments)
    } catch (err: any) {
      send({ error: err.message ?? 'Stream error' })
    } finally {
      res.end()
    }
  }

  @Get('agents/:agentId/system-prompt')
  @ApiOperation({ summary: 'Preview the full system prompt sent to this agent' })
  getSystemPrompt(@CurrentTenant() tenantId: string, @Param('agentId') agentId: string) {
    return this.service.getAgentSystemPrompt(tenantId, agentId).then((prompt) => ({ prompt }))
  }

  @Get('agents/:agentId/primary')
  @ApiOperation({ summary: 'Get or create the persistent primary conversation with this agent' })
  getPrimary(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('agentId') agentId: string,
  ) {
    return this.service.getOrCreatePrimaryConversation(tenantId, agentId, user.id)
  }

  @Delete(':id/messages')
  @ApiOperation({ summary: 'Clear all messages in a conversation' })
  clearMessages(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.clearMessages(tenantId, id)
  }

  // ── ElevenLabs TTS proxy ──────────────────────────────────────────
  // POST /chat/tts  { text, agentName? }
  // Returns: audio/mpeg stream
  @Post('tts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Convert text to speech via ElevenLabs (proxied, key stays server-side)' })
  async textToSpeech(
    @Body() dto: TtsDto,
    @Res() res: Response,
  ) {
    const audioStream = await this.service.textToSpeech(dto.text, dto.agentName, dto.agentId)
    ;(res as any).setHeader('Content-Type', 'audio/mpeg')
    ;(res as any).setHeader('Transfer-Encoding', 'chunked')
    audioStream.pipe(res as any)
  }
}
