import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OAuth2Client } from 'google-auth-library'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { GmailAdapter } from './gmail/gmail.adapter'
import { ImapAdapter, ImapConfig } from './imap/imap.adapter'
import { AccountMailer } from './account-mailer'
import { EmailClassifier, EmailType } from './email-classifier'
import { ChatService } from '../chat/chat.service'
import { EmailService } from '../email/email.service'
import { encrypt, decrypt } from './crypto.util'

export interface EmailScanItem {
  from: string
  fromName: string | null
  subject: string
  type: string
  confidence: number
  action: string
  accountEmail: string
}

export interface ScanResult {
  scanned: number
  accounts: number
  results: EmailScanItem[]
}

const EMAIL_TYPES: EmailType[] = [
  'lead_inquiry',
  'support_request',
  'complaint',
  'quote_request',
  'meeting_request',
  'invoice_payment',
  'job_application',
  'supplier_vendor',
  'spam_promotion',
  'legal_contract',
  'internal_team',
  'newsletter',
  'urgent_issue',
]

const DEFAULT_RULES: Array<{ emailType: EmailType; mode: string; confidenceThreshold: number }> = [
  { emailType: 'lead_inquiry',    mode: 'approval_required', confidenceThreshold: 75 },
  { emailType: 'quote_request',   mode: 'approval_required', confidenceThreshold: 75 },
  { emailType: 'support_request', mode: 'notify_only',       confidenceThreshold: 70 },
  { emailType: 'complaint',       mode: 'approval_required', confidenceThreshold: 80 },
  { emailType: 'meeting_request', mode: 'notify_only',       confidenceThreshold: 75 },
  { emailType: 'invoice_payment', mode: 'notify_only',       confidenceThreshold: 80 },
  { emailType: 'job_application', mode: 'notify_only',       confidenceThreshold: 70 },
  { emailType: 'supplier_vendor', mode: 'notify_only',       confidenceThreshold: 70 },
  { emailType: 'spam_promotion',  mode: 'block',             confidenceThreshold: 80 },
  { emailType: 'legal_contract',  mode: 'notify_only',       confidenceThreshold: 85 },
  { emailType: 'internal_team',   mode: 'block',             confidenceThreshold: 95 },
  { emailType: 'newsletter',      mode: 'block',             confidenceThreshold: 85 },
  { emailType: 'urgent_issue',    mode: 'approval_required', confidenceThreshold: 75 },
]

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AIService,
    private readonly chat: ChatService,
    private readonly email: EmailService,
  ) {}

  // ─────────────────────────────────────────────
  // GOOGLE OAUTH
  // ─────────────────────────────────────────────

  getGoogleOAuthClient(): OAuth2Client {
    return new OAuth2Client(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URI'),
    )
  }

  getGoogleAuthUrl(tenantId: string): string {
    const oauth2 = this.getGoogleOAuthClient()
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      state: tenantId,
    })
  }

  async handleGoogleCallback(code: string, tenantId: string): Promise<void> {
    const oauth2 = this.getGoogleOAuthClient()
    const { tokens } = await oauth2.getToken(code)
    oauth2.setCredentials(tokens)

    // Get account email
    const { google } = await import('googleapis')
      const people = google.oauth2({ version: 'v2', auth: oauth2 as any })
    const info = await people.userinfo.get()
    const accountEmail = info.data.email ?? ''
    const accountName = info.data.name ?? ''

    if (!accountEmail) throw new BadRequestException('Could not get email from Google account')

    const encryptedAccessToken = encrypt(tokens.access_token!)
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined

    // Upsert connected account
    await this.prisma.connectedAccount.upsert({
      where: { tenantId_provider_accountEmail: { tenantId, provider: 'google', accountEmail } },
      create: {
        tenantId,
        provider: 'google',
        accountEmail,
        accountName,
        encryptedAccessToken,
        encryptedRefreshToken: encryptedRefreshToken ?? '',
        scopes: tokens.scope?.split(' ') ?? [],
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        status: 'active',
      },
      update: {
        accountName,
        encryptedAccessToken,
        ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        scopes: tokens.scope?.split(' ') ?? [],
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        status: 'active',
      },
    })

    // Create default email rules if not exists
    await this.seedDefaultRules(tenantId)

    this.logger.log(`Google account connected for tenant ${tenantId}: ${accountEmail}`)
  }

  async disconnectGoogleAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: 'google' },
    })
    if (!account) throw new NotFoundException('Account not found')
    await this.prisma.connectedAccount.delete({ where: { id: accountId } })
  }

  async getConnectedAccounts(tenantId: string) {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return accounts.map(a => ({
      id: a.id,
      provider: a.provider,
      accountEmail: a.accountEmail,
      accountName: a.accountName,
      status: a.status,
      scopes: a.scopes,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    }))
  }

  // ─────────────────────────────────────────────
  // IMAP — ANY EMAIL PROVIDER
  // ─────────────────────────────────────────────

  async testImapConnection(config: ImapConfig): Promise<{ success: boolean; error?: string }> {
    const adapter = new ImapAdapter(config)
    return adapter.testConnection()
  }

  async connectImapAccount(tenantId: string, data: {
    accountEmail: string
    accountName?: string
    imapHost: string
    imapPort: number
    imapSecure: boolean
    password: string
    smtpHost?: string
    smtpPort?: number
    smtpSecure?: boolean
    smtpUser?: string
    smtpPassword?: string
    smtpFromName?: string
  }): Promise<void> {
    // Test IMAP connection first
    const adapter = new ImapAdapter({
      host: data.imapHost,
      port: data.imapPort,
      secure: data.imapSecure,
      user: data.accountEmail,
      password: data.password,
    })
    const test = await adapter.testConnection()
    if (!test.success) {
      const reason = test.error || 'Connection refused or timed out — check host, port, and SSL setting'
      throw new BadRequestException(`IMAP connection failed: ${reason}`)
    }

    const encryptedAccessToken = encrypt(data.password)

    // Encrypt SMTP password separately (may differ from IMAP password)
    const smtpPass = data.smtpPassword || data.password
    const encryptedSmtpPassword = encrypt(smtpPass)

    const metadata = {
      imapHost: data.imapHost,
      imapPort: data.imapPort,
      imapSecure: data.imapSecure,
      // SMTP (outgoing) — stored encrypted separately
      smtpHost: data.smtpHost || data.imapHost.replace('imap.', 'send.').replace('mail.', 'smtp.'),
      smtpPort: data.smtpPort ?? 587,
      smtpSecure: data.smtpSecure ?? false,
      smtpUser: data.smtpUser || data.accountEmail,
      smtpFromName: data.smtpFromName || data.accountName || data.accountEmail,
      encryptedSmtpPassword,
    }

    await this.prisma.connectedAccount.upsert({
      where: {
        tenantId_provider_accountEmail: {
          tenantId,
          provider: 'imap',
          accountEmail: data.accountEmail,
        },
      },
      create: {
        tenantId,
        provider: 'imap',
        accountEmail: data.accountEmail,
        accountName: data.accountName || data.accountEmail,
        encryptedAccessToken,
        scopes: ['imap', 'smtp'],
        status: 'active',
        metadata,
      },
      update: {
        accountName: data.accountName || data.accountEmail,
        encryptedAccessToken,
        status: 'active',
        metadata,
      },
    })

    // Seed default email rules
    await this.seedDefaultRules(tenantId)
    this.logger.log(`IMAP+SMTP account connected for tenant ${tenantId}: ${data.accountEmail}`)
  }

  // ─────────────────────────────────────────────
  // EMAIL RULES
  // ─────────────────────────────────────────────

  private async seedDefaultRules(tenantId: string): Promise<void> {
    for (const rule of DEFAULT_RULES) {
      await this.prisma.emailAgentRule.upsert({
        where: { tenantId_emailType: { tenantId, emailType: rule.emailType } },
        create: { tenantId, ...rule, isActive: true },
        update: {},
      })
    }
  }

  async getEmailRules(tenantId: string) {
    // Ensure rules exist
    await this.seedDefaultRules(tenantId)
    return this.prisma.emailAgentRule.findMany({
      where: { tenantId },
      orderBy: { emailType: 'asc' },
      include: {
        assignedAgent: { select: { id: true, name: true, role: true, avatar: true } },
      },
    })
  }

  async getAgentsForTenant(tenantId: string) {
    return this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, role: true, avatar: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async updateEmailRule(tenantId: string, emailType: string, data: {
    mode?: string
    replyTemplate?: string
    confidenceThreshold?: number
    isActive?: boolean
    assignedAgentId?: string | null
  }) {
    return this.prisma.emailAgentRule.upsert({
      where: { tenantId_emailType: { tenantId, emailType } },
      create: {
        tenantId,
        emailType,
        mode: data.mode ?? 'notify_only',
        replyTemplate: data.replyTemplate,
        confidenceThreshold: data.confidenceThreshold ?? 75,
        isActive: data.isActive ?? true,
      },
      update: data,
    })
  }

  // ─────────────────────────────────────────────
  // EMAIL SCANNER (called by scheduler)
  // ─────────────────────────────────────────────

  async scanEmailsForTenant(tenantId: string): Promise<ScanResult> {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { tenantId, status: 'active' },
    })

    const results: EmailScanItem[] = []

    for (const account of accounts) {
      if (account.provider === 'google') {
        const items = await this.processAccountEmails(tenantId, account)
        results.push(...items)
      } else if (account.provider === 'imap') {
        const items = await this.processImapAccountEmails(tenantId, account)
        results.push(...items)
      }
    }

    return {
      scanned: results.length,
      results,
      accounts: accounts.length,
    }
  }

  private async processAccountEmails(tenantId: string, account: any): Promise<EmailScanItem[]> {
    const items: EmailScanItem[] = []
    try {
      const oauth2 = this.getGoogleOAuthClient()
      const accessToken = decrypt(account.encryptedAccessToken)
      const refreshToken = account.encryptedRefreshToken ? decrypt(account.encryptedRefreshToken) : undefined

      oauth2.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: account.expiresAt?.getTime(),
      })

      // Auto-refresh token
      oauth2.on('tokens', async (tokens) => {
        if (tokens.access_token) {
          await this.prisma.connectedAccount.update({
            where: { id: account.id },
            data: {
              encryptedAccessToken: encrypt(tokens.access_token),
              ...(tokens.refresh_token ? { encryptedRefreshToken: encrypt(tokens.refresh_token) } : {}),
              expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
            },
          })
        }
      })

      const gmail = new GmailAdapter(oauth2)
      const emails = await gmail.listUnread(30)

      const rules = await this.prisma.emailAgentRule.findMany({ where: { tenantId, isActive: true } })

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { users: { where: { role: { in: ['TENANT_OWNER', 'TENANT_ADMIN'] } } } },
      })
      const brainSettings = (tenant?.settings as any)?.brain ?? {}
      const companyContext = `${brainSettings.companyName ?? ''} — ${brainSettings.description ?? brainSettings.tagline ?? ''}`
      const staffEmails = tenant?.users.map(u => u.email) ?? []

      const classifier = new EmailClassifier(this.ai)

      for (const email of emails) {
        // Skip already processed
        const exists = await this.prisma.processedEmail.findUnique({
          where: { connectedAccountId_gmailMessageId: { connectedAccountId: account.id, gmailMessageId: email.id } },
        })
        if (exists) continue

        const classification = await classifier.classify(email, staffEmails, companyContext)

        const rule = rules.find(r => r.emailType === classification.type)
        const mode = rule?.mode ?? 'notify_only'
        const threshold = rule?.confidenceThreshold ?? 70

        // Low confidence → notify only, don't auto-act
        const effectiveMode = classification.confidence >= threshold ? mode : 'notify_only'

        // ── Confirmation loop: check if this email is a customer reply to an AWAITING_CUSTOMER ticket ──
        let confirmationHandled = false
        try {
          confirmationHandled = await this.handleCustomerConfirmation(tenantId, email, classification)
        } catch (err: any) {
          this.logger.warn(`[Confirmation] Failed for ${email.from}: ${err.message}`)
        }

        let action: string | null = confirmationHandled ? 'confirmation_auto_updated' : null
        let errorMessage: string | null = null

        if (!confirmationHandled) {
          try {
            action = await this.executeEmailAction(
              tenantId,
              account,
              gmail,
              email,
              classification,
              effectiveMode,
              rule?.replyTemplate ?? null,
              rule?.assignedAgentId ?? null,
            )
          } catch (err: any) {
            errorMessage = err.message
          }
        }

        await this.prisma.processedEmail.create({
          data: {
            tenantId,
            connectedAccountId: account.id,
            gmailMessageId: email.id,
            threadId: email.threadId,
            fromEmail: email.from,
            fromName: email.fromName,
            subject: email.subject,
            receivedAt: email.receivedAt,
            classification: classification.type,
            confidence: classification.confidence,
            extractedData: classification.extractedData as any,
            action: action ?? 'skipped',
            status: errorMessage ? 'failed' : 'actioned',
            errorMessage,
          },
        })

        items.push({
          from: email.from,
          fromName: email.fromName ?? null,
          subject: email.subject ?? '(no subject)',
          type: classification.type,
          confidence: classification.confidence,
          action: action ?? 'skipped',
          accountEmail: account.accountEmail,
        })

        this.logger.log(`[${tenantId}] ${email.from} → ${classification.type} (${classification.confidence}%) → ${action}`)
      }
    } catch (err: any) {
      this.logger.error(`processAccountEmails failed for ${account.accountEmail}: ${err.message}`)
      if (err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
        await this.prisma.connectedAccount.update({
          where: { id: account.id },
          data: { status: 'expired' },
        })
      }
    }
    return items
  }

  private async processImapAccountEmails(tenantId: string, account: any): Promise<EmailScanItem[]> {
    try {
      const meta = account.metadata as any
      const password = decrypt(account.encryptedAccessToken)

      const imapConfig: ImapConfig = {
        host: meta.imapHost,
        port: meta.imapPort,
        secure: meta.imapSecure,
        user: account.accountEmail,
        password,
      }

      const imap = new ImapAdapter(imapConfig)
      const emails = await imap.listUnread(30)

      const items: EmailScanItem[] = []

      if (!emails.length) {
        this.logger.log(`[IMAP][${tenantId}] No new unread emails for ${account.accountEmail}`)
        return items
      }

      // Build per-account mailer if SMTP is configured
      let mailer: AccountMailer | null = null
      if (meta.smtpHost && meta.encryptedSmtpPassword) {
        mailer = AccountMailer.fromAccountMetadata(meta, account.accountEmail)
      }

      const rules = await this.prisma.emailAgentRule.findMany({ where: { tenantId, isActive: true } })
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { users: { where: { role: { in: ['TENANT_OWNER', 'TENANT_ADMIN'] } } } },
      })
      const brainSettings = (tenant?.settings as any)?.brain ?? {}
      const companyContext = `${brainSettings.companyName ?? ''} — ${brainSettings.description ?? brainSettings.tagline ?? ''}`
      const staffEmails = tenant?.users.map(u => u.email) ?? []
      const classifier = new EmailClassifier(this.ai)

      for (const email of emails) {
        const exists = await this.prisma.processedEmail.findUnique({
          where: { connectedAccountId_gmailMessageId: { connectedAccountId: account.id, gmailMessageId: email.id } },
        })
        if (exists) continue

        const classification = await classifier.classify(email, staffEmails, companyContext)
        const rule = rules.find(r => r.emailType === classification.type)
        const mode = rule?.mode ?? 'notify_only'
        const threshold = rule?.confidenceThreshold ?? 70
        const effectiveMode = classification.confidence >= threshold ? mode : 'notify_only'

        // ── Confirmation loop: check if this email is a customer reply to an AWAITING_CUSTOMER ticket ──
        let confirmationHandled = false
        try {
          confirmationHandled = await this.handleCustomerConfirmation(tenantId, email, classification)
        } catch (err: any) {
          this.logger.warn(`[Confirmation][IMAP] Failed for ${email.from}: ${err.message}`)
        }

        let action: string | null = confirmationHandled ? 'confirmation_auto_updated' : null
        let errorMessage: string | null = null

        if (!confirmationHandled) {
          try {
            action = await this.executeImapEmailAction(
              tenantId,
              imap,
              mailer,
              email,
              classification,
              effectiveMode,
              rule?.replyTemplate ?? null,
              account.accountEmail,
              rule?.assignedAgentId ?? null,
            )
          } catch (err: any) {
            errorMessage = err.message
            this.logger.error(`Action failed for ${email.from}: ${err.message}`)
          }
        }

        await this.prisma.processedEmail.create({
          data: {
            tenantId,
            connectedAccountId: account.id,
            gmailMessageId: email.id,
            threadId: email.threadId,
            fromEmail: email.from,
            fromName: email.fromName,
            subject: email.subject,
            receivedAt: email.receivedAt,
            classification: classification.type,
            confidence: classification.confidence,
            extractedData: classification.extractedData as any,
            action: action ?? 'skipped',
            status: errorMessage ? 'failed' : 'actioned',
            errorMessage,
          },
        })

        items.push({
          from: email.from,
          fromName: email.fromName ?? null,
          subject: email.subject ?? '(no subject)',
          type: classification.type,
          confidence: classification.confidence,
          action: action ?? 'skipped',
          accountEmail: account.accountEmail,
        })

        this.logger.log(`[IMAP][${tenantId}] ${email.from} → ${classification.type} (${classification.confidence}%) → ${action}`)
      }
      return items
    } catch (err: any) {
      this.logger.error(`processImapAccountEmails failed for ${account.accountEmail}: ${err.message}`)
      if (err.message?.includes('Authentication') || err.message?.includes('Invalid credentials')) {
        await this.prisma.connectedAccount.update({
          where: { id: account.id },
          data: { status: 'expired' },
        })
      }
      return []
    }
  }

  private async executeImapEmailAction(
    tenantId: string,
    imap: ImapAdapter,
    mailer: AccountMailer | null,
    email: any,
    classification: any,
    mode: string,
    replyTemplate: string | null,
    fromEmail: string,
    assignedAgentId?: string | null,
  ): Promise<string> {
    switch (mode) {
      case 'block':
        await imap.markAsRead(email.id)
        return 'archived'

      case 'auto_reply': {
        if (!mailer) {
          await this.notifyAgentOfEmail(tenantId, email, classification,
            '⚠️ Auto-reply skipped — SMTP not configured for this account.')
          return 'notified'
        }
        const replyBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId)
        await mailer.sendReply({
          to: email.from,
          subject: email.subject,
          html: replyBody,
          inReplyTo: email.threadId,
        })
        await imap.markAsRead(email.id)
        await this.notifyAgentOfEmail(tenantId, email, classification,
          `✅ Auto-reply sent from ${fromEmail}`)
        return 'replied'
      }

      case 'auto_draft': {
        const draftBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId)

        // Save draft directly to Drafts folder via IMAP APPEND
        const saved = await imap.saveDraft(email.from, email.subject, draftBody, email.threadId)
        await imap.markAsRead(email.id)

        if (saved) {
          await this.notifyAgentOfEmail(tenantId, email, classification,
            `📝 **Draft saved to your Drafts folder** — open your email client to review and send.`)
        } else {
          // Fallback — email the draft to the account owner for review
          if (mailer) {
            await mailer.sendReply({
              to: fromEmail, // send draft to self for review
              subject: `[DRAFT FOR REVIEW] Re: ${email.subject}`,
              html: `<p><strong>📝 Review this draft before sending to ${email.from}:</strong></p><hr>${draftBody}`,
            })
            await this.notifyAgentOfEmail(tenantId, email, classification,
              `📝 **Draft emailed to you** (${fromEmail}) for review — check your inbox.`)
          } else {
            await this.notifyAgentOfEmail(tenantId, email, classification,
              `📝 Draft prepared — to send reply, say: "reply to ${email.fromName || email.from}: your message"`)
          }
        }
        return 'drafted'
      }

      case 'approval_required': {
        await this.notifyAgentOfEmail(tenantId, email, classification,
          `⚠️ **Needs your reply** — To respond, say: "reply to ${email.fromName || email.from}: your message here"`)
        await imap.markAsRead(email.id)
        return 'flagged'
      }

      default: {
        // notify_only
        await this.notifyAgentOfEmail(tenantId, email, classification)
        await imap.markAsRead(email.id)
        return 'notified'
      }
    }
  }

  private async executeEmailAction(
    tenantId: string,
    account: any,
    gmail: GmailAdapter,
    email: any,
    classification: any,
    mode: string,
    replyTemplate: string | null,
    assignedAgentId?: string | null,
  ): Promise<string> {
    switch (mode) {
      case 'block':
        // Archive/skip silently
        await gmail.markAsRead(email.id)
        return 'archived'

      case 'notify_only': {
        await this.notifyAgentOfEmail(tenantId, email, classification)
        await gmail.markAsRead(email.id)
        return 'notified'
      }

      case 'auto_draft': {
        const replyBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId)

        const draftId = await gmail.createDraft(email.from, `Re: ${email.subject}`, replyBody, email.threadId)
        await this.notifyAgentOfEmail(tenantId, email, classification, `📝 Draft reply created (Draft ID: ${draftId})`)
        await gmail.markAsRead(email.id)
        return 'drafted'
      }

      case 'approval_required': {
        await this.notifyAgentOfEmail(tenantId, email, classification, '⚠️ Requires your review/approval before replying.')
        await gmail.markAsRead(email.id)
        return 'flagged'
      }

      default:
        await this.notifyAgentOfEmail(tenantId, email, classification)
        return 'notified'
    }
  }

  /**
   * Customer Confirmation Loop
   *
   * When an inbound email arrives:
   *  1. Match the sender's email address to an open AWAITING_CUSTOMER ticket.
   *  2. Scan the body for confirmation keywords.
   *  3. If confirmed → flip ticket to OPEN (or SCHEDULED if a date is detected),
   *     append an activityLog entry, and wake the assigned agent with a briefing.
   *
   * Returns true if a confirmation was handled (caller skips normal action routing).
   */
  private async handleCustomerConfirmation(
    tenantId: string,
    email: any,
    classification: any,
  ): Promise<boolean> {
    const senderEmail: string = (email.from ?? '').toLowerCase().trim()
    if (!senderEmail) return false

    // Find an AWAITING_CUSTOMER ticket where contactEmail matches sender
    const ticket = await this.prisma.activityTicket.findFirst({
      where: {
        tenantId,
        status: 'AWAITING_CUSTOMER',
        contactEmail: { equals: senderEmail, mode: 'insensitive' },
      },
      include: {
        assignedAgent: { select: { id: true, name: true } },
        tenant: { select: { name: true, settings: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!ticket) return false

    const stageIndex: number = (ticket.metadata as any)?.pipelineStageIndex ?? -1

    // AI-based intent analysis
    const aiIntent = await this.analyseReplyIntent(email, ticket).catch(() => null)
    const isNegative     = aiIntent?.intent === 'not_interested' || aiIntent?.intent === 'declined'
    const isConfirmation = aiIntent?.intent === 'confirmed'

    let followUpAt: Date | null = null
    if (isConfirmation && aiIntent?.confirmedDate) {
      const parsed = new Date(aiIntent.confirmedDate)
      if (!isNaN(parsed.getTime())) followUpAt = parsed
    }
    const intentSummary = aiIntent?.summary ?? `Customer replied — review needed`
    const tenantName = (ticket.tenant as any)?.settings?.brain?.companyName || (ticket.tenant as any)?.name || 'us'
    const customerName = ticket.contactRef || 'there'

    // ─────────────────────────────────────────────────────────────────
    // STATUS LOGIC
    //
    // Rule: the system NEVER auto-advances pipeline stages based on
    // intent alone. The assigned agent (Charlie, Hanna, etc.) decides
    // when a stage is complete by calling update_ticket(COMPLETED).
    //
    // The system only:
    //   - Re-opens the ticket so the agent can continue the conversation
    //   - Sends a confirmation email when a specific date is locked in
    //   - Marks SCHEDULED only when a confirmed date is detected
    //   - Marks AWAITING_CUSTOMER for negative/declined replies
    // ─────────────────────────────────────────────────────────────────
    let newStatus: string
    let newNextAction: string

    if (isNegative) {
      // Customer declined — keep status as AWAITING_CUSTOMER so agent can decide next step
      newStatus = 'AWAITING_CUSTOMER'
      newNextAction = `${intentSummary} — customer declined. Review and decide whether to follow up.`
    } else if (followUpAt) {
      // Specific inspection date confirmed — mark SCHEDULED, send confirmation email
      newStatus = 'SCHEDULED'
      newNextAction = `Inspection confirmed for ${followUpAt.toLocaleDateString('en-GB')} — send customer a confirmation email, then call update_ticket(COMPLETED) when done.`
    } else {
      // Customer replied (interested, question, clarification, etc.) — re-open for agent
      // The agent reads the reply, responds, continues conversation until THEY mark COMPLETED
      newStatus = 'OPEN'
      newNextAction = `Customer replied: "${intentSummary}". Read their message and respond via contact_customer(contactEmail: "${senderEmail}", contactName: "${customerName}"). Answer any questions. When the customer is fully qualified and confirmed, call update_ticket(COMPLETED) to advance the pipeline.`
    }

    const log = (ticket.activityLog as any[]) ?? []
    const now = new Date()

    await this.prisma.activityTicket.update({
      where: { id: ticket.id },
      data: {
        status: newStatus as any,
        followUpAt: followUpAt ?? null,
        updatedAt: now,
        nextAction: newNextAction,
        activityLog: [
          ...log,
          {
            agentName: 'System',
            agentId: 'system',
            action: 'CUSTOMER_REPLIED',
            note: `Reply from ${senderEmail}. AI intent: "${intentSummary}". Stage ${stageIndex} → ${newStatus}.`,
            timestamp: now.toISOString(),
          },
        ] as any,
      },
    })

    this.logger.log(`[Confirmation] Ticket #${String(ticket.ticketNumber).padStart(4,'0')} → ${newStatus} (stage ${stageIndex}) — intent: "${aiIntent?.intent ?? 'unknown'}"`)

    // Send confirmation email to customer when a specific date is locked in
    if (followUpAt && senderEmail) {
      const confirmDate = followUpAt.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      this.email.send({
        tenantId,
        to: senderEmail,
        subject: `Inspection Confirmed — ${tenantName}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <p>Hi ${customerName},</p>
          <p>Your roof inspection has been confirmed for <strong>${confirmDate}</strong>.</p>
          <p>Our specialist will be in touch shortly with further details. If you need to reschedule, please reply to this email.</p>
          <p style="color:#64748b;font-size:13px;margin-top:24px;">— ${tenantName}</p>
        </div>`,
        text: `Hi ${customerName},\n\nYour roof inspection has been confirmed for ${confirmDate}.\n\nOur specialist will be in touch shortly with further details.\n\n— ${tenantName}`,
      }).catch(e => this.logger.warn(`[Confirmation] Confirmation email failed: ${e.message}`))
    }

    // Wake the assigned agent with full context so they can continue the conversation
    if (ticket.assignedAgent) {
      const ticketNum = String(ticket.ticketNumber).padStart(4, '0')

      const briefing = isNegative ? [
        `Customer declined — Ticket #${ticketNum}`,
        `From: ${customerName} <${senderEmail}>`,
        `Their message: "${email.snippet}"`,
        ``,
        `The customer is not interested. You may attempt one gentle follow-up or close the ticket.`,
        `Call update_ticket(ticketId: "${ticket.id.slice(-6)}", status: "COMPLETED") to close.`,
      ].join('\n') : followUpAt ? [
        `Inspection date confirmed — Ticket #${ticketNum}`,
        `From: ${customerName} <${senderEmail}>`,
        `Confirmed date: ${followUpAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
        `Their message: "${email.snippet}"`,
        ``,
        `✅ A confirmation email has already been sent to the customer.`,
        `✅ The ticket is now SCHEDULED with followUpAt = ${followUpAt.toISOString().split('T')[0]}.`,
        ``,
        `IMPORTANT: Do NOT call update_ticket(COMPLETED). The system will automatically advance to the next stage on the inspection date (${followUpAt.toLocaleDateString('en-GB')}).`,
        `Your job is done for now — just add a note if needed: call update_ticket(ticketId: "${ticket.id.slice(-6)}", status: "SCHEDULED", note: "Inspection confirmed for ${followUpAt.toLocaleDateString('en-GB')}")`,
      ].join('\n') : [
        `Customer replied to your outreach — Ticket #${ticketNum}`,
        `From: ${customerName} <${senderEmail}>`,
        `Their message: "${email.snippet}"`,
        `AI summary: ${intentSummary}`,
        ``,
        `TASK: The customer has a question or needs more information. Reply to them now:`,
        `Call contact_customer with:`,
        `{`,
        `  "contactEmail": "${senderEmail}",`,
        `  "contactName": "${customerName}",`,
        `  "subject": "Re: Your Roof Inspection — ${tenantName}",`,
        `  "message": "<answer their question, explain the inspection booking process, propose dates>"`,
        `}`,
        ``,
        `Continue the conversation until the customer is fully qualified (confirmed interest + ready to proceed).`,
        `Only when the conversation is COMPLETE, call update_ticket(ticketId: "${ticket.id.slice(-6)}", status: "COMPLETED") — this will automatically advance to the next stage.`,
        `DO NOT call update_ticket(COMPLETED) yet — the customer still has unanswered questions.`,
      ].join('\n')

      setImmediate(() => {
        this.chat.autoWakeAgent(
          tenantId,
          ticket.assignedAgent!.id,
          ticket.id,
          briefing,
          ticket.assignedAgent!.id,
          ticket.conversationId ?? undefined,
        ).catch(e => this.logger.warn(`[Confirmation] Wake failed: ${e.message}`))
      })
    }

    return true
  }

  /**
   * AI-powered reply intent analysis.
   * Understands the full range of customer responses — interest, questions,
   * confirmed dates, reschedule requests, or declines — so the assigned
   * agent gets a clear, actionable summary rather than a binary flag.
   */
  private async analyseReplyIntent(
    email: any,
    ticket: any,
  ): Promise<{
    intent: 'confirmed' | 'interested' | 'needs_clarification' | 'reschedule' | 'not_interested' | 'declined' | 'other'
    confirmedDate: string | null
    summary: string
  }> {
    const systemPrompt = `You are analysing a customer's email reply in the context of a roofing/insurance pipeline.
The customer was contacted about a free roof inspection.

Return ONLY valid JSON — no markdown, no explanation:
{
  "intent": "interested",
  "confirmedDate": null,
  "summary": "Customer is interested and asked how to book the inspection"
}

intent values (pick the single best match):
- "confirmed"           → customer explicitly agrees to a specific inspection date/time
- "interested"          → customer is interested but has NOT yet confirmed a specific date (asking questions, saying yes in general, etc.)
- "needs_clarification" → customer needs more info before deciding (cost, process, what's involved)
- "reschedule"          → customer wants to change an already agreed date
- "not_interested"      → customer does not want the inspection right now
- "declined"            → customer explicitly refuses / says no / asks to stop contact
- "other"               → unrelated, automated, or unclear

confirmedDate: ISO date string (YYYY-MM-DD) ONLY if customer confirmed a SPECIFIC date. Otherwise null.
summary: one concise sentence describing exactly what the customer said/asked.`

    const stageIndex = (ticket.metadata as any)?.pipelineStageIndex ?? -1
    const stageContext = stageIndex === 0
      ? 'This is Stage 0 (Lead Qualification). We sent an initial outreach email about a free roof inspection.'
      : `This is Stage ${stageIndex + 1}. We sent a follow-up about scheduling/confirming an inspection.`

    const userPrompt = `${stageContext}
Ticket: "${ticket.title}"
Customer email (from: ${email.from}):
Subject: ${email.subject || '(no subject)'}
Body: ${(email.body ?? email.snippet ?? '').slice(0, 1200)}`

    const raw = await this.ai.chat(systemPrompt, [{ role: 'user', content: userPrompt }])
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON returned')
    const result = JSON.parse(jsonMatch[0])
    return {
      intent: result.intent ?? 'other',
      confirmedDate: result.confirmedDate ?? null,
      summary: result.summary ?? '',
    }
  }

  private async notifyAgentOfEmail(
    tenantId: string,
    email: any,
    classification: any,
    extraNote?: string,
  ): Promise<void> {
    try {
      const icon = this.getEmailTypeIcon(classification.type)
      const ex = classification.extractedData ?? {}

      const lines = [
        `${icon} **Email Received** — ${classification.type.replace(/_/g, ' ').toUpperCase()}`,
        `📧 **From:** ${email.fromName || email.from} <${email.from}>`,
        `📌 **Subject:** ${email.subject || '(no subject)'}`,
        `🎯 **Type:** ${classification.type} (${classification.confidence}% confidence)`,
        `💬 **Summary:** ${email.snippet}`,
      ]

      if (ex.service)     lines.push(`🔧 **Service Requested:** ${ex.service}`)
      if (ex.location)    lines.push(`📍 **Location:** ${ex.location}`)
      if (ex.urgency)     lines.push(`⏰ **Urgency:** ${ex.urgency}`)
      if (ex.phone)       lines.push(`📞 **Phone:** ${ex.phone}`)
      if (ex.budget)      lines.push(`💰 **Budget:** ${ex.budget}`)
      if (ex.meetingDate) lines.push(`📅 **Meeting Date:** ${ex.meetingDate}`)
      if (extraNote)      lines.push(`\n${extraNote}`)

      const briefing = lines.join('\n')
      await this.chat.postEmailBriefing(tenantId, briefing)
    } catch (err: any) {
      this.logger.warn(`notifyAgentOfEmail failed: ${err.message}`)
    }
  }

  private getEmailTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      lead_inquiry:    '🌟',
      support_request: '🛠️',
      complaint:       '⚠️',
      quote_request:   '💰',
      meeting_request: '📅',
      invoice_payment: '🧾',
      job_application: '👤',
      supplier_vendor: '🏭',
      spam_promotion:  '🚫',
      legal_contract:  '⚖️',
      internal_team:   '👥',
      newsletter:      '📰',
      urgent_issue:    '🚨',
    }
    return icons[type] ?? '📧'
  }

  private fillTemplate(template: string, email: any, classification: any): string {
    return template
      .replace('{{name}}', email.fromName || email.from)
      .replace('{{service}}', classification.extractedData?.service || 'your request')
      .replace('{{subject}}', email.subject || '')
  }

  private async generateEmailReply(
    email: any,
    classification: any,
    tenantId: string,
    agentId?: string | null,
  ): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const brain = (tenant?.settings as any)?.brain ?? {}
    const companyName = brain.companyName || 'our company'

    // Load assigned agent persona (with fallback to first active agent)
    let agentName = 'The Team'
    let agentPersona = ''
    try {
      const agent = agentId
        ? await this.prisma.agent.findUnique({ where: { id: agentId } })
        : await this.prisma.agent.findFirst({ where: { tenantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })

      if (agent) {
        agentName = agent.name
        agentPersona = `You are ${agent.name}, ${agent.role} at ${companyName}.\n${agent.prompt?.slice(0, 600)}\n\n`
      }
    } catch (err: any) {
      this.logger.warn(`generateEmailReply: could not load agent — ${err.message}`)
    }

    // CRM context lookup (best-effort, non-blocking)
    let crmContext = ''
    try {
      const result = await Promise.race([
        this.lookupCrmContext(tenantId, email.from),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ])
      if (result) crmContext = `\nCRM Context: ${result}\n`
    } catch {
      // CRM lookup failed or timed out — continue without it
    }

    const prompt = `${agentPersona}Write a professional, friendly email reply on behalf of ${companyName}.
Email type: ${classification.type.replace(/_/g, ' ')}
From: ${email.fromName || email.from} <${email.from}>
Subject: ${email.subject}
Their message: ${email.body?.slice(0, 800)}
${crmContext}
Instructions:
- Reply naturally as ${agentName} from ${companyName}
- Be concise and helpful (3-5 sentences max unless more detail is needed)
- Address their specific question or need
- Sign off as "${agentName}, ${companyName}"
- Format as clean HTML (use <p> tags, no complex layout)`

    return this.ai.chat(prompt, [])
  }

  private async lookupCrmContext(_tenantId: string, _senderEmail: string): Promise<string> {
    // CRM lookup via external API — placeholder for future integration.
    // When a CRM connection is configured, this will query leads/contacts by email.
    return ''
  }

  // ─────────────────────────────────────────────
  // PROCESSED EMAILS HISTORY
  // ─────────────────────────────────────────────

  async getProcessedEmails(tenantId: string, limit = 50, offset = 0): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
    const [items, total] = await Promise.all([
      this.prisma.processedEmail.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { connectedAccount: { select: { accountEmail: true, provider: true } } },
      }),
      this.prisma.processedEmail.count({ where: { tenantId } }),
    ])
    return { items, total, limit, offset }
  }
}
