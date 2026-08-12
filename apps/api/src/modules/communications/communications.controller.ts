import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { CommunicationsService } from './communications.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentTenant } from '../../common/decorators/tenant.decorator'

@Controller('communications')
export class CommunicationsController {
  constructor(private readonly comms: CommunicationsService) {}

  // ──────────────────────────────────────────────
  // Twilio Webhooks (no auth — Twilio calls these)
  // ──────────────────────────────────────────────

  /** POST /communications/sms/inbound?tenantId=xxx */
  @Post('sms/inbound')
  @HttpCode(200)
  async smsInbound(@Query('tenantId') tenantId: string, @Req() req: Request, @Res() res: Response) {
    res.set('Content-Type', 'text/xml')
    try {
      const body = (req.body || {}) as Record<string, string>
      const result = await this.comms.handleInboundSms({
        tenantId: tenantId || '',
        from: body.From || '',
        to: body.To || '',
        body: body.Body || '',
        twilioSid: body.MessageSid || '',
      })
      res.send(this.buildMessageTwiml(result.reply, result.sentViaApi))
    } catch (err) {
      console.error('[sms/inbound]', err)
      res.send(this.buildMessageTwiml('Thank you for your message. We will get back to you shortly.', false))
    }
  }

  /** POST /communications/whatsapp/inbound?tenantId=xxx */
  @Post('whatsapp/inbound')
  @HttpCode(200)
  async whatsappInbound(@Query('tenantId') tenantId: string, @Req() req: Request, @Res() res: Response) {
    res.set('Content-Type', 'text/xml')
    try {
      const body = (req.body || {}) as Record<string, string>
      const mediaUrls: string[] = []
      const mediaContentTypes: string[] = []
      const numMedia = parseInt(body.NumMedia || '0', 10)
      for (let i = 0; i < numMedia; i++) {
        if (body[`MediaUrl${i}`]) {
          mediaUrls.push(body[`MediaUrl${i}`])
          mediaContentTypes.push(body[`MediaContentType${i}`] || '')
        }
      }

      const result = await this.comms.handleInboundWhatsApp({
        tenantId: tenantId || '',
        from: body.From || '',
        to: body.To || '',
        body: body.Body || body.ButtonText || body.ButtonPayload || '',
        twilioSid: body.MessageSid || '',
        mediaUrls,
        mediaContentTypes,
      })
      res.send(this.buildMessageTwiml(result.reply, result.sentViaApi))
    } catch (err) {
      console.error('[whatsapp/inbound]', err)
      res.send(this.buildMessageTwiml('Thank you for your message. We will get back to you shortly.', false))
    }
  }

  /** Empty <Response/> when already sent via Twilio REST (avoids duplicate WhatsApp/SMS). */
  private buildMessageTwiml(reply: string, sentViaApi: boolean): string {
    if (sentViaApi) {
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    }
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${this.escapeXml(reply)}</Message></Response>`
  }

  /** POST /communications/voice/inbound?tenantId=xxx */
  @Post('voice/inbound')
  @HttpCode(200)
  async voiceInbound(@Query('tenantId') tenantId: string, @Req() req: Request, @Res() res: Response) {
    const body = req.body as Record<string, string>
    const twiml = await this.comms.handleInboundVoice({
      tenantId,
      from: body.From || body.Caller || '',
      to: body.To || body.Called || '',
      callSid: body.CallSid || '',
    })
    res.set('Content-Type', 'text/xml')
    res.send(twiml)
  }

  /** POST /communications/voice/gather?tenantId=xxx — mid-call speech input */
  @Post('voice/gather')
  @HttpCode(200)
  async voiceGather(@Query('tenantId') tenantId: string, @Req() req: Request, @Res() res: Response) {
    const body = req.body as Record<string, string>
    const twiml = await this.comms.handleInboundVoice({
      tenantId,
      from: body.From || body.Caller || '',
      to: body.To || body.Called || '',
      callSid: body.CallSid || '',
      speechResult: body.SpeechResult,
    })
    res.set('Content-Type', 'text/xml')
    res.send(twiml)
  }

  // ──────────────────────────────────────────────
  // Authenticated endpoints
  // ──────────────────────────────────────────────

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  getSettings(@CurrentTenant() tenantId: string) {
    return this.comms.getSettings(tenantId)
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  saveSettings(@CurrentTenant() tenantId: string, @Body() dto: Record<string, string>) {
    return this.comms.saveSettings(tenantId, dto)
  }

  @Post('test-connection')
  @UseGuards(JwtAuthGuard)
  testConnection(@CurrentTenant() tenantId: string) {
    return this.comms.testConnection(tenantId)
  }

  @Get('logs')
  @UseGuards(JwtAuthGuard)
  getLogs(
    @CurrentTenant() tenantId: string,
    @Query('channel') channel?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.comms.getLogs(tenantId, {
      channel,
      limit: limit ? parseInt(limit) : 50,
      skip: skip ? parseInt(skip) : 0,
    })
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  sendMessage(
    @CurrentTenant() tenantId: string,
    @Body() dto: { to: string; message: string; channel: 'SMS' | 'WHATSAPP'; mediaUrls?: string[] },
  ) {
    return this.comms.sendCustomNotification({
      tenantId,
      to: dto.to,
      message: dto.message,
      channel: dto.channel,
      mediaUrls: dto.mediaUrls,
    })
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
