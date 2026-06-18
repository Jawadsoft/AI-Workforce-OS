'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  Mail,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Eye,
  FileText,
  Ban,
  Plus,
  X,
  Loader2,
  Server,
  Send,
  Reply,
  Archive,
  BellRing,
  Clock,
  CheckCheck,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ConnectedAccount {
  id: string
  provider: 'google' | 'microsoft'
  accountEmail: string
  accountName: string | null
  status: 'active' | 'expired' | 'revoked'
  scopes: string[]
  expiresAt: string | null
  createdAt: string
}

interface EmailRule {
  id: string
  emailType: string
  mode: string
  replyTemplate: string | null
  confidenceThreshold: number
  isActive: boolean
}

interface ScanItem {
  from: string
  fromName: string | null
  subject: string
  type: string
  confidence: number
  action: string
  accountEmail: string
}

interface ScanResult {
  scanned: number
  accounts: number
  results: ScanItem[]
}

interface AgentOption {
  id: string
  name: string
  role: string
  avatar: string | null
}

const EMAIL_TYPE_LABELS: Record<string, { label: string; icon: string; description: string }> = {
  lead_inquiry:    { label: 'New Lead Inquiry',      icon: '🌟', description: 'Potential customer asking about your services' },
  quote_request:   { label: 'Quote Request',          icon: '💰', description: 'Customer explicitly requesting a quote/estimate' },
  support_request: { label: 'Support Request',        icon: '🛠️', description: 'Existing customer needing help or assistance' },
  complaint:       { label: 'Complaint',              icon: '⚠️', description: 'Customer expressing dissatisfaction or reporting a problem' },
  urgent_issue:    { label: 'Urgent Issue',           icon: '🚨', description: 'Emergency or time-sensitive matter requiring immediate attention' },
  meeting_request: { label: 'Meeting Request',        icon: '📅', description: 'Someone wanting to schedule a call, meeting, or site visit' },
  invoice_payment: { label: 'Invoice / Payment',      icon: '🧾', description: 'Billing, payment, or invoice-related emails' },
  job_application: { label: 'Job Application',        icon: '👤', description: 'CV, resume, or employment inquiry' },
  supplier_vendor: { label: 'Supplier / Vendor',      icon: '🏭', description: 'Vendor proposals, partnerships, or supplier inquiries' },
  legal_contract:  { label: 'Legal / Contract',       icon: '⚖️', description: 'Legal notices, contracts, or formal agreements' },
  newsletter:      { label: 'Newsletter',             icon: '📰', description: 'Newsletters, digests, or subscription-based emails' },
  spam_promotion:  { label: 'Spam / Promotions',      icon: '🚫', description: 'Marketing, unsolicited, or irrelevant promotional emails' },
  internal_team:   { label: 'Internal Team',          icon: '👥', description: 'Emails from your own staff or team members' },
}

const MODE_OPTIONS = [
  { value: 'auto_reply',        label: 'Auto Reply',       icon: Send,     description: 'AI sends reply immediately — no review needed' },
  { value: 'auto_draft',        label: 'Auto Draft',       icon: FileText, description: 'AI drafts a reply for you to review & send' },
  { value: 'approval_required', label: 'Needs Review',     icon: Shield,   description: 'Briefing sent to you — you decide how to reply' },
  { value: 'notify_only',       label: 'Notify Only',      icon: Eye,      description: 'Agent notifies you without taking action' },
  { value: 'block',             label: 'Block / Skip',     icon: Ban,      description: 'Silently archive and ignore these emails' },
]

// ── Main Panel ───────────────────────────────────────────────────────────────

const IMAP_PRESETS = [
  { label: 'One.com',      imapHost: 'imap.one.com',          imapPort: 993, imapSecure: true,  smtpHost: 'send.one.com',             smtpPort: 587, smtpSecure: false },
  { label: 'Gmail',        imapHost: 'imap.gmail.com',        imapPort: 993, imapSecure: true,  smtpHost: 'smtp.gmail.com',           smtpPort: 587, smtpSecure: false },
  { label: 'Outlook/O365', imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true,  smtpHost: 'smtp.office365.com',       smtpPort: 587, smtpSecure: false },
  { label: 'Yahoo',        imapHost: 'imap.mail.yahoo.com',   imapPort: 993, imapSecure: true,  smtpHost: 'smtp.mail.yahoo.com',      smtpPort: 587, smtpSecure: false },
  { label: 'Zoho',         imapHost: 'imap.zoho.com',         imapPort: 993, imapSecure: true,  smtpHost: 'smtp.zoho.com',            smtpPort: 587, smtpSecure: false },
  { label: 'GoDaddy',      imapHost: 'imap.secureserver.net', imapPort: 993, imapSecure: true,  smtpHost: 'smtpout.secureserver.net', smtpPort: 587, smtpSecure: false },
  { label: 'Custom',       imapHost: '',                      imapPort: 993, imapSecure: true,  smtpHost: '',                         smtpPort: 587, smtpSecure: false },
]

// ── Scan Result Modal ─────────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  replied:  { label: 'Auto Replied',  color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',  icon: <Reply className="w-3 h-3" /> },
  drafted:  { label: 'Draft Saved',   color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',      icon: <FileText className="w-3 h-3" /> },
  archived: { label: 'Blocked',       color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',          icon: <Archive className="w-3 h-3" /> },
  flagged:  { label: 'Needs Review',  color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: <AlertCircle className="w-3 h-3" /> },
  notified: { label: 'Notified',      color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', icon: <BellRing className="w-3 h-3" /> },
  skipped:  { label: 'Skipped',       color: 'bg-muted text-muted-foreground',                                         icon: <Clock className="w-3 h-3" /> },
}

function ScanResultModal({
  open,
  scanning,
  result,
  onClose,
}: {
  open: boolean
  scanning: boolean
  result: ScanResult | null
  onClose: () => void
}) {
  if (!open) return null

  const summary = result
    ? [
        { label: 'Replied', count: result.results.filter(r => r.action === 'replied').length, color: 'text-green-600 dark:text-green-400' },
        { label: 'Drafted', count: result.results.filter(r => r.action === 'drafted').length, color: 'text-blue-600 dark:text-blue-400' },
        { label: 'Blocked', count: result.results.filter(r => r.action === 'archived').length, color: 'text-red-600 dark:text-red-400' },
        { label: 'Review',  count: result.results.filter(r => r.action === 'flagged').length,  color: 'text-yellow-600 dark:text-yellow-400' },
        { label: 'Notified',count: result.results.filter(r => r.action === 'notified').length, color: 'text-purple-600 dark:text-purple-400' },
      ].filter(s => s.count > 0)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={!scanning ? onClose : undefined} />
      <div className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {scanning ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <CheckCheck className="w-4 h-4 text-green-500" />
            )}
            <h2 className="text-sm font-semibold">
              {scanning ? 'Scanning emails…' : `Scan Complete — ${result?.scanned ?? 0} email${result?.scanned !== 1 ? 's' : ''} processed`}
            </h2>
          </div>
          {!scanning && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Summary bar */}
        {!scanning && summary.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-3 bg-muted/30 border-b border-border shrink-0 text-xs">
            {summary.map(s => (
              <span key={s.label} className={`font-medium ${s.color}`}>
                {s.count} {s.label}
              </span>
            ))}
          </div>
        )}

        {/* Email list */}
        <div className="overflow-y-auto flex-1 px-2 py-2">
          {scanning && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm">Connecting to inbox and classifying emails…</p>
            </div>
          )}

          {!scanning && result?.scanned === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Mail className="w-8 h-8" />
              <p className="text-sm font-medium">No new emails to process</p>
              <p className="text-xs">All inbox emails are already up to date.</p>
            </div>
          )}

          {!scanning && result && result.results.map((item, i) => {
            const meta = ACTION_META[item.action] ?? ACTION_META.skipped
            const typeInfo = EMAIL_TYPE_LABELS[item.type]
            return (
              <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors">
                <span className="text-lg shrink-0 mt-0.5">{typeInfo?.icon ?? '📧'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate max-w-[200px]">
                      {item.fromName || item.from}
                    </p>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.color}`}>
                      {meta.icon}{meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{item.confidence}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{item.subject}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {typeInfo?.label ?? item.type} · {item.from}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {!scanning && (
          <div className="px-5 py-3 border-t border-border shrink-0">
            <button
              onClick={onClose}
              className="w-full text-sm py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function IntegrationsPanel() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [rules, setRules] = useState<EmailRule[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingRules, setLoadingRules] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [showScanModal, setShowScanModal] = useState(false)
  const [showImapForm, setShowImapForm] = useState(false)
  const [imapForm, setImapForm] = useState({
    accountEmail: '',
    accountName: '',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    password: '',
    showPass: false,
    // SMTP (outgoing)
    smtpHost: 'send.one.com',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPassword: '',
    smtpFromName: '',
    smtpSamePassword: true, // use same password for SMTP
  })
  const [imapTesting, setImapTesting] = useState(false)
  const [imapSaving, setImapSaving] = useState(false)

  useEffect(() => {
    fetchAccounts()
    fetchRules()
    api.get('/integrations/agents').then(r => setAgents(r.data)).catch(() => {})
  }, [])

  async function fetchAccounts() {
    setLoadingAccounts(true)
    try {
      const res = await api.get('/integrations/accounts')
      setAccounts(res.data)
    } catch {
      toast.error('Failed to load connected accounts')
    } finally {
      setLoadingAccounts(false)
    }
  }

  async function fetchRules() {
    setLoadingRules(true)
    try {
      const res = await api.get('/integrations/email-rules')
      setRules(res.data)
    } catch {
      toast.error('Failed to load email rules')
    } finally {
      setLoadingRules(false)
    }
  }

  async function testImap() {
    setImapTesting(true)
    try {
      const res = await api.post('/integrations/imap/test', {
        imapHost: imapForm.imapHost,
        imapPort: imapForm.imapPort,
        imapSecure: imapForm.imapSecure,
        accountEmail: imapForm.accountEmail,
        password: imapForm.password,
      })
      if (res.data.success) {
        toast.success('Connection successful! IMAP is working.')
      } else {
        toast.error(`Connection failed: ${res.data.error}`)
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message
      toast.error(Array.isArray(msg) ? msg.join(', ') : (msg || 'Connection test failed'))
    } finally {
      setImapTesting(false)
    }
  }

  async function connectImap() {
    if (!imapForm.accountEmail || !imapForm.password || !imapForm.imapHost) {
      toast.error('Please fill in all required fields')
      return
    }
    setImapSaving(true)
    try {
      await api.post('/integrations/imap/connect', {
        accountEmail: imapForm.accountEmail,
        accountName: imapForm.accountName || imapForm.accountEmail,
        imapHost: imapForm.imapHost,
        imapPort: imapForm.imapPort,
        imapSecure: imapForm.imapSecure,
        password: imapForm.password,
        smtpHost: imapForm.smtpHost,
        smtpPort: imapForm.smtpPort,
        smtpSecure: imapForm.smtpSecure,
        smtpUser: imapForm.smtpUser || imapForm.accountEmail,
        smtpPassword: imapForm.smtpSamePassword ? imapForm.password : imapForm.smtpPassword,
        smtpFromName: imapForm.smtpFromName || imapForm.accountName || imapForm.accountEmail,
      })
      toast.success(`${imapForm.accountEmail} connected successfully!`)
      setShowImapForm(false)
      setImapForm({ accountEmail: '', accountName: '', imapHost: 'imap.one.com', imapPort: 993, imapSecure: true, password: '', showPass: false, smtpHost: 'send.one.com', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPassword: '', smtpFromName: '', smtpSamePassword: true })
      fetchAccounts()
      fetchRules()
    } catch (err: any) {
      const msg = err?.response?.data?.message
      toast.error(Array.isArray(msg) ? msg.join(', ') : (msg || 'Failed to connect account'))
    } finally {
      setImapSaving(false)
    }
  }

  async function connectGoogle() {
    // Build the connect URL — the backend will redirect to Google OAuth
    const apiBase = (api.defaults.baseURL ?? '').replace(/\/api\/v1$/, '')
    window.location.href = `${apiBase}/api/v1/integrations/google/connect`
  }

  async function disconnectAccount(id: string) {
    if (!confirm('Disconnect this account? Email scanning will stop.')) return
    try {
      await api.delete(`/integrations/accounts/${id}`)
      setAccounts(prev => prev.filter(a => a.id !== id))
      toast.success('Account disconnected')
    } catch {
      toast.error('Failed to disconnect account')
    }
  }

  async function triggerScan() {
    setScanning(true)
    setScanResult(null)
    setShowScanModal(true)
    try {
      const { data } = await api.post<ScanResult>('/integrations/email-scan')
      setScanResult(data)
    } catch {
      toast.error('Email scan failed')
      setShowScanModal(false)
    } finally {
      setScanning(false)
    }
  }

  const googleAccounts = accounts.filter(a => a.provider === 'google')

  return (
    <div className="space-y-6">
      <ScanResultModal
        open={showScanModal}
        scanning={scanning}
        result={scanResult}
        onClose={() => setShowScanModal(false)}
      />

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect email accounts so your agents can scan, classify, and act on incoming emails automatically.
        </p>
      </div>

      {/* Connected Accounts */}
      <div className="rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Connected Email Accounts</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Connect Gmail to let agents read and respond to your emails</p>
          </div>
          {accounts.length > 0 && (
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Now'}
            </button>
          )}
        </div>

        {loadingAccounts ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {googleAccounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                onDisconnect={() => disconnectAccount(account.id)}
              />
            ))}

            {/* Add Google */}
            <button
              onClick={connectGoogle}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/50 transition-all group"
            >
              <div className="w-9 h-9 rounded-full bg-white border border-border flex items-center justify-center shadow-sm">
                <GoogleIcon />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium group-hover:text-primary transition-colors">Connect Gmail Account</p>
                <p className="text-xs text-muted-foreground">Read, classify, and auto-reply to emails</p>
              </div>
            </button>

            {/* IMAP — any provider */}
            <button
              onClick={() => setShowImapForm(!showImapForm)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/50 transition-all group"
            >
              <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center shadow-sm">
                <Server className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="text-left flex-1">
                <p className="text-sm font-medium group-hover:text-primary transition-colors">Connect via IMAP</p>
                <p className="text-xs text-muted-foreground">Outlook, Office 365, Yahoo, Zoho, custom domains</p>
              </div>
              {showImapForm ? <X className="w-4 h-4 text-muted-foreground" /> : <Plus className="w-4 h-4 text-muted-foreground" />}
            </button>

            {/* IMAP Form */}
            {showImapForm && (
              <div className="rounded-lg border border-border p-4 space-y-4 bg-muted/30">
                <h4 className="text-sm font-medium">IMAP Connection Details</h4>

                {/* Presets */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Email Provider</label>
                  <div className="flex flex-wrap gap-2">
                    {IMAP_PRESETS.map(p => (
                      <button
                        key={p.label}
                        onClick={() => setImapForm(f => ({
                          ...f,
                          imapHost: p.imapHost,
                          imapPort: p.imapPort,
                          imapSecure: p.imapSecure,
                          smtpHost: p.smtpHost,
                          smtpPort: p.smtpPort,
                          smtpSecure: p.smtpSecure,
                        }))}
                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                          imapForm.imapHost === p.imapHost
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-border hover:bg-accent'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Email Address *</label>
                    <input
                      type="email"
                      value={imapForm.accountEmail}
                      onChange={e => setImapForm(f => ({ ...f, accountEmail: e.target.value }))}
                      placeholder="info@yourdomain.com"
                      className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Display Name</label>
                    <input
                      value={imapForm.accountName}
                      onChange={e => setImapForm(f => ({ ...f, accountName: e.target.value }))}
                      placeholder="Business Inbox"
                      className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">IMAP Host *</label>
                    <input
                      value={imapForm.imapHost}
                      onChange={e => setImapForm(f => ({ ...f, imapHost: e.target.value }))}
                      placeholder="imap.yourdomain.com"
                      className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Port</label>
                    <div className="flex gap-2">
                      <select
                        value={[993,143,465,587,110,995].includes(imapForm.imapPort) ? imapForm.imapPort : 0}
                        onChange={e => {
                          const port = parseInt(e.target.value)
                          if (port) setImapForm(f => ({ ...f, imapPort: port, imapSecure: port === 993 || port === 465 || port === 995 }))
                        }}
                        className="flex-1 text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value={993}>993 — IMAP SSL</option>
                        <option value={143}>143 — IMAP STARTTLS</option>
                        <option value={465}>465 — SMTP SSL</option>
                        <option value={587}>587 — SMTP STARTTLS</option>
                        <option value={995}>995 — POP3 SSL</option>
                        <option value={110}>110 — POP3</option>
                        <option value={0}>Custom...</option>
                      </select>
                      <input
                        type="number"
                        value={imapForm.imapPort}
                        onChange={e => setImapForm(f => ({ ...f, imapPort: parseInt(e.target.value) || 993 }))}
                        className="w-20 text-sm border border-border rounded-md px-2 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground block mb-1">Password / App Password *</label>
                    <div className="relative">
                      <input
                        type={imapForm.showPass ? 'text' : 'password'}
                        value={imapForm.password}
                        onChange={e => setImapForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Your email password or app password"
                        className="w-full text-sm border border-border rounded-md px-3 py-2 pr-14 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setImapForm(f => ({ ...f, showPass: !f.showPass }))}
                        className="absolute right-2 top-1.5 text-xs text-muted-foreground hover:text-foreground px-1"
                      >
                        {imapForm.showPass ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      For Gmail: use an <strong>App Password</strong> (Google Account → Security → App Passwords).
                      For Office 365: enable SMTP AUTH in admin center.
                    </p>
                  </div>
                </div>

                {/* IMAP SSL Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Incoming SSL/TLS</p>
                    <p className="text-xs text-muted-foreground">Required for port 993.</p>
                  </div>
                  <button
                    onClick={() => setImapForm(f => ({ ...f, imapSecure: !f.imapSecure }))}
                    className={`relative w-9 h-5 rounded-full transition-colors ${imapForm.imapSecure ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${imapForm.imapSecure ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>

                {/* SMTP Section */}
                <div className="border-t border-border pt-3 space-y-3">
                  <p className="text-sm font-medium">📤 Outgoing Mail (SMTP) — for sending replies</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">SMTP Host</label>
                      <input
                        value={imapForm.smtpHost}
                        onChange={e => setImapForm(f => ({ ...f, smtpHost: e.target.value }))}
                        placeholder="send.one.com"
                        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">SMTP Port</label>
                      <select
                        value={imapForm.smtpPort}
                        onChange={e => setImapForm(f => ({ ...f, smtpPort: parseInt(e.target.value), smtpSecure: parseInt(e.target.value) === 465 }))}
                        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value={587}>587 — STARTTLS (recommended)</option>
                        <option value={465}>465 — SSL/TLS</option>
                        <option value={25}>25 — Plain</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">From Name</label>
                      <input
                        value={imapForm.smtpFromName}
                        onChange={e => setImapForm(f => ({ ...f, smtpFromName: e.target.value }))}
                        placeholder="Your Name or Business"
                        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {/* Same password toggle */}
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium">Use same password for SMTP</p>
                      <p className="text-xs text-muted-foreground">Disable if your SMTP password differs from IMAP</p>
                    </div>
                    <button
                      onClick={() => setImapForm(f => ({ ...f, smtpSamePassword: !f.smtpSamePassword }))}
                      className={`relative w-9 h-5 rounded-full transition-colors ${imapForm.smtpSamePassword ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${imapForm.smtpSamePassword ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {!imapForm.smtpSamePassword && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">SMTP Password</label>
                      <input
                        type="password"
                        value={imapForm.smtpPassword}
                        onChange={e => setImapForm(f => ({ ...f, smtpPassword: e.target.value }))}
                        placeholder="SMTP password"
                        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={testImap}
                    disabled={imapTesting || !imapForm.accountEmail || !imapForm.password || !imapForm.imapHost}
                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {imapTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Test Connection
                  </button>
                  <button
                    onClick={connectImap}
                    disabled={imapSaving || !imapForm.accountEmail || !imapForm.password || !imapForm.imapHost}
                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {imapSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Connect Account
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Email Rules */}
      {accounts.length > 0 && (
        <div className="rounded-lg border border-border p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="font-medium">Email Agent Rules</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                For each email type, choose what action your agent takes automatically.
              </p>
            </div>

            {/* Set default agent for all rules */}
            {agents.length > 0 && (
              <DefaultAgentSetter
                agents={agents}
                onApply={async (agentId) => {
                  try {
                    await Promise.all(
                      rules.map(r =>
                        api.patch(`/integrations/email-rules/${r.emailType}`, { assignedAgentId: agentId })
                      )
                    )
                    // refresh rules
                    const res = await api.get('/integrations/email-rules')
                    setRules(res.data)
                    toast.success('Default agent applied to all rules')
                  } catch {
                    toast.error('Failed to apply default agent')
                  }
                }}
              />
            )}
          </div>

          {loadingRules ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <EmailRuleRow
                  key={rule.id}
                  rule={rule}
                  agents={agents}
                  onUpdate={(updated) => {
                    setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Account Card ─────────────────────────────────────────────────────────────

function AccountCard({ account, onDisconnect }: { account: ConnectedAccount; onDisconnect: () => void }) {
  const statusColor = account.status === 'active'
    ? 'text-green-600'
    : account.status === 'expired'
    ? 'text-amber-500'
    : 'text-red-500'

  const StatusIcon = account.status === 'active' ? CheckCircle2
    : account.status === 'expired' ? AlertCircle
    : XCircle

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card">
      <div className="w-9 h-9 rounded-full bg-white border border-border flex items-center justify-center shadow-sm shrink-0">
        {account.provider === 'google' ? <GoogleIcon /> : account.provider === 'microsoft' ? <MicrosoftIcon /> : <Server className="w-4 h-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{account.accountName || account.accountEmail}</p>
          <span className={`flex items-center gap-1 text-xs ${statusColor}`}>
            <StatusIcon className="w-3.5 h-3.5" />
            {account.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {account.provider === 'google' ? 'Gmail' : account.provider === 'imap' ? `IMAP · ${account.accountEmail}` : 'Outlook'} · Connected {new Date(account.createdAt).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={onDisconnect}
        className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Disconnect"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Default Agent Setter ──────────────────────────────────────────────────────

function DefaultAgentSetter({
  agents,
  onApply,
}: {
  agents: AgentOption[]
  onApply: (agentId: string) => Promise<void>
}) {
  const [selectedId, setSelectedId] = useState('')
  const [applying, setApplying] = useState(false)

  async function apply() {
    if (!selectedId) return
    setApplying(true)
    try {
      await onApply(selectedId)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">Select agent…</option>
        {agents.map(a => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <button
        onClick={apply}
        disabled={!selectedId || applying}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
        Apply to All
      </button>
    </div>
  )
}

// ── Email Rule Row ────────────────────────────────────────────────────────────

function EmailRuleRow({
  rule,
  agents,
  onUpdate,
}: {
  rule: EmailRule & { assignedAgent?: AgentOption | null; assignedAgentId?: string | null }
  agents: AgentOption[]
  onUpdate: (r: EmailRule) => void
}) {
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [localRule, setLocalRule] = useState(rule)

  const meta = EMAIL_TYPE_LABELS[rule.emailType] ?? { label: rule.emailType, icon: '📧', description: '' }

  async function save(updates: Partial<typeof localRule>) {
    const next = { ...localRule, ...updates }
    setLocalRule(next)
    setSaving(true)
    try {
      const res = await api.patch(`/integrations/email-rules/${rule.emailType}`, {
        mode: next.mode,
        replyTemplate: next.replyTemplate,
        confidenceThreshold: next.confidenceThreshold,
        isActive: next.isActive,
        assignedAgentId: (next as any).assignedAgentId ?? null,
      })
      onUpdate(res.data)
      toast.success('Rule saved')
    } catch {
      toast.error('Failed to save rule')
      setLocalRule(rule)
    } finally {
      setSaving(false)
    }
  }

  const currentMode = MODE_OPTIONS.find(m => m.value === localRule.mode) ?? MODE_OPTIONS[2]
  const ModeIcon = currentMode.icon

  return (
    <div className={`rounded-lg border transition-colors ${localRule.isActive ? 'border-border' : 'border-border/50 opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-lg shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{meta.label}</p>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block">{meta.description}</p>
        </div>

        {/* Mode selector */}
        <select
          value={localRule.mode}
          onChange={e => save({ mode: e.target.value })}
          disabled={saving || !localRule.isActive}
          className="text-xs border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 min-w-[130px]"
        >
          {MODE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Active toggle */}
        <button
          onClick={() => save({ isActive: !localRule.isActive })}
          disabled={saving}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${localRule.isActive ? 'bg-primary' : 'bg-muted-foreground/30'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${localRule.isActive ? 'left-4' : 'left-0.5'}`} />
        </button>

        {/* Expand */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div className="flex items-center gap-6">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Min. Confidence Threshold (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={localRule.confidenceThreshold}
                onChange={e => setLocalRule(prev => ({ ...prev, confidenceThreshold: parseInt(e.target.value) || 0 }))}
                onBlur={() => save({ confidenceThreshold: localRule.confidenceThreshold })}
                className="w-20 text-sm border border-border rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1">AI must be this confident to act</p>
            </div>
          </div>

          {/* Agent selector — shown for all active modes that generate replies */}
          {(localRule.mode === 'auto_reply' || localRule.mode === 'auto_draft' || localRule.mode === 'approval_required') && agents.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assigned Agent</label>
              <select
                value={(localRule as any).assignedAgentId ?? ''}
                onChange={e => {
                  const val = e.target.value || null
                  save({ ...(localRule as any), assignedAgentId: val } as any)
                }}
                disabled={saving || !localRule.isActive}
                className="text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 w-full"
              >
                <option value="">— Auto (first active agent) —</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                This agent&apos;s persona and knowledge will be used to write replies for this email type.
              </p>
            </div>
          )}

          {(localRule.mode === 'auto_draft' || localRule.mode === 'auto_reply') && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reply Template (optional)</label>
              <textarea
                rows={4}
                value={localRule.replyTemplate ?? ''}
                onChange={e => setLocalRule(prev => ({ ...prev, replyTemplate: e.target.value }))}
                onBlur={() => save({ replyTemplate: localRule.replyTemplate })}
                placeholder="Hi {{name}},&#10;&#10;Thank you for reaching out about {{service}}...&#10;&#10;Available variables: {{name}}, {{service}}, {{subject}}"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank to let AI generate a reply automatically. Use <code className="bg-muted px-1 rounded">{'{{name}}'}</code>, <code className="bg-muted px-1 rounded">{'{{service}}'}</code>.
              </p>
            </div>
          )}

          <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
            <Zap className="w-3.5 h-3.5 inline mr-1.5 text-primary" />
            <strong>Current mode:</strong> {currentMode.label} — {currentMode.description}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
      <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
    </svg>
  )
}
