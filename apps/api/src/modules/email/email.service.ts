import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import * as nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { decrypt } from '../integrations/crypto.util'
import { ImapFlow } from 'imapflow'

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
    inReplyTo?: string
    references?: string
    attachments?: Array<{
      filename: string
      content: Buffer
      contentType?: string
    }>
  }): Promise<{ messageId?: string }> {
    const cfg = await this.getSmtpConfig(params.tenantId)
    if (!cfg.user || !cfg.pass) {
      this.logger.warn('SMTP not configured — skipping email send')
      return {}
    }

    const actualTo = Array.isArray(params.to) ? params.to.join(', ') : params.to
    const subject = params.subject
    const attachments = (params.attachments ?? []).map(a => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }))

    const transporter = await this.buildTransporter(params.tenantId)
    try {
      const info = await transporter.sendMail({
        from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
        to: actualTo,
        subject,
        html: params.html,
        text: params.text,
        ...(attachments.length ? { attachments } : {}),
        ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
        ...(params.references ? { references: params.references } : {}),
      })
      this.logger.log(
        `Email sent to ${actualTo}: ${params.subject}` +
          (attachments.length ? ` (${attachments.length} attachment${attachments.length > 1 ? 's' : ''})` : ''),
      )
      const messageId = (info as any)?.messageId

      // Save a copy to the Sent folder via IMAP (non-blocking — does not affect delivery)
      this.appendToSent(cfg, {
        from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
        to: actualTo,
        subject,
        html: params.html,
        text: params.text,
        messageId,
        inReplyTo: params.inReplyTo,
        references: params.references,
        attachments,
      }).catch(e => this.logger.warn(`[EmailService] Sent-folder append failed (non-critical): ${e.message}`))

      return { messageId }
    } catch (err) {
      this.logger.error(`Email send failed: ${err}`)
      throw err
    }
  }

  /**
   * Appends the sent message to the IMAP Sent folder so it appears in the
   * sender's mailbox. Uses the same IMAP host/credentials derived from SMTP config.
   * Completely non-blocking — failures are logged but never thrown.
   */
  private async appendToSent(
    cfg: SmtpConfig,
    msg: {
      from: string
      to: string
      subject: string
      html: string
      text?: string
      messageId?: string
      inReplyTo?: string
      references?: string
      attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
    },
  ): Promise<void> {
    // Derive IMAP host from SMTP host — handle known providers and generic patterns
    let imapHost = cfg.host
    if (/^smtp\.office365\.com$/i.test(imapHost)) {
      imapHost = 'outlook.office365.com'
    } else if (/^smtp\.gmail\.com$/i.test(imapHost)) {
      imapHost = 'imap.gmail.com'
    } else if (/^smtp\./i.test(imapHost)) {
      // smtp.example.com → imap.example.com
      imapHost = imapHost.replace(/^smtp\./i, 'imap.')
    } else if (/^send\./i.test(imapHost)) {
      // send.one.com (one.com / IONOS) → imap.one.com
      imapHost = imapHost.replace(/^send\./i, 'imap.')
    } else if (/^mail\./i.test(imapHost)) {
      // mail.example.com → keep as-is (many providers use mail.* for both SMTP and IMAP)
    }
    // Otherwise keep the host as-is and try port 993

    const imapPort = 993  // IMAP SSL always on 993

    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    })
    client.on('error', (err: Error) => {
      this.logger.warn(`[appendToSent] IMAP error event: ${err.message}`)
    })

    try {
      await client.connect()

      // Find Sent folder — providers use different names
      const mailboxes = await client.list()
      const sentFolder = mailboxes.find(m =>
        m.flags.has('\\Sent') ||
        /^(\[Gmail\]\/Sent Mail|Sent Items|Sent Messages|Sent|INBOX\.Sent)$/i.test(m.path),
      )
      const folder = sentFolder?.path ?? 'Sent Items'

      // Build raw RFC 2822 message (multipart/mixed when attachments are present)
      const mixedBoundary = `mixed_${Date.now()}`
      const altBoundary = `alt_${Date.now()}`
      const plainText = msg.text ?? msg.html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      const now = new Date().toUTCString()
      const hasAttachments = (msg.attachments?.length ?? 0) > 0

      const alternativeParts = [
        `--${altBoundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        plainText,
        ``,
        `--${altBoundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        msg.html,
        ``,
        `--${altBoundary}--`,
      ].join('\r\n')

      const attachmentParts = (msg.attachments ?? []).map(att => {
        const safeName = att.filename.replace(/["\r\n]/g, '_')
        const type = att.contentType || 'application/octet-stream'
        return [
          `--${mixedBoundary}`,
          `Content-Type: ${type}; name="${safeName}"`,
          `Content-Transfer-Encoding: base64`,
          `Content-Disposition: attachment; filename="${safeName}"`,
          ``,
          att.content.toString('base64').replace(/(.{76})/g, '$1\r\n'),
          ``,
        ].join('\r\n')
      }).join('')

      const rawMessage = hasAttachments
        ? [
            `From: ${msg.from}`,
            `To: ${msg.to}`,
            `Subject: ${msg.subject}`,
            `Date: ${now}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
            ...(msg.messageId  ? [`Message-ID: ${msg.messageId}`]  : []),
            ...(msg.inReplyTo  ? [`In-Reply-To: ${msg.inReplyTo}`]  : []),
            ...(msg.references  ? [`References: ${msg.references}`]  : []),
            ``,
            `--${mixedBoundary}`,
            `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
            ``,
            alternativeParts,
            ``,
            attachmentParts,
            `--${mixedBoundary}--`,
          ].join('\r\n')
        : [
            `From: ${msg.from}`,
            `To: ${msg.to}`,
            `Subject: ${msg.subject}`,
            `Date: ${now}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
            ...(msg.messageId  ? [`Message-ID: ${msg.messageId}`]  : []),
            ...(msg.inReplyTo  ? [`In-Reply-To: ${msg.inReplyTo}`]  : []),
            ...(msg.references  ? [`References: ${msg.references}`]  : []),
            ``,
            alternativeParts,
          ].join('\r\n')

      try {
        await client.append(folder, Buffer.from(rawMessage), ['\\Seen'])
        this.logger.log(`[appendToSent] ✅ Saved to "${folder}" on ${imapHost}`)
      } catch (appendErr: any) {
        // ImapFlow v1.4+ may throw a BigInt serialization error even though the
        // APPEND succeeded on the server — treat it as success.
        if (appendErr.message?.includes('BigInt')) {
          this.logger.log(`[appendToSent] ✅ Saved (BigInt warning suppressed)`)
        } else {
          throw appendErr
        }
      }
    } finally {
      try { await client.logout() } catch {}
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

  // ── Template: Welcome & Verification ──────────────────────────────

  async sendWelcome(params: {
    tenantId?: string
    to: string
    name: string
    verificationUrl: string
  }): Promise<void> {
    await this.send({
      tenantId: params.tenantId,
      to: params.to,
      subject: 'Welcome to AI Workforce OS - Verify Your Account',
      html: this.welcomeTemplate(params.name, params.verificationUrl),
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
      html: this.teamInviteTemplate({
        ...params,
        email: params.to,
        roleLabel: this.roleLabel(params.role),
      }),
    })
  }

  // ── Template: Tenant Approval Request (for scoped admin) ─────────

  async sendTenantApprovalRequest(params: {
    to: string
    adminName: string
    tenantName: string
    ownerName: string
    ownerEmail: string
    industry?: string
    approveUrl: string
    rejectUrl: string
  }): Promise<void> {
    const safe = (v: string) => this.escapeHtml(v ?? '')
    await this.send({
      to: params.to,
      subject: `New Client Signup: ${params.tenantName} — Approve or Reject`,
      html: this.wrapEmail(`
        <h2 style="color:#1e293b;margin-bottom:8px;">🏢 New Client Signup</h2>
        <p style="color:#64748b;">Hi ${safe(params.adminName)},</p>
        <p style="color:#64748b;">A new client has been provisioned under your account and is waiting for your approval before they can access the platform.</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:24px 0;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr>
              <td style="color:#64748b;padding:6px 0;width:130px;">Company</td>
              <td style="color:#1e293b;font-weight:600;">${safe(params.tenantName)}</td>
            </tr>
            <tr>
              <td style="color:#64748b;padding:6px 0;">Owner</td>
              <td style="color:#1e293b;">${safe(params.ownerName)}</td>
            </tr>
            <tr>
              <td style="color:#64748b;padding:6px 0;">Email</td>
              <td style="color:#1e293b;">${safe(params.ownerEmail)}</td>
            </tr>
            ${params.industry ? `<tr>
              <td style="color:#64748b;padding:6px 0;">Industry</td>
              <td style="color:#1e293b;">${safe(params.industry)}</td>
            </tr>` : ''}
          </table>
        </div>

        <p style="color:#64748b;font-size:14px;margin-bottom:8px;">Click a button to take action. These links are single-use and expire in <strong>7 days</strong>.</p>

        <div style="text-align:center;margin:28px 0;">
          <a href="${params.approveUrl}"
             style="background:#16a34a;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;margin-right:12px;">
            ✅ Approve Client
          </a>
          <a href="${params.rejectUrl}"
             style="background:#dc2626;color:#fff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
            ❌ Reject
          </a>
        </div>

        <p style="color:#94a3b8;font-size:12px;">If the buttons don't work, copy and paste the approve link:<br>
          <a href="${params.approveUrl}" style="color:#2563eb;word-break:break-all;">${params.approveUrl}</a>
        </p>
      `),
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

  private welcomeTemplate(name: string, verificationUrl: string): string {
    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">Welcome to AI Workforce OS! 🚀</h2>
      <p style="color:#64748b;">Hi ${name},</p>
      <p style="color:#64748b;">Your account has been created successfully. To get started, please verify your email address by clicking the button below.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${verificationUrl}" style="background:#84cc16;color:#000;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Verify Email Address</a>
      </div>
      <p style="color:#64748b;font-size:14px;margin-top:24px;">Once verified, you'll be able to:</p>
      <ul style="color:#64748b;font-size:14px;line-height:1.8;">
        <li>Set your password</li>
        <li>Access your AI Workforce dashboard</li>
        <li>Deploy AI employees for your team</li>
        <li>Connect your CRM and knowledge base</li>
      </ul>
      <p style="color:#94a3b8;font-size:13px;margin-top:24px;">This verification link expires in <strong>7 days</strong>.</p>
      <p style="color:#94a3b8;font-size:13px;">If you didn't create this account, you can safely ignore this email.</p>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px;">Or copy this link: <a href="${verificationUrl}" style="color:#84cc16;">${verificationUrl}</a></p>
    `)
  }

  private roleLabel(role: string): string {
    const labels: Record<string, string> = {
      SUPER_ADMIN: 'Super Admin',
      TENANT_OWNER: 'Owner',
      TENANT_ADMIN: 'Admin',
      MANAGER: 'Manager',
      USER: 'Member',
      VIEWER: 'Viewer',
    }
    return labels[role?.toUpperCase?.() ?? ''] ?? role
  }

  private teamInviteTemplate(p: {
    inviteeName: string
    inviterName: string
    companyName: string
    role: string
    roleLabel: string
    email: string
    loginUrl: string
    tempPassword: string
  }): string {
    const safeName = this.escapeHtml(p.inviteeName)
    const safeCompany = this.escapeHtml(p.companyName)
    const safeInviter = this.escapeHtml(p.inviterName)
    const safeEmail = this.escapeHtml(p.email)
    const safeRole = this.escapeHtml(p.roleLabel || p.role)
    const safeLogin = this.escapeHtml(p.loginUrl)
    const safePassword = this.escapeHtml(p.tempPassword)
    return this.wrapEmail(`
      <h2 style="color:#1e293b;margin-bottom:8px;">You're invited! 🎉</h2>
      <p style="color:#64748b;">Hi ${safeName},</p>
      <p style="color:#64748b;"><strong>${safeInviter}</strong> has invited you to join <strong>${safeCompany}</strong> on AI Workforce OS as a <strong>${safeRole}</strong>.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#475569;font-size:14px;"><strong>Your login details:</strong></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">🌐 <a href="${safeLogin}" style="color:#2563eb;">${safeLogin}</a></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">📧 Email: <strong>${safeEmail}</strong></p>
        <p style="margin:4px 0;color:#1e293b;font-size:14px;">🔑 Temp password: <strong style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${safePassword}</strong></p>
      </div>
      <p style="color:#94a3b8;font-size:13px;">Please change your password after first login.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeLogin}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Accept Invite & Log In</a>
      </div>
    `)
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
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
