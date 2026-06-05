'use client'

import { useState, useEffect } from 'react'
import { Brain, Building2, Key, Mail, Bell, Shield, Code2 } from 'lucide-react'
import { BrainPanel } from '@/components/brain/brain-panel'
import { api } from '@/lib/api'
import { toast } from 'sonner'

const TABS = [
  { id: 'brain', label: 'Business Brain', icon: Brain },
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'widget', label: 'Chat Widget', icon: Code2 },
  { id: 'email', label: 'Email / SMTP', icon: Mail },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
]

export function SettingsTabs() {
  const [active, setActive] = useState('brain')

  return (
    <div className="flex gap-6">
      <div className="w-52 shrink-0">
        <nav className="space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                active === id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 min-w-0">
        {active === 'brain' && <BrainPanel />}
        {active === 'company' && <CompanySettings />}
        {active === 'widget' && <WidgetSettings />}
        {active === 'email' && <EmailSettings />}
        {active === 'api' && <APISettings />}
        {active === 'security' && <SecuritySettings />}
        {active === 'notifications' && <NotificationSettings />}
      </div>
    </div>
  )
}

// ?? Company ????????????????????????????????????????????????????????????????????

function CompanySettings() {
  return (
    <div className="rounded-lg border border-border p-6 space-y-4">
      <h2 className="font-semibold">Company Profile</h2>
      <div className="space-y-3">
        {[
          { label: 'Company Name', placeholder: 'Acme Roofing Inc.' },
          { label: 'Website', placeholder: 'https://acmeroofing.com' },
          { label: 'Primary Contact Email', placeholder: 'hello@acmeroofing.com' },
          { label: 'Phone Number', placeholder: '+1 (555) 000-0000' },
        ].map(({ label, placeholder }) => (
          <div key={label}>
            <label className="text-sm font-medium">{label}</label>
            <input
              placeholder={placeholder}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
        ))}
        <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
          Save changes
        </button>
      </div>
    </div>
  )
}

// ?? Email / SMTP ???????????????????????????????????????????????????????????????

function EmailSettings() {
  const [form, setForm] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'false',
    smtpUser: '',
    smtpPass: '',
    smtpFromName: '',
    smtpFromEmail: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    api
      .get('/tenants/email-settings')
      .then((r) => {
        if (r.data) {
          setForm((f) => ({
            ...f,
            smtpHost: r.data.smtpHost || '',
            smtpPort: r.data.smtpPort || '587',
            smtpSecure: r.data.smtpSecure || 'false',
            smtpUser: r.data.smtpUser || '',
            smtpPass: '',
            smtpFromName: r.data.smtpFromName || '',
            smtpFromEmail: r.data.smtpFromEmail || '',
          }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/tenants/email-settings', form)
      toast.success('Email settings saved')
    } catch {
      toast.error('Failed to save email settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/tenants/test-email', { to: testEmail || form.smtpUser })
      setTestResult(res.data)
      if (res.data.success) toast.success('Test email sent!')
      else toast.error('Connection failed: ' + res.data.message)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Test failed'
      setTestResult({ success: false, message: msg })
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* SMTP Config */}
      <div className="rounded-lg border border-border p-6 space-y-4">
        <div>
          <h2 className="font-semibold">SMTP Configuration</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Used for approval emails, team invites, and password resets. Overrides server .env defaults.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">SMTP Host</label>
            <input
              value={form.smtpHost}
              onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
              placeholder="smtp.office365.com"
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Port</label>
            <select
              value={form.smtpPort}
              onChange={(e) => setForm((f) => ({ ...f, smtpPort: e.target.value }))}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="587">587 - STARTTLS (recommended)</option>
              <option value="465">465 - SSL</option>
              <option value="25">25 - Plain</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Username / Email</label>
            <input
              value={form.smtpUser}
              onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
              placeholder="noreply@yourdomain.com"
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password / App Password</label>
            <div className="relative mt-1">
              <input
                type={showPass ? 'text' : 'password'}
                value={form.smtpPass}
                onChange={(e) => setForm((f) => ({ ...f, smtpPass: e.target.value }))}
                placeholder="Your SMTP password"
                className="w-full rounded-md border border-border bg-background px-3 py-2 pr-14 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-2 top-1.5 text-xs text-muted-foreground hover:text-foreground px-1"
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">From Name</label>
            <input
              value={form.smtpFromName}
              onChange={(e) => setForm((f) => ({ ...f, smtpFromName: e.target.value }))}
              placeholder="AI Workforce OS"
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">From Email</label>
            <input
              value={form.smtpFromEmail}
              onChange={(e) => setForm((f) => ({ ...f, smtpFromEmail: e.target.value }))}
              placeholder="noreply@yourdomain.com"
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
          <strong>Office 365 tip:</strong> Use smtp.office365.com, port 587, STARTTLS.
          Make sure SMTP AUTH is enabled in Microsoft 365 Admin Center.
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save SMTP Settings'}
        </button>
      </div>

      {/* Test Connection */}
      <div className="rounded-lg border border-border p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Test Email Connection</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Send a test email to verify your SMTP config works.
          </p>
        </div>
        <div className="flex gap-3">
          <input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder={form.smtpUser || 'Recipient email address'}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Send Test Email'}
          </button>
        </div>
        {testResult && (
          <div
            className={`p-3 rounded-lg text-sm border ${
              testResult.success
                ? 'bg-green-50 border-green-100 text-green-700'
                : 'bg-red-50 border-red-100 text-red-700'
            }`}
          >
            {testResult.success ? 'Connected: ' : 'Failed: '}
            {testResult.message}
          </div>
        )}
      </div>

      {/* What emails are sent */}
      <div className="rounded-lg border border-border p-6 space-y-3">
        <h2 className="font-semibold">Emails Sent Automatically</h2>
        {[
          { icon: 'key', label: 'Password Reset', desc: 'When a user clicks Forgot Password' },
          { icon: 'users', label: 'Team Invites', desc: 'When you invite a new team member with their temp password' },
          { icon: 'clock', label: 'Approval Required', desc: 'When an AI agent needs your sign-off on an action' },
          { icon: 'check', label: 'Approval Result', desc: 'Confirmation when an approval is approved or rejected' },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary">{item.icon[0].toUpperCase()}</span>
            </div>
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ?? API Keys ???????????????????????????????????????????????????????????????????

function APISettings() {
  const keys = [
    { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', hint: 'sk-proj-...', status: 'configured' },
    { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', hint: 'el_...', status: 'configured' },
    { key: 'TWILIO_ACCOUNT_SID', label: 'Twilio Account SID', hint: 'ACxxxx...', status: 'optional' },
  ]
  return (
    <div className="rounded-lg border border-border p-6 space-y-4">
      <div>
        <h2 className="font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Keys are stored in your .env file on the server.
        </p>
      </div>
      <div className="space-y-3">
        {keys.map(({ key, label, hint, status }) => (
          <div key={key} className="flex items-center gap-3 p-3 rounded-lg border border-border">
            <div className="flex-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground font-mono">{hint}</p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                status === 'configured'
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-yellow-500/10 text-yellow-600'
              }`}
            >
              {status === 'configured' ? 'Configured' : 'Optional'}
            </span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          To update keys, edit the{' '}
          <code className="bg-muted px-1 rounded">.env</code> file and restart the API server.
        </p>
      </div>
    </div>
  )
}

// ?? Security ???????????????????????????????????????????????????????????????????

function SecuritySettings() {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [saving, setSaving] = useState(false)

  const handleChange = async () => {
    if (form.newPassword !== form.confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (form.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSaving(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      })
      toast.success('Password changed successfully')
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <div className="rounded-lg border border-border p-6 space-y-4">
        <h2 className="font-semibold">Change Password</h2>
        {[
          { key: 'currentPassword', label: 'Current Password', placeholder: 'Your current password' },
          { key: 'newPassword', label: 'New Password', placeholder: 'Min 8 characters' },
          { key: 'confirmPassword', label: 'Confirm New Password', placeholder: 'Repeat new password' },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="text-sm font-medium">{label}</label>
            <input
              type="password"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
        <button
          onClick={handleChange}
          disabled={saving || !form.currentPassword || !form.newPassword}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </div>
  )
}

// ── Widget Settings ───────────────────────────────────────────────

function WidgetSettings() {
  const [agents, setAgents] = useState<any[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [copied, setCopied] = useState(false)
  const [widgetConfig, setWidgetConfig] = useState({
    welcomeMessage: '',
    primaryColor: '#6366f1',
    placeholder: 'Type a message...',
    collectName: false,
    collectEmail: false,
    collectPhone: false,
  })
  const [saving, setSaving] = useState(false)
  const [tenantId, setTenantId] = useState('')

  useEffect(() => {
    api.get('/agents').then(r => {
      const active = (r.data ?? []).filter((a: any) => a.status === 'ACTIVE')
      setAgents(active)
      if (active.length > 0) setSelectedAgent(active[0].id)
    })
    api.get('/auth/me').then(r => setTenantId(r.data?.tenantId ?? '')).catch(() => {})
  }, [])

  const apiUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`
    : 'http://localhost:3001/api/v1'
  const frontendUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : 'http://localhost:3000'

  const snippet = tenantId && selectedAgent
    ? `<script>\n  window.AIWORKFORCE_TENANT = "${tenantId}";\n  window.AIWORKFORCE_AGENT  = "${selectedAgent}";\n</script>\n<script src="${apiUrl}/public/widget.js" async></script>`
    : ''

  const previewUrl = tenantId && selectedAgent
    ? `${frontendUrl}/widget/${tenantId}/${selectedAgent}`
    : ''

  function copySnippet() {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveWidgetConfig() {
    setSaving(true)
    try {
      await api.patch('/tenants/settings', { widget: { ...widgetConfig, enabled: true } })
      toast.success('Widget settings saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Customer Chat Widget</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Embed a chat widget on your website so customers can talk to your AI agent in real time.
        </p>
      </div>

      {/* Agent selector */}
      <div className="rounded-lg border border-border p-5 space-y-4">
        <h3 className="font-medium">Choose Agent</h3>
        <select
          value={selectedAgent}
          onChange={e => setSelectedAgent(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
          ))}
        </select>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            Preview widget in new tab →
          </a>
        )}
      </div>

      {/* Widget customization */}
      <div className="rounded-lg border border-border p-5 space-y-4">
        <h3 className="font-medium">Customization</h3>
        <div>
          <label className="text-sm font-medium">Welcome Message</label>
          <input
            value={widgetConfig.welcomeMessage}
            onChange={e => setWidgetConfig(f => ({ ...f, welcomeMessage: e.target.value }))}
            placeholder="Hi! I'm here to help. How can I assist you today?"
            className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium">Input Placeholder</label>
            <input
              value={widgetConfig.placeholder}
              onChange={e => setWidgetConfig(f => ({ ...f, placeholder: e.target.value }))}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Primary Color</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={widgetConfig.primaryColor}
                onChange={e => setWidgetConfig(f => ({ ...f, primaryColor: e.target.value }))}
                className="w-10 h-9 rounded border border-border cursor-pointer"
              />
              <input
                value={widgetConfig.primaryColor}
                onChange={e => setWidgetConfig(f => ({ ...f, primaryColor: e.target.value }))}
                className="w-24 rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium block mb-2">Collect visitor info before chat starts</label>
          <div className="flex gap-4">
            {[['collectName', 'Name'], ['collectEmail', 'Email'], ['collectPhone', 'Phone']].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={widgetConfig[key as keyof typeof widgetConfig] as boolean}
                  onChange={e => setWidgetConfig(f => ({ ...f, [key]: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <button onClick={saveWidgetConfig} disabled={saving}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Widget Settings'}
        </button>
      </div>

      {/* Embed snippet */}
      <div className="rounded-lg border border-border p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Embed Code</h3>
          <button onClick={copySnippet}
            className="text-xs text-primary hover:underline flex items-center gap-1">
            {copied ? '✓ Copied!' : 'Copy snippet'}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste this before the closing <code className="bg-muted px-1 rounded text-xs">&lt;/body&gt;</code> tag on your website.
        </p>
        <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto select-all whitespace-pre-wrap">
          {snippet || 'Select an agent above to generate your embed code.'}
        </pre>
      </div>
    </div>
  )
}

// ── Notifications ─────────────────────────────────────────────────

function NotificationSettings() {
  return (
    <div className="rounded-lg border border-border p-6 space-y-4">
      <h2 className="font-semibold">Notification Preferences</h2>
      <div className="space-y-3">
        {[
          'Email me when an agent creates a task requiring approval',
          'Email me when an agent fails to complete a task',
          'Email me when a new team member joins',
          'Weekly AI workforce performance report',
        ].map((label) => (
          <label key={label} className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" defaultChecked className="w-4 h-4 rounded" />
            <span className="text-sm">{label}</span>
          </label>
        ))}
        <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
          Save preferences
        </button>
      </div>
    </div>
  )
}
