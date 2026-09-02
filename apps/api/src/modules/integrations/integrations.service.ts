import { createHmac } from 'crypto'
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
import { AutonomyService } from '../../common/autonomy/autonomy.service'

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
  /** Emails fetched from inbox before dedup */
  fetched?: number
  /** Emails skipped because already in ProcessedEmail */
  skipped?: number
  /** Per-account fetch/process errors surfaced to the UI */
  errors?: string[]
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

/** Strip null bytes (\u0000) that Postgres rejects in text/jsonb columns */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\u0000/g, '')
  if (value instanceof Date) return value           // preserve Date objects
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v)]))
  }
  return value
}

function sanitizeRecord<T extends Record<string, unknown>>(rec: T): T {
  return sanitize(rec) as T
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ai: AIService,
    private readonly chat: ChatService,
    private readonly email: EmailService,
    private readonly autonomy: AutonomyService,
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

  private buildOAuthState(tenantId: string): string {
    const nonce = Date.now().toString()
    const secret = this.config.get<string>('JWT_SECRET') ?? 'changeme'
    const sig = createHmac('sha256', secret).update(`${tenantId}:${nonce}`).digest('hex')
    return Buffer.from(JSON.stringify({ tenantId, nonce, sig })).toString('base64url')
  }

  private verifyOAuthState(rawState: string): string {
    let parsed: { tenantId: string; nonce: string; sig: string }
    try {
      parsed = JSON.parse(Buffer.from(rawState, 'base64url').toString())
    } catch {
      throw new BadRequestException('Invalid OAuth state parameter')
    }
    const secret = this.config.get<string>('JWT_SECRET') ?? 'changeme'
    const expected = createHmac('sha256', secret).update(`${parsed.tenantId}:${parsed.nonce}`).digest('hex')
    if (parsed.sig !== expected) throw new BadRequestException('OAuth state signature mismatch')
    // Reject states older than 15 minutes to prevent replay
    if (Date.now() - parseInt(parsed.nonce) > 15 * 60 * 1000) {
      throw new BadRequestException('OAuth state has expired — please try connecting again')
    }
    return parsed.tenantId
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
      state: this.buildOAuthState(tenantId),
    })
  }

  async handleGoogleCallback(code: string, rawState: string): Promise<void> {
    const tenantId = this.verifyOAuthState(rawState)
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
    const googleAccount = await this.prisma.connectedAccount.upsert({
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

    // Create default email rules for this account
    await this.seedDefaultRules(tenantId, googleAccount.id)

    this.logger.log(`Google account connected for tenant ${tenantId}: ${accountEmail}`)
  }

  // ─────────────────────────────────────────────
  // MICROSOFT / OFFICE 365 OAUTH
  // ─────────────────────────────────────────────

  private get msftTenant(): string {
    return this.config.get<string>('MICROSOFT_TENANT_ID') || 'common'
  }

  getMicrosoftAuthUrl(tenantId: string): string {
    const params = new URLSearchParams({
      client_id:     this.config.get('MICROSOFT_CLIENT_ID')!,
      response_type: 'code',
      redirect_uri:  this.config.get('MICROSOFT_REDIRECT_URI')!,
      // openid + email + profile give us id_token claims (email, preferred_username, name)
      // without needing a separate Graph API call
      scope: [
        'openid',
        'email',
        'profile',
        'offline_access',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://outlook.office.com/SMTP.Send',
      ].join(' '),
      response_mode: 'query',
      state: this.buildOAuthState(tenantId),
    })
    return `https://login.microsoftonline.com/${this.msftTenant}/oauth2/v2.0/authorize?${params}`
  }

  /** Decode a JWT payload without verifying signature (claims are trusted from Microsoft). */
  private decodeJwtPayload(token: string): Record<string, any> {
    try {
      const part = token.split('.')[1]
      return JSON.parse(Buffer.from(part, 'base64url').toString())
    } catch {
      return {}
    }
  }

  async handleMicrosoftCallback(code: string, rawState: string): Promise<void> {
    const tenantId = this.verifyOAuthState(rawState)

    const tokenRes = await fetch(`https://login.microsoftonline.com/${this.msftTenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     this.config.get('MICROSOFT_CLIENT_ID')!,
        client_secret: this.config.get('MICROSOFT_CLIENT_SECRET')!,
        code,
        redirect_uri:  this.config.get('MICROSOFT_REDIRECT_URI')!,
        grant_type:    'authorization_code',
      }),
    })
    const tokens = await tokenRes.json() as any
    if (tokens.error) throw new BadRequestException(tokens.error_description ?? tokens.error)

    // Extract identity from id_token claims — avoids a separate Graph API call
    // and works regardless of which resource the access_token is scoped to.
    const claims = tokens.id_token ? this.decodeJwtPayload(tokens.id_token) : {}
    const accountEmail: string = claims['email'] || claims['preferred_username'] || claims['upn'] || ''
    const displayName: string  = claims['name'] || accountEmail

    if (!accountEmail) throw new BadRequestException('Could not get email from Microsoft account — ensure the app has openid+email+profile scopes')

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000)

    const msAccount = await this.prisma.connectedAccount.upsert({
      where: { tenantId_provider_accountEmail: { tenantId, provider: 'microsoft', accountEmail } },
      create: {
        tenantId,
        provider: 'microsoft',
        accountEmail,
        accountName: displayName,
        encryptedAccessToken:  encrypt(tokens.access_token),
        encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : '',
        scopes:    tokens.scope?.split(' ') ?? [],
        expiresAt,
        status: 'active',
        metadata: {
          imapHost:  'outlook.office365.com',
          imapPort:  993,
          imapSecure: true,
          smtpHost:  'smtp.office365.com',
          smtpPort:  587,
          smtpSecure: false,
          useOAuth:  true,
        },
      },
      update: {
        accountName: displayName,
        encryptedAccessToken: encrypt(tokens.access_token),
        ...(tokens.refresh_token ? { encryptedRefreshToken: encrypt(tokens.refresh_token) } : {}),
        scopes:    tokens.scope?.split(' ') ?? [],
        expiresAt,
        status: 'active',
      },
    })

    await this.seedDefaultRules(tenantId, msAccount.id)
    this.logger.log(`Microsoft account connected for tenant ${tenantId}: ${accountEmail}`)
  }

  private async refreshMicrosoftToken(account: any): Promise<string> {
    const refreshToken = decrypt(account.encryptedRefreshToken)
    const res = await fetch(`https://login.microsoftonline.com/${this.msftTenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     this.config.get('MICROSOFT_CLIENT_ID')!,
        client_secret: this.config.get('MICROSOFT_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    })
    const tokens = await res.json() as any
    if (tokens.error) {
      await this.prisma.connectedAccount.update({ where: { id: account.id }, data: { status: 'expired' } })
      throw new Error(`Microsoft token refresh failed: ${tokens.error_description ?? tokens.error}`)
    }
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000)
    await this.prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        encryptedAccessToken: encrypt(tokens.access_token),
        expiresAt,
        ...(tokens.refresh_token ? { encryptedRefreshToken: encrypt(tokens.refresh_token) } : {}),
      },
    })
    this.logger.log(`[Microsoft] Token refreshed for ${account.accountEmail}`)
    return tokens.access_token
  }

  private async processMicrosoftAccountEmails(
    tenantId: string,
    account: any,
  ): Promise<{ items: EmailScanItem[]; fetchedCount: number; skippedCount: number }> {
    try {
      // Refresh the access token if it has expired
      let accessToken = decrypt(account.encryptedAccessToken)
      if (account.expiresAt && new Date(account.expiresAt) <= new Date()) {
        accessToken = await this.refreshMicrosoftToken(account)
      }

      const imap = new ImapAdapter({
        host: 'outlook.office365.com',
        port: 993,
        secure: true,
        user: account.accountEmail,
        password: '',
        accessToken,
      })
      const emails = await imap.listUnread(30)

      const items: EmailScanItem[] = []
      let skippedCount = 0

      if (!emails.length) {
        this.logger.log(`[O365][${tenantId}] No recent inbox emails for ${account.accountEmail}`)
        return { items, fetchedCount: 0, skippedCount: 0 }
      }

      // Build SMTP mailer using OAuth2 (no password needed)
      const mailer = new AccountMailer({
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: account.accountEmail,
        encryptedSmtpPassword: '',
        smtpFromName: account.accountName ?? account.accountEmail,
        fromEmail: account.accountEmail,
        accessToken,
      })

      await this.seedDefaultRules(tenantId, account.id)
      const rules = await this.prisma.emailAgentRule.findMany({ where: { connectedAccountId: account.id, isActive: true } })
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
        if (exists) { skippedCount++; continue }

        // Skip emails sent by the connected account itself (prevents self-reply loops)
        if (email.from.toLowerCase() === account.accountEmail.toLowerCase()) {
          skippedCount++
          this.logger.debug(`[O365][${tenantId}] Skipping self-sent email from ${email.from}`)
          continue
        }

        // Find or create a conversation — this is the authoritative thread record
        const conversationId = await this.findOrCreateConversation({
          tenantId,
          connectedAccountId: account.id,
          customerEmail: email.from,
          customerName: email.fromName,
          subject: email.subject,
          incomingMessageId: email.threadId!,
          inReplyTo: email.inReplyTo,
          references: email.references,
        })

        // Load the conversation to get the last known Message-ID for reply threading
        const conversation = await this.prisma.emailConversation.findUnique({ where: { id: conversationId } })
        // The In-Reply-To for our reply = the Message-ID of the inbound email
        const replyInReplyTo = email.threadId ?? undefined
        const replyReferences = conversation?.allMessageIds?.length
          ? conversation.allMessageIds
          : (email.references ?? [])

        const classification = await classifier.classify(email, staffEmails, companyContext, account.email)
        const rule = rules.find(r => r.emailType === classification.type)
        const mode = rule?.mode ?? 'notify_only'
        const threshold = rule?.confidenceThreshold ?? 70
        const effectiveMode = classification.confidence >= threshold ? mode : 'notify_only'

        let confirmationHandled = false
        try {
          confirmationHandled = await this.handleCustomerConfirmation(tenantId, email, classification)
        } catch (err: any) {
          this.logger.warn(`[Confirmation][O365] Failed for ${email.from}: ${err.message}`)
        }

        let action: string | null = confirmationHandled ? 'confirmation_auto_updated' : null
        let errorMessage: string | null = null

        if (!confirmationHandled) {
          try {
            action = await this.executeImapEmailAction(
              tenantId,
              imap,
              mailer,
              { ...email, threadId: replyInReplyTo, references: replyReferences },
              classification,
              effectiveMode,
              rule?.replyTemplate ?? null,
              account.accountEmail,
              (account as any).assignedAgentId ?? rule?.assignedAgentId ?? null,
              conversationId,
            )
          } catch (err: any) {
            errorMessage = err.message
            this.logger.error(`[O365] Action failed for ${email.from}: ${err.message}`)
          }
        }

        {
          const processedData = {
            tenantId,
            connectedAccountId: account.id,
            conversationId,
            gmailMessageId: email.id,
            threadId: email.threadId,
            fromEmail: email.from,
            fromName: email.fromName,
            subject: email.subject,
            receivedAt: email.receivedAt,
            classification: classification.type,
            confidence: classification.confidence,
            extractedData: {
              ...(classification.extractedData as any ?? {}),
              snippet: (email.snippet || email.body?.slice(0, 500) || '').replace(/\u0000/g, ''),
              inReplyTo: email.inReplyTo ?? null,
              references: email.references ?? null,
              to: email.to ?? null,
              cc: email.cc ?? null,
            },
            action: action ?? 'skipped',
            status: errorMessage ? 'failed' : 'actioned',
            errorMessage,
          }
          const safeData = sanitizeRecord(processedData)
          await this.prisma.processedEmail.upsert({
            where: { connectedAccountId_gmailMessageId: { connectedAccountId: account.id, gmailMessageId: email.id } },
            create: safeData,
            update: safeData,
          })
        }

        items.push({
          from: email.from,
          fromName: email.fromName ?? null,
          subject: email.subject ?? '(no subject)',
          type: classification.type,
          confidence: classification.confidence,
          action: action ?? 'skipped',
          accountEmail: account.accountEmail,
        })

        this.logger.log(`[O365][${tenantId}] ${email.from} → ${classification.type} (${classification.confidence}%) → ${action} [conv:${conversationId}]`)
      }
      return { items, fetchedCount: emails.length, skippedCount }
    } catch (err: any) {
      this.logger.error(`processMicrosoftAccountEmails failed for ${account.accountEmail}: ${err.message}`)
      if (err.message?.includes('Authentication') || err.message?.includes('AUTHENTICATE')) {
        await this.prisma.connectedAccount.update({ where: { id: account.id }, data: { status: 'expired' } })
      }
      throw err
    }
  }

  async disconnectGoogleAccount(tenantId: string, accountId: string): Promise<void> {
    // Works for any provider — google, microsoft, or imap
    const account = await this.prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId },
    })
    if (!account) throw new NotFoundException('Account not found')
    await this.prisma.connectedAccount.delete({ where: { id: accountId } })
    this.logger.log(`Disconnected ${account.provider} account ${account.accountEmail} for tenant ${tenantId}`)
  }

  async getConnectedAccounts(tenantId: string) {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { assignedAgent: { select: { id: true, name: true, role: true, avatar: true } } },
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
      assignedAgentId: (a as any).assignedAgentId ?? null,
      assignedAgent: (a as any).assignedAgent ?? null,
    }))
  }

  async updateConnectedAccount(tenantId: string, accountId: string, data: { assignedAgentId?: string | null }) {
    const account = await this.prisma.connectedAccount.findFirst({ where: { id: accountId, tenantId } })
    if (!account) throw new NotFoundException('Connected account not found')
    return this.prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        assignedAgentId: data.assignedAgentId ?? null,
      },
      include: { assignedAgent: { select: { id: true, name: true, role: true, avatar: true } } },
    })
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

    const imapAccount = await this.prisma.connectedAccount.upsert({
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

    // Seed default email rules for this account
    await this.seedDefaultRules(tenantId, imapAccount.id)
    this.logger.log(`IMAP+SMTP account connected for tenant ${tenantId}: ${data.accountEmail}`)
  }

  // ─────────────────────────────────────────────
  // EMAIL RULES
  // ─────────────────────────────────────────────

  private async seedDefaultRules(tenantId: string, connectedAccountId: string): Promise<void> {
    for (const rule of DEFAULT_RULES) {
      await this.prisma.emailAgentRule.upsert({
        where: { connectedAccountId_emailType: { connectedAccountId, emailType: rule.emailType } },
        create: { tenantId, connectedAccountId, ...rule, isActive: true },
        update: {},
      })
    }
  }

  async getEmailRules(tenantId: string, connectedAccountId: string) {
    // Ensure rules exist for this account
    await this.seedDefaultRules(tenantId, connectedAccountId)
    return this.prisma.emailAgentRule.findMany({
      where: { tenantId, connectedAccountId },
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

  async updateEmailRule(tenantId: string, connectedAccountId: string, emailType: string, data: {
    mode?: string
    replyTemplate?: string
    confidenceThreshold?: number
    isActive?: boolean
    assignedAgentId?: string | null
  }) {
    return this.prisma.emailAgentRule.upsert({
      where: { connectedAccountId_emailType: { connectedAccountId, emailType } },
      create: {
        tenantId,
        connectedAccountId,
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
    const errors: string[] = []
    let fetched = 0
    let skipped = 0

    if (!accounts.length) {
      return {
        scanned: 0,
        results: [],
        accounts: 0,
        fetched: 0,
        skipped: 0,
        errors: ['No active connected accounts. Connect Gmail or IMAP first.'],
      }
    }

    for (const account of accounts) {
      try {
        if (account.provider === 'google') {
          const { items, fetchedCount, skippedCount } = await this.processAccountEmails(tenantId, account)
          results.push(...items)
          fetched += fetchedCount
          skipped += skippedCount
        } else if (account.provider === 'microsoft') {
          const { items, fetchedCount, skippedCount } = await this.processMicrosoftAccountEmails(tenantId, account)
          results.push(...items)
          fetched += fetchedCount
          skipped += skippedCount
        } else if (account.provider === 'imap') {
          const { items, fetchedCount, skippedCount } = await this.processImapAccountEmails(tenantId, account)
          results.push(...items)
          fetched += fetchedCount
          skipped += skippedCount
        }
      } catch (err: any) {
        const msg = `${account.accountEmail}: ${err.message}`
        this.logger.error(`[Scan] ${msg}`)
        errors.push(msg)
      }
    }

    return {
      scanned: results.length,
      results,
      accounts: accounts.length,
      fetched,
      skipped,
      errors,
    }
  }

  async scanSingleAccount(tenantId: string, accountId: string): Promise<ScanResult> {
    const account = await this.prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, status: 'active' },
    })
    if (!account) {
      return { scanned: 0, results: [], accounts: 0, fetched: 0, skipped: 0, errors: ['Account not found or inactive'] }
    }

    const results: EmailScanItem[] = []
    const errors: string[] = []
    let fetched = 0
    let skipped = 0

    try {
      let scan: { items: EmailScanItem[]; fetchedCount: number; skippedCount: number }
      if (account.provider === 'google') {
        scan = await this.processAccountEmails(tenantId, account)
      } else if (account.provider === 'microsoft') {
        scan = await this.processMicrosoftAccountEmails(tenantId, account)
      } else {
        scan = await this.processImapAccountEmails(tenantId, account)
      }
      results.push(...scan.items)
      fetched = scan.fetchedCount
      skipped = scan.skippedCount
    } catch (err: any) {
      const msg = `${account.accountEmail}: ${err.message}`
      this.logger.error(`[Scan] ${msg}`)
      errors.push(msg)
    }

    return { scanned: results.length, results, accounts: 1, fetched, skipped, errors }
  }

  private async processAccountEmails(tenantId: string, account: any): Promise<{ items: EmailScanItem[]; fetchedCount: number; skippedCount: number }> {
    const items: EmailScanItem[] = []
    let skippedCount = 0
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

      await this.seedDefaultRules(tenantId, account.id)
      const rules = await this.prisma.emailAgentRule.findMany({ where: { connectedAccountId: account.id, isActive: true } })

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
        if (exists) { skippedCount++; continue }

        // Skip emails sent by the connected account itself (prevents self-reply loops)
        if (email.from.toLowerCase() === account.accountEmail.toLowerCase()) {
          skippedCount++
          this.logger.debug(`[Gmail][${tenantId}] Skipping self-sent email from ${email.from}`)
          continue
        }

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

        // Find or create conversation for threading context
        let conversationId: string | null = null
        try {
          conversationId = await this.findOrCreateConversation({
            tenantId,
            connectedAccountId: account.id,
            customerEmail: email.from,
            customerName: email.fromName,
            subject: email.subject,
            incomingMessageId: email.threadId ?? email.id,
            inReplyTo: email.inReplyTo,
            references: email.references,
          })
        } catch (err: any) {
          this.logger.warn(`[Gmail][${tenantId}] findOrCreateConversation failed: ${err.message}`)
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
              // Account-level agent assignment takes priority over rule-level
              (account as any).assignedAgentId ?? rule?.assignedAgentId ?? null,
              conversationId,
            )
          } catch (err: any) {
            errorMessage = err.message
          }
        }

        // Upsert instead of create: a concurrent/overlapping scan of the same
        // account can pass the `exists` check above for the same email before
        // either write lands, which would otherwise throw a unique constraint
        // error on (connectedAccountId, gmailMessageId).
        {
          const processedData = {
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
            extractedData: {
              ...(classification.extractedData as any ?? {}),
              snippet: (email.snippet || email.body?.slice(0, 500) || '').replace(/\u0000/g, ''),
              to: email.to ?? null,
              cc: email.cc ?? null,
            },
            action: action ?? 'skipped',
            status: errorMessage ? 'failed' : 'actioned',
            errorMessage,
            conversationId: conversationId ?? undefined,
          }
          const safeData = sanitizeRecord(processedData)
          await this.prisma.processedEmail.upsert({
            where: { connectedAccountId_gmailMessageId: { connectedAccountId: account.id, gmailMessageId: email.id } },
            create: safeData,
            update: safeData,
          })
        }

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
      return { items, fetchedCount: emails.length, skippedCount }
    } catch (err: any) {
      this.logger.error(`processAccountEmails failed for ${account.accountEmail}: ${err.message}`)
      if (err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
        await this.prisma.connectedAccount.update({
          where: { id: account.id },
          data: { status: 'expired' },
        })
      }
      throw err
    }
  }

  private async processImapAccountEmails(tenantId: string, account: any): Promise<{ items: EmailScanItem[]; fetchedCount: number; skippedCount: number }> {
    try {
      const meta = account.metadata as any
      if (!meta?.imapHost) {
        throw new Error('IMAP host not configured on this account — reconnect the account')
      }
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
      let skippedCount = 0

      if (!emails.length) {
        this.logger.log(`[IMAP][${tenantId}] No recent inbox emails for ${account.accountEmail}`)
        return { items, fetchedCount: 0, skippedCount: 0 }
      }

      // Build per-account mailer if SMTP is configured
      let mailer: AccountMailer | null = null
      if (meta.smtpHost && meta.encryptedSmtpPassword) {
        mailer = AccountMailer.fromAccountMetadata(meta, account.accountEmail)
      }

      await this.seedDefaultRules(tenantId, account.id)
      const rules = await this.prisma.emailAgentRule.findMany({ where: { connectedAccountId: account.id, isActive: true } })
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
        if (exists) { skippedCount++; continue }

        // Skip emails sent by the connected account itself (prevents self-reply loops)
        if (email.from.toLowerCase() === account.accountEmail.toLowerCase()) {
          skippedCount++
          this.logger.debug(`[IMAP][${tenantId}] Skipping self-sent email from ${email.from}`)
          continue
        }

        // Find or create a conversation — authoritative thread record
        const conversationId = await this.findOrCreateConversation({
          tenantId,
          connectedAccountId: account.id,
          customerEmail: email.from,
          customerName: email.fromName,
          subject: email.subject,
          incomingMessageId: email.threadId!,
          inReplyTo: email.inReplyTo,
          references: email.references,
        })

        const conversation = await this.prisma.emailConversation.findUnique({ where: { id: conversationId } })
        const replyInReplyTo = email.threadId ?? undefined
        const replyReferences = conversation?.allMessageIds?.length
          ? conversation.allMessageIds
          : (email.references ?? [])

        const classification = await classifier.classify(email, staffEmails, companyContext, account.email)
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
              { ...email, threadId: replyInReplyTo, references: replyReferences },
              classification,
              effectiveMode,
              rule?.replyTemplate ?? null,
              account.accountEmail,
              // Account-level agent assignment takes priority over rule-level
              (account as any).assignedAgentId ?? rule?.assignedAgentId ?? null,
              conversationId,
            )
          } catch (err: any) {
            errorMessage = err.message
            this.logger.error(`Action failed for ${email.from}: ${err.message}`)
          }
        }

        // Upsert instead of create: a concurrent/overlapping scan of the same
        // account can pass the `exists` check above for the same email before
        // either write lands, which would otherwise throw a unique constraint
        // error on (connectedAccountId, gmailMessageId).
        {
          const processedData = {
            tenantId,
            connectedAccountId: account.id,
            conversationId,
            gmailMessageId: email.id,
            threadId: email.threadId,
            fromEmail: email.from,
            fromName: email.fromName,
            subject: email.subject,
            receivedAt: email.receivedAt,
            classification: classification.type,
            confidence: classification.confidence,
            extractedData: {
              ...(classification.extractedData as any ?? {}),
              snippet: (email.snippet || email.body?.slice(0, 500) || '').replace(/\u0000/g, ''),
              inReplyTo: email.inReplyTo ?? null,
              references: email.references ?? null,
              to: email.to ?? null,
              cc: email.cc ?? null,
            },
            action: action ?? 'skipped',
            status: errorMessage ? 'failed' : 'actioned',
            errorMessage,
          }
          const safeData = sanitizeRecord(processedData)
          await this.prisma.processedEmail.upsert({
            where: { connectedAccountId_gmailMessageId: { connectedAccountId: account.id, gmailMessageId: email.id } },
            create: safeData,
            update: safeData,
          })
        }

        items.push({
          from: email.from,
          fromName: email.fromName ?? null,
          subject: email.subject ?? '(no subject)',
          type: classification.type,
          confidence: classification.confidence,
          action: action ?? 'skipped',
          accountEmail: account.accountEmail,
        })

        this.logger.log(`[IMAP][${tenantId}] ${email.from} → ${classification.type} (${classification.confidence}%) → ${action} [conv:${conversationId}]`)
      }
      return { items, fetchedCount: emails.length, skippedCount }
    } catch (err: any) {
      this.logger.error(`processImapAccountEmails failed for ${account.accountEmail}: ${err.message}`)
      if (err.message?.includes('Authentication') || err.message?.includes('Invalid credentials')) {
        await this.prisma.connectedAccount.update({
          where: { id: account.id },
          data: { status: 'expired' },
        })
      }
      throw err
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
    conversationId?: string,
  ): Promise<string> {
    switch (mode) {
      case 'block':
        await imap.markAsRead(email.id)
        return 'archived'

      case 'auto_reply': {
        if (!(await this.autonomy.canContactCustomer(tenantId))) {
          await this.notifyAgentOfEmail(tenantId, email, classification,
            '⚠️ Auto-reply skipped — AI workforce autonomy is paused or internal-only.')
          return 'notified'
        }
        if (!mailer) {
          await this.notifyAgentOfEmail(tenantId, email, classification,
            '⚠️ Auto-reply skipped — SMTP not configured for this account.')
          return 'notified'
        }
        const replyBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId, conversationId)
        const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`
        // In-Reply-To = Message-ID of the inbound email (stored in threadId by IMAP adapter)
        const inReplyTo = email.threadId || undefined
        // References = full conversation chain (allMessageIds) already injected by caller,
        // deduplicated and with inReplyTo appended
        const refs = [...new Set([...(email.references ?? []), ...(inReplyTo ? [inReplyTo] : [])])].filter(Boolean)
        // Pre-generate Message-ID using the real sending domain so SMTP servers don't rewrite it
        const sendingDomain = fromEmail.split('@')[1] ?? 'mail.local'
        const outboundMsgId = `<reply-${Date.now()}-${Math.random().toString(36).slice(2)}@${sendingDomain}>`
        // Build Reply All CC: original To + Cc, excluding the connected account itself
        const replyAllCc = [
          ...(email.to ?? []),
          ...(email.cc ?? []),
        ].filter(addr => addr.toLowerCase() !== fromEmail.toLowerCase() && addr.toLowerCase() !== email.from.toLowerCase())
        // sendReply returns the actual Message-ID accepted by the SMTP server
        const sentMsgId = await mailer.sendReply({
          to: email.from,
          subject: replySubject,
          html: replyBody,
          inReplyTo,
          references: refs.length ? refs : undefined,
          messageId: outboundMsgId,
          cc: replyAllCc.length ? replyAllCc : undefined,
        })
        const trackedMsgId = sentMsgId || outboundMsgId
        // Save a copy to Sent folder so email clients can reconstruct the thread
        imap.saveSent({
          to: email.from,
          subject: replySubject,
          htmlBody: replyBody,
          messageId: trackedMsgId,
          inReplyTo,
          references: refs.length ? refs : undefined,
          fromName: fromEmail,
          cc: replyAllCc.length ? replyAllCc : undefined,
        }).catch(() => {})  // non-blocking, best-effort
        await imap.markAsRead(email.id)
        if (conversationId) await this.recordOutboundMessage(conversationId, trackedMsgId)
        await this.notifyAgentOfEmail(tenantId, email, classification,
          `✅ Auto-reply sent from ${fromEmail}`)
        return 'replied'
      }

      case 'auto_draft': {
        const draftBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId, conversationId)

        // Save draft directly to Drafts folder via IMAP APPEND
        const saved = await imap.saveDraft(email.from, email.subject, draftBody, email.threadId || undefined, email.references)
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
    conversationId?: string | null,
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

      case 'auto_reply': {
        if (!(await this.autonomy.canContactCustomer(tenantId))) {
          await this.notifyAgentOfEmail(tenantId, email, classification,
            '⚠️ Auto-reply skipped — AI workforce autonomy is paused or internal-only.')
          return 'notified'
        }
        const replyBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId, conversationId)
        const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`
        // Build Reply All CC: original To + Cc, excluding self and the sender
        const gmailReplyAllCc = [...(email.to ?? []), ...(email.cc ?? [])]
          .filter(addr => addr.toLowerCase() !== email.from.toLowerCase())
        // Gmail API returns the sent thread/message ID which we use for tracking
        const gmailSentId = await gmail.sendReply(email.from, replySubject, replyBody, email.threadId, gmailReplyAllCc.length ? gmailReplyAllCc : undefined)
        if (conversationId && gmailSentId) await this.recordOutboundMessage(conversationId, gmailSentId)
        await gmail.markAsRead(email.id)
        await this.notifyAgentOfEmail(tenantId, email, classification,
          `✅ Auto-reply sent via Gmail`)
        return 'replied'
      }

      case 'auto_draft': {
        const replyBody = replyTemplate
          ? this.fillTemplate(replyTemplate, email, classification)
          : await this.generateEmailReply(email, classification, tenantId, assignedAgentId, conversationId)
        const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject || ''}`
        const gmailDraftCc = [...(email.to ?? []), ...(email.cc ?? [])]
          .filter(addr => addr.toLowerCase() !== email.from.toLowerCase())
        const draftId = await gmail.createDraft(email.from, replySubject, replyBody, email.threadId, gmailDraftCc.length ? gmailDraftCc : undefined)
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

    // updateMany enforces tenantId in the where clause as a defence-in-depth guard
    await this.prisma.activityTicket.updateMany({
      where: { id: ticket.id, tenantId },
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

      const briefing = lines.join('\n').replace(/\u0000/g, '')
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
    conversationId?: string | null,
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

    // Load prior conversation messages so the AI has full context
    let conversationHistory: Array<{ from: string; fromName: string; date: string; body: string }> = []
    if (conversationId) {
      try {
        const prior = await this.prisma.processedEmail.findMany({
          where: { conversationId },
          orderBy: { receivedAt: 'asc' },
          take: 10,
          select: { fromEmail: true, fromName: true, receivedAt: true, extractedData: true },
        })
        conversationHistory = prior.map(p => ({
          from: p.fromEmail,
          fromName: p.fromName ?? p.fromEmail,
          date: p.receivedAt.toUTCString(),
          body: (p.extractedData as any)?.snippet ?? '',
        }))
      } catch {}
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

    const historyText = conversationHistory.length > 1
      ? `\nConversation history (oldest first):\n${conversationHistory.map(m =>
          `On ${m.date}, ${m.fromName} <${m.from}> wrote:\n${m.body}`
        ).join('\n\n')}\n`
      : ''

    const prompt = `${agentPersona}Write a professional, friendly email reply on behalf of ${companyName}.
Email type: ${classification.type.replace(/_/g, ' ')}
From: ${email.fromName || email.from} <${email.from}>
Subject: ${email.subject}
Their latest message: ${email.body?.slice(0, 800)}
${historyText}${crmContext}
Instructions:
- Reply naturally as ${agentName} from ${companyName}
- Be concise and helpful (3-5 sentences max unless more detail is needed)
- Address their specific question or need taking into account the conversation history
- Sign off as "${agentName}, ${companyName}"
- Output ONLY the new reply text as HTML using <p> tags — do NOT include the quoted history in your output
- Do NOT wrap output in markdown code fences or backticks
- Do NOT include \`\`\`html or \`\`\` anywhere in your response`

    const raw = await this.ai.chat(prompt, [])
    const replyHtml = raw
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    // Append quoted conversation thread below the reply (standard email format)
    const quotedThread = this.buildQuotedThread(email, conversationHistory)
    return replyHtml + quotedThread
  }

  /**
   * Strip raw MIME multipart junk from an email body, returning clean readable text.
   * Handles: boundary markers, Content-* headers, quoted-printable soft line breaks,
   * and HTML tags (converting to plain text for use in quoted blocks).
   */
  private stripMimeJunk(raw: string): string {
    if (!raw) return ''

    // If the body contains HTML tags, extract inner text
    if (/<\s*(html|body|div|p|br|span|table)\b/i.test(raw)) {
      return raw
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/=\r?\n/g, '')  // quoted-printable soft line breaks
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }

    // Plain text: strip MIME boundary markers and Content-* header lines
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
    const cleaned: string[] = []
    let inHeader = false

    for (const line of lines) {
      // MIME boundary line (starts with --)
      if (/^-{2,}/.test(line)) {
        inHeader = true
        continue
      }
      // Content-* header line immediately after a boundary
      if (inHeader && /^(Content-|MIME-Version:)/i.test(line)) {
        continue
      }
      // Blank line after headers ends the header block
      if (inHeader && line.trim() === '') {
        inHeader = false
        continue
      }
      inHeader = false
      cleaned.push(line)
    }

    return cleaned
      .join('\n')
      .replace(/=\r?\n/g, '')  // quoted-printable soft line breaks
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Build the quoted conversation thread appended below an email reply.
   * Renders as:
   *   <hr>
   *   On [date], [Name] <[email]> wrote:
   *   <blockquote>[message body]</blockquote>
   *   <hr>
   *   On [date], ... (previous messages, newest first after the divider)
   */
  private buildQuotedThread(
    currentEmail: any,
    priorMessages: Array<{ from: string; fromName: string; date: string; body: string }>,
  ): string {
    // Build quoted entries: current email first, then prior messages (newest first)
    const currentFrom = currentEmail.from ?? currentEmail.fromEmail ?? ''
    const entries: Array<{ from: string; fromName: string; date: string; body: string }> = [
      {
        from: currentFrom,
        fromName: currentEmail.fromName ?? currentFrom,
        date: currentEmail.receivedAt ? new Date(currentEmail.receivedAt).toUTCString() : new Date().toUTCString(),
        body: currentEmail.body ?? (currentEmail.extractedData as any)?.snippet ?? '',
      },
      ...[...priorMessages].reverse(),
    ]

    if (!entries.some(e => e.body)) return ''

    const quoted = entries
      .filter(e => e.body)
      .map(e => {
        const cleanBody = this.stripMimeJunk(e.body)
        const safeBody = cleanBody
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
        return `
<hr style="border:none;border-top:1px solid #ccc;margin:16px 0">
<p style="color:#666;font-size:13px;margin:0 0 4px">
  On ${e.date}, <strong>${e.fromName}</strong> &lt;${e.from}&gt; wrote:
</p>
<blockquote style="border-left:3px solid #ccc;margin:4px 0 0 8px;padding:4px 8px;color:#444;font-size:13px">
  ${safeBody}
</blockquote>`
      })
      .join('')

    return quoted
  }

  private async lookupCrmContext(_tenantId: string, _senderEmail: string): Promise<string> {
    // CRM lookup via external API — placeholder for future integration.
    return ''
  }

  // ─────────────────────────────────────────────
  // EMAIL CONVERSATION TRACKING
  // ─────────────────────────────────────────────

  /**
   * Find an existing conversation for this inbound email, or create a new one.
   *
   * Matching priority (as per RFC threading rules):
   * 1. In-Reply-To header matches a Message-ID already in allMessageIds
   * 2. Any References header value matches a Message-ID in allMessageIds
   * 3. Same customerEmail + connectedAccountId (last open conversation from that sender)
   *
   * We deliberately do NOT match by subject alone — subjects can change.
   */
  async findOrCreateConversation(params: {
    tenantId: string
    connectedAccountId: string
    customerEmail: string
    customerName?: string
    subject?: string
    incomingMessageId: string   // the Message-ID of the inbound email
    inReplyTo?: string          // In-Reply-To header value
    references?: string[]       // References header values
  }): Promise<string> {
    const { tenantId, connectedAccountId, customerEmail, customerName, subject, incomingMessageId, inReplyTo, references } = params

    // Build the candidate set of message IDs to look for in allMessageIds
    const candidates = [...(references ?? []), ...(inReplyTo ? [inReplyTo] : [])].filter(Boolean)

    // 1. Try to find a conversation that has seen one of these message IDs
    if (candidates.length) {
      const existing = await this.prisma.emailConversation.findFirst({
        where: {
          connectedAccountId,
          allMessageIds: { hasSome: candidates },
        },
        orderBy: { updatedAt: 'desc' },
      })
      if (existing) {
        // Append the new inbound message ID and update metadata
        await this.prisma.emailConversation.update({
          where: { id: existing.id },
          data: {
            lastMessageId: incomingMessageId,
            allMessageIds: { push: incomingMessageId },
            status: 'open',
            updatedAt: new Date(),
          },
        })
        return existing.id
      }
    }

    // 2. Fall back to last open conversation with this sender on this account
    const byEmail = await this.prisma.emailConversation.findFirst({
      where: { connectedAccountId, customerEmail: { equals: customerEmail, mode: 'insensitive' }, status: 'open' },
      orderBy: { updatedAt: 'desc' },
    })
    if (byEmail) {
      await this.prisma.emailConversation.update({
        where: { id: byEmail.id },
        data: {
          lastMessageId: incomingMessageId,
          allMessageIds: { push: incomingMessageId },
          updatedAt: new Date(),
        },
      })
      return byEmail.id
    }

    // 3. Create a brand-new conversation
    const conv = await this.prisma.emailConversation.create({
      data: {
        tenantId,
        connectedAccountId,
        customerEmail,
        customerName: customerName ?? null,
        subject: subject ?? null,
        status: 'open',
        lastMessageId: incomingMessageId,
        allMessageIds: [incomingMessageId],
      },
    })
    return conv.id
  }

  /**
   * After we send a reply, record our outbound Message-ID in the conversation
   * so that any subsequent customer reply will match it.
   */
  async recordOutboundMessage(conversationId: string, outboundMessageId: string): Promise<void> {
    try {
      await this.prisma.emailConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageId: outboundMessageId,
          lastReplyAt: new Date(),
          allMessageIds: { push: outboundMessageId },
          updatedAt: new Date(),
        },
      })
    } catch {
      // Non-critical — don't crash the scan if this fails
    }
  }

  // ─────────────────────────────────────────────
  // PROCESSED EMAILS HISTORY
  // ─────────────────────────────────────────────

  async getProcessedEmails(
    tenantId: string,
    limit = 50,
    offset = 0,
    filters?: { action?: string; status?: string; needsReview?: boolean; connectedAccountId?: string },
  ): Promise<{ items: any[]; total: number; limit: number; offset: number }> {
    const where: any = { tenantId }

    if (filters?.connectedAccountId) {
      where.connectedAccountId = filters.connectedAccountId
    }

    if (filters?.needsReview) {
      where.OR = [
        { action: { in: ['flagged', 'drafted', 'escalated'] } },
        { status: 'pending', action: { in: ['notified', 'flagged', 'drafted'] } },
      ]
    } else {
      if (filters?.action) {
        const actions = filters.action.split(',').map((a) => a.trim()).filter(Boolean)
        if (actions.length === 1) where.action = actions[0]
        else if (actions.length > 1) where.action = { in: actions }
      }
      if (filters?.status) where.status = filters.status
    }

    const [items, total] = await Promise.all([
      this.prisma.processedEmail.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { connectedAccount: { select: { accountEmail: true, provider: true } } },
      }),
      this.prisma.processedEmail.count({ where }),
    ])
    return { items, total, limit, offset }
  }

  async replyToProcessedEmail(
    tenantId: string,
    emailId: string,
    body: string,
  ): Promise<{ success: boolean; id: string }> {
    const email = await this.prisma.processedEmail.findFirst({
      where: { id: emailId, tenantId },
      include: { connectedAccount: true },
    })
    if (!email) throw new NotFoundException('Processed email not found')
    if (!body?.trim()) throw new BadRequestException('Reply body is required')

    const account = email.connectedAccount
    const subject = email.subject?.startsWith('Re:')
      ? (email.subject ?? 'Re: (no subject)')
      : `Re: ${email.subject || '(no subject)'}`

    const safeBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')

    // Load conversation history so we can append quoted thread
    let conversationHistory: Array<{ from: string; fromName: string; date: string; body: string }> = []
    if (email.conversationId) {
      try {
        const prior = await this.prisma.processedEmail.findMany({
          where: { conversationId: email.conversationId },
          orderBy: { receivedAt: 'asc' },
          take: 10,
          select: { fromEmail: true, fromName: true, receivedAt: true, extractedData: true },
        })
        conversationHistory = prior.map(p => ({
          from: p.fromEmail,
          fromName: p.fromName ?? p.fromEmail,
          date: p.receivedAt.toUTCString(),
          body: (p.extractedData as any)?.snippet ?? '',
        }))
      } catch {}
    }

    const quotedThread = this.buildQuotedThread(email, conversationHistory)
    const html = `<div style="font-family:sans-serif;white-space:pre-wrap">${safeBody}</div>${quotedThread}`

    // Build threading headers — prefer the full conversation chain, fallback to extractedData
    const inReplyTo = email.threadId ?? undefined
    let refsChain: string[] = []
    if (email.conversationId) {
      const conv = await this.prisma.emailConversation.findUnique({ where: { id: email.conversationId } })
      refsChain = conv?.allMessageIds ?? []
    }
    if (!refsChain.length) {
      const ed = (email.extractedData as any) ?? {}
      const priorRefs: string[] = Array.isArray(ed.references) ? ed.references : []
      refsChain = [...priorRefs, ...(inReplyTo ? [inReplyTo] : [])]
        .filter((v: string, i: number, a: string[]) => v && a.indexOf(v) === i)
    }

    // Use the connected account's own mailer so the reply comes from the right address
    // and threading headers (In-Reply-To / References) are correctly set
    // Pre-generate Message-ID using the real sending domain so SMTP servers don't rewrite it
    const replyDomain = account.accountEmail?.split('@')[1] ?? 'mail.local'
    const pregenMsgId = `<manual-${Date.now()}-${Math.random().toString(36).slice(2)}@${replyDomain}>`
    let sentMsgId = pregenMsgId

    // Build Reply All CC from stored extractedData (to/cc captured at ingest time)
    const ed = (email.extractedData as any) ?? {}
    const storedTo: string[] = Array.isArray(ed.to) ? ed.to : []
    const storedCc: string[] = Array.isArray(ed.cc) ? ed.cc : []
    const replyAllCc = [...storedTo, ...storedCc].filter(
      addr => addr && addr.includes('@') &&
        addr.toLowerCase() !== email.fromEmail.toLowerCase() &&
        addr.toLowerCase() !== account.accountEmail.toLowerCase()
    )

    if (account.provider === 'google') {
      // Gmail — use the Gmail API to reply in the thread; returns the Gmail message ID
      const oauth2 = this.getGoogleOAuthClient()
      const accessToken = decrypt(account.encryptedAccessToken)
      const refreshToken = account.encryptedRefreshToken ? decrypt(account.encryptedRefreshToken) : undefined
      oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: account.expiresAt?.getTime() })
      const gmail = new GmailAdapter(oauth2)
      const gmailMsgId = await gmail.sendReply(email.fromEmail, subject, html, email.threadId ?? undefined, replyAllCc.length ? replyAllCc : undefined)
      if (gmailMsgId) sentMsgId = gmailMsgId
    } else if (account.provider === 'microsoft') {
      // Office 365 — use OAuth2 SMTP with threading headers
      const accessToken = await this.refreshMicrosoftToken(account)
      const mailer = new AccountMailer({
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: account.accountEmail,
        encryptedSmtpPassword: '',
        smtpFromName: account.accountName ?? account.accountEmail,
        fromEmail: account.accountEmail,
        accessToken,
      })
      const smtpMsgId = await mailer.sendReply({
        to: email.fromEmail,
        subject,
        html,
        inReplyTo,
        references: refsChain.length ? refsChain : undefined,
        messageId: pregenMsgId,
        cc: replyAllCc.length ? replyAllCc : undefined,
      })
      if (smtpMsgId) sentMsgId = smtpMsgId
    } else {
      // IMAP — use account's SMTP credentials with threading headers
      const meta = account.metadata as any
      if (!meta?.smtpHost && !meta?.encryptedSmtpPassword) {
        throw new BadRequestException('SMTP is not configured for this account — edit the account and add SMTP settings.')
      }
      const mailer = AccountMailer.fromAccountMetadata(meta, account.accountEmail)
      const smtpMsgId = await mailer.sendReply({
        to: email.fromEmail,
        subject,
        html,
        inReplyTo,
        references: refsChain.length ? refsChain : undefined,
        messageId: pregenMsgId,
        cc: replyAllCc.length ? replyAllCc : undefined,
      })
      if (smtpMsgId) sentMsgId = smtpMsgId
    }

    // Store the exact Message-ID that went on the wire — future customer replies
    // will reference this ID in their In-Reply-To header
    if (email.conversationId) {
      await this.recordOutboundMessage(email.conversationId, sentMsgId)
    }

    await this.prisma.processedEmail.update({
      where: { id: email.id },
      data: {
        action: 'replied',
        status: 'actioned',
        extractedData: {
          ...((email.extractedData as object) || {}),
          lastReplyAt: new Date().toISOString(),
          lastReplyPreview: body.slice(0, 500),
        },
      },
    })

    this.logger.log(`Manual reply sent for processed email ${email.id} → ${email.fromEmail} via ${account.provider}`)
    return { success: true, id: email.id }
  }

  async updateProcessedEmailStatus(
    tenantId: string,
    emailId: string,
    data: { status?: string; action?: string },
  ): Promise<any> {
    const email = await this.prisma.processedEmail.findFirst({
      where: { id: emailId, tenantId },
    })
    if (!email) throw new NotFoundException('Processed email not found')

    return this.prisma.processedEmail.update({
      where: { id: email.id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.action ? { action: data.action } : {}),
      },
      include: { connectedAccount: { select: { accountEmail: true, provider: true } } },
    })
  }
}
