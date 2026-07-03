import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import * as nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { decrypt } from '../integrations/crypto.util'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromName: string
  fromEmail: string
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  constructor(private prisma: PrismaService) {}

  // ── Get SMTP config ───────────────────────────────────────────────
  // Priority: 1) tenant.settings (manual override)
  //           2) ConnectedAccount (IMAP integration configured in UI)
  //           3) .env fallback

  async getSmtpConfig(tenantId?: string): Promise<SmtpConfig> {
    if (tenantId) {
      // 1) Explicit tenant settings
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      })
      const s = (tenant?.settings as Record<string, string>) || {}
      if (s.smtpHost && s.smtpUser && s.smtpPass) {
        return {
          host: s.smtpHost,
          port: parseInt(s.smtpPort || '587'),
          secure: s.smtpSecure === 'true',
          user: s.smtpUser,
          pass: s.smtpPass,
          fromName: s.smtpFromName || s.smtpUser,
          fromEmail: s.smtpFromEmail || s.smtpUser,
        }
      }

      // 2) ConnectedAccount (IMAP/SMTP integration configured in the Integrations UI)
      const account = await this.prisma.connectedAccount.findFirst({
        where: { tenantId, provider: 'imap', status: 'active' },
        orderBy: { createdAt: 'desc' },
      })
      if (account) {
        const meta = account.metadata as any
        if (meta?.smtpHost && meta?.encryptedSmtpPassword) {
          try {
            return {
              host: meta.smtpHost,
              port: meta.smtpPort ?? 587,
              secure: meta.smtpSecure ?? false,
              user: meta.smtpUser || account.accountEmail,
              pass: decrypt(meta.encryptedSmtpPassword),
              fromName: meta.smtpFromName || account.accountName || account.accountEmail,
              fromEmail: account.accountEmail,
            }
          } catch (e) {
            this.logger.warn(`[EmailService] ConnectedAccount decrypt failed — falling back to .env SMTP: ${e.message}`)
            // Fall through to .env fallback below
          }
        }
      }
    }

    // 3) .env fallback
    return {
      host: process.env.SMTP_HOST || 'smtp.office365.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      fromName: process.env.SMTP_FROM_NAME || 'AI Workforce OS',
      fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '',
    }
  }

  private async buildTransporter(tenantId?: string): Promise<Transporter> {
    const cfg = await this.getSmtpConfig(tenantId)
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      tls: { rejectUnauthorized: false },
    })
  }

  // ── Generic send ──────────────────────────────────────────────────

  async send(params: {
    tenantId?: string
    to: string | string[]
    subject: string
    html: string
    text?: string
  }): Promise<void> {
    const cfg = await this.getSmtpConfig(params.tenantId)
    if (!cfg.user || !cfg.pass) {
      this.logger.warn('SMTP not configured — skipping email send')
      return
    }

    // Dev override: redirect ALL outgoing emails to a safe address
    const devOverride = process.env.DEV_EMAIL_OVERRIDE
    const originalTo = Array.isArray(params.to) ? params.to.join(', ') : params.to
    const actualTo = devOverride ?? originalTo
    const subject = devOverride
      ? `[DEV → ${originalTo}] ${params.subject}`
      : params.subject

    const transporter = await this.buildTransporter(params.tenantId)
    try {
      await transporter.sendMail({
        from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
        to: actualTo,
        subject,
        html: params.html,
        text: params.text,
      })
      this.logger.log(`Email sent to ${actualTo}${devOverride ? ` (dev override — original: ${originalTo})` : ''}: ${params.subject}`)
    } catch (err) {
      this.logger.error(`Email send failed: ${err}`)
      throw err
    }
  }

  async testConnection(tenantId?: string): Promise<{ success: boolean; message: string }> {
    const cfg = await this.getSmtpConfig(tenantId)
    if (!cfg.user || !cfg.pass) {
      return { success: false, message: 'SMTP credentials not configured' }
    }
    try {
      const transporter = await this.buildTransporter(tenantId)
      await transporter.verify()
      return { success: true, message: `Connected to ${cfg.host}:${cfg.port} as ${cfg.user}` }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, message: msg }
    }
  }

  // ── Template: Forgot Password ─────────────────────────────────────

  async sendPasswordReset(params: {
    tenantId?: string
    to: string
    name: string
    resetUrl: string
  }): Promise<void> {
    await this.send({
      tenantId: params.tenantId,
      to: params.to,
      subject: 'Reset your AI Workforce OS password',
      html: this.passwordResetTemplate(params.name, params.resetUrl),
    })
  }

  // ── Template: Team Invite ─────────────────────────────────────────

  async sendTeamInvite(params: {
    tenantId?: string
    to: string
    inviteeName: string
    inviterName: string
    companyName: string
    role: string
    loginUrl: string
    tempPassword: string
  }): Promise<void> {
    await this.send({
      tenantId: params.tenantId,
      to: params.to,
      subject: `You've been invited to join ${params.companyName} on AI Workforce OS`,
      html: this.teamInviteTemplate(params),
    })
  }

  // ── Template: Approval Required ──────────────────────────────────

  async sendApprovalRequired(params: {
    tenantId?: string
    to: string
    ownerName: string
    agentName: string
    action: string
    approvalUrl: string
  }): Promise<void> {
    await this.send({
      tenantId: params.tenantId,
      to: params.to,
      subject: `Action Required: ${params.agentName} needs your approval`,
      html: this.approvalTemplate(params),
    })
  }

  // ── Template: Approval Result ─────────────────────────────────────

  async sendApprovalResult(params: {
    tenantId?: string
    to: string
    agentName: string
    action: string
    approved: boolean
    reason?: string
  }): Promise<void> {
    const status = params.approved ? 'Approved ✅' : 'Rejected ❌'
    await this.send({
      tenantId: params.tenantId,
      to: params.to,
      subject: `Approval ${status}: ${params.action}`,
      html: this.approvalResultTemplate(params),
    })
  }

  // ── HTML Templates ────────────────────────────────────────────────

  private passwordResetTemplate(name: string, resetUrl: string): string {
    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">Reset your password</h2>
      <p style="color:#64748b;">Hi ${name},</p>
      <p style="color:#64748b;">We received a request to reset your password. Click the button below to create a new one. This link expires in <strong>1 hour</strong>.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Reset Password</a>
      </div>
      <p style="color:#94a3b8;font-size:13px;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;">Or copy this link: <a href="${resetUrl}" style="color:#2563eb;">${resetUrl}</a></p>
    `)
  }

  private teamInviteTemplate(p: { inviteeName: string; inviterName: string; companyName: string; role: string; loginUrl: string; tempPassword: string }): string {
    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">You're invited! 🎉</h2>
      <p style="color:#64748b;">Hi ${p.inviteeName},</p>
      <p style="color:#64748b;"><strong>${p.inviterName}</strong> has invited you to join <strong>${p.companyName}</strong> on AI Workforce OS as a <strong>${p.role}</strong>.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#475569;font-size:14px;"><strong>Your login details:</strong></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">🌐 <a href="${p.loginUrl}" style="color:#2563eb;">${p.loginUrl}</a></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">📧 Email: <strong>${p.inviteeName}</strong></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">🔑 Temp password: <strong style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${p.tempPassword}</strong></p>
      </div>
      <p style="color:#94a3b8;font-size:13px;">Please change your password after first login.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${p.loginUrl}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Accept Invite & Log In</a>
      </div>
    `)
  }

  private approvalTemplate(p: { ownerName: string; agentName: string; action: string; approvalUrl: string }): string {
    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">⏳ Approval Required</h2>
      <p style="color:#64748b;">Hi ${p.ownerName},</p>
      <p style="color:#64748b;">Your AI agent <strong>${p.agentName}</strong> wants to perform an action that requires your approval:</p>
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0;color:#713f12;font-size:15px;">📋 <strong>${p.action}</strong></p>
      </div>
      <div style="text-align:center;margin:24px 0;display:flex;gap:12px;justify-content:center;">
        <a href="${p.approvalUrl}?action=approve" style="background:#16a34a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">✅ Approve</a>
        &nbsp;&nbsp;
        <a href="${p.approvalUrl}?action=reject" style="background:#dc2626;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">❌ Reject</a>
      </div>
      <p style="color:#94a3b8;font-size:13px;">Or review in full detail: <a href="${p.approvalUrl}" style="color:#2563eb;">${p.approvalUrl}</a></p>
    `)
  }

  private approvalResultTemplate(p: { agentName: string; action: string; approved: boolean; reason?: string }): string {
    const color = p.approved ? '#16a34a' : '#dc2626'
    const icon = p.approved ? '✅' : '❌'
    const status = p.approved ? 'approved' : 'rejected'
    return this.wrapEmail(`
      <h2 style="color:${color};margin-bottom:8px;">${icon} Action ${status}</h2>
      <p style="color:#64748b;">The following action by <strong>${p.agentName}</strong> was <strong style="color:${color};">${status}</strong>:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0;color:#1e293b;font-size:15px;">${p.action}</p>
        ${p.reason ? `<p style="margin:8px 0 0;color:#64748b;font-size:13px;">Reason: ${p.reason}</p>` : ''}
      </div>
    `)
  }

  private wrapEmail(content: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:linear-gradient(135deg,#1e40af,#2563eb);padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⚡ AI Workforce OS</h1>
    </div>
    <div style="padding:32px;">
      ${content}
    </div>
    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">AI Workforce OS · Automated with AI · <a href="#" style="color:#94a3b8;">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`
  }
}
