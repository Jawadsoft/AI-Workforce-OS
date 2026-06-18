const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client')
const crypto = require('crypto')

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32

function getKey() {
  const raw = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-chars!!'
  return Buffer.from(raw.slice(0, KEY_LENGTH).padEnd(KEY_LENGTH, '0'))
}

function encrypt(text) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

require('./load-env')

const prisma = new PrismaClient()

async function main() {
  // Find the first tenant
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!tenant) {
    console.log('No tenant found. Please create a tenant first.')
    process.exit(1)
  }

  console.log(`Setting up IMAP for tenant: ${tenant.name} (${tenant.id})`)

  const config = {
    accountEmail: process.env.SEED_IMAP_EMAIL,
    accountName: process.env.SEED_IMAP_NAME || 'IMAP Inbox',
    imapHost: process.env.SEED_IMAP_HOST || 'imap.one.com',
    imapPort: Number(process.env.SEED_IMAP_PORT || 993),
    imapSecure: process.env.SEED_IMAP_SECURE !== 'false',
    password: process.env.SEED_IMAP_PASSWORD,
    smtpHost: process.env.SEED_SMTP_HOST || 'send.one.com',
    smtpPort: Number(process.env.SEED_SMTP_PORT || 587),
    smtpSecure: process.env.SEED_SMTP_SECURE === 'true',
    smtpFromName: process.env.SEED_SMTP_FROM_NAME || 'AI Workforce',
  }

  if (!config.accountEmail || !config.password) {
    console.error('Set SEED_IMAP_EMAIL and SEED_IMAP_PASSWORD in .env')
    process.exit(1)
  }

  const encryptedPassword = encrypt(config.password)
  const encryptedSmtpPassword = encrypt(config.password) // same password for SMTP

  const account = await prisma.connectedAccount.upsert({
    where: {
      tenantId_provider_accountEmail: {
        tenantId: tenant.id,
        provider: 'imap',
        accountEmail: config.accountEmail,
      },
    },
    create: {
      tenantId: tenant.id,
      provider: 'imap',
      accountEmail: config.accountEmail,
      accountName: config.accountName,
      encryptedAccessToken: encryptedPassword,
      scopes: ['imap', 'smtp'],
      status: 'active',
      metadata: {
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapSecure: config.imapSecure,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpSecure: config.smtpSecure,
        smtpUser: config.accountEmail,
        smtpFromName: config.smtpFromName,
        encryptedSmtpPassword,
      },
    },
    update: {
      accountName: config.accountName,
      encryptedAccessToken: encryptedPassword,
      status: 'active',
      scopes: ['imap', 'smtp'],
      metadata: {
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapSecure: config.imapSecure,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpSecure: config.smtpSecure,
        smtpUser: config.accountEmail,
        smtpFromName: config.smtpFromName,
        encryptedSmtpPassword,
      },
    },
  })

  console.log('✅ IMAP account connected:', account.accountEmail)

  // Seed default email rules
  const DEFAULT_RULES = [
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

  for (const rule of DEFAULT_RULES) {
    await prisma.emailAgentRule.upsert({
      where: { tenantId_emailType: { tenantId: tenant.id, emailType: rule.emailType } },
      create: { tenantId: tenant.id, ...rule, isActive: true },
      update: {},
    })
  }

  console.log('✅ Email rules seeded (13 rules)')
  console.log('\nDone! Go to Settings → Integrations to see the connected account.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
