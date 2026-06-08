import {
  Controller, Get, Post, Body, Param, Query,
  Res, Req, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PublicChatService } from './public-chat.service'
import type { Request, Response } from 'express'

class StartSessionDto {
  @IsOptional() @IsString() sessionId?: string
  @IsOptional() @IsString() visitorName?: string
  @IsOptional() @IsString() visitorEmail?: string
  @IsOptional() @IsString() visitorPhone?: string
}

@ApiTags('Public Widget')
@Controller('public')
export class PublicChatController {
  constructor(private readonly service: PublicChatService) {}

  // ── Widget config (safe metadata only, no auth) ───────────────────

  @Get('widget/:tenantId/:agentId/config')
  @ApiOperation({ summary: 'Get widget configuration for embedding' })
  getConfig(
    @Param('tenantId') tenantId: string,
    @Param('agentId') agentId: string,
  ) {
    return this.service.getWidgetConfig(tenantId, agentId)
  }

  // ── Start or resume a session ─────────────────────────────────────

  @Post('widget/:tenantId/:agentId/session')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start or resume a widget chat session' })
  async startSession(
    @Param('tenantId') tenantId: string,
    @Param('agentId') agentId: string,
    @Body() dto: StartSessionDto,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown'
    this.service.checkRateLimit(ip)
    await this.service.validateAgent(tenantId, agentId)
    const sessionId = await this.service.getOrCreateSession(tenantId, agentId, dto.sessionId, {
      name: dto.visitorName,
      email: dto.visitorEmail,
      phone: dto.visitorPhone,
    })
    return { sessionId }
  }

  // ── Get message history ───────────────────────────────────────────

  @Get('widget/:tenantId/session/:sessionId/messages')
  @ApiOperation({ summary: 'Get messages for a widget session' })
  getMessages(
    @Param('tenantId') tenantId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.service.getMessages(tenantId, sessionId)
  }

  // ── Streaming SSE ─────────────────────────────────────────────────
  // GET /public/widget/:tenantId/session/:sessionId/stream?content=hello

  @Get('widget/:tenantId/session/:sessionId/stream')
  @ApiOperation({ summary: 'Stream AI response for a widget message (SSE)' })
  async stream(
    @Param('tenantId') tenantId: string,
    @Param('sessionId') sessionId: string,
    @Query('content') content: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown'
    this.service.checkRateLimit(ip)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.flushHeaders()

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`)

    try {
      await this.service.streamMessage(tenantId, sessionId, content, send)
    } catch (err: any) {
      send({ error: err.message ?? 'Stream error' })
    } finally {
      res.end()
    }
  }

  // ── Serve widget.js embed script ──────────────────────────────────

  @Get('widget.js')
  @ApiOperation({ summary: 'Embeddable widget script' })
  serveWidgetScript(@Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
    const script = buildWidgetScript(frontendUrl)
    res.setHeader('Content-Type', 'application/javascript')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.send(script)
  }
}

function buildWidgetScript(frontendUrl: string): string {
  return `
(function() {
  'use strict';
  var tid = window.AIWORKFORCE_TENANT;
  var aid = window.AIWORKFORCE_AGENT;
  if (!tid || !aid) { console.warn('[AIWorkforce] AIWORKFORCE_TENANT and AIWORKFORCE_AGENT must be set'); return; }

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '#aiw-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:var(--aiw-color,#6366f1);',
    'color:#fff;border:none;cursor:pointer;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:99998;',
    'display:flex;align-items:center;justify-content:center;transition:transform .2s;}',
    '#aiw-btn:hover{transform:scale(1.08);}',
    '#aiw-frame{position:fixed;bottom:92px;right:24px;width:380px;height:560px;border:none;border-radius:16px;',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18);z-index:99999;display:none;background:#fff;}',
    '@media(max-width:480px){#aiw-frame{width:100vw;height:75vh;bottom:80px;right:0;border-radius:16px 16px 0 0;}}'
  ].join('');
  document.head.appendChild(style);

  // Create button
  var btn = document.createElement('button');
  btn.id = 'aiw-btn';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z"/></svg>';
  btn.title = 'Chat with us';
  document.body.appendChild(btn);

  // Create iframe
  var frame = document.createElement('iframe');
  frame.id = 'aiw-frame';
  frame.allow = 'microphone';
  document.body.appendChild(frame);

  var open = false;
  btn.addEventListener('click', function() {
    open = !open;
    if (open) {
      frame.src = '${frontendUrl}/widget/' + tid + '/' + aid;
      frame.style.display = 'block';
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    } else {
      frame.style.display = 'none';
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z"/></svg>';
    }
  });
})();
`.trim()
}
