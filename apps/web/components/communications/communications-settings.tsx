'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'

interface CommSettings {
  twilioAccountSid: string
  twilioAuthToken: string
  twilioPhoneNumber: string
  twilioWhatsAppNumber: string
  notificationPhone: string
  notificationWhatsApp: string
  smsAgentId: string
  whatsappAgentId: string
  voiceAgentId: string
}

interface Agent {
  id: string
  name: string
  role: string
}

export function CommunicationsSettings() {
  const { user, fetchMe } = useAuthStore()
  const tenantId = user?.tenantId

  useEffect(() => {
    if (!user) fetchMe()
  }, [])

  const [settings, setSettings] = useState<CommSettings>({
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioPhoneNumber: '',
    twilioWhatsAppNumber: '',
    notificationPhone: '',
    notificationWhatsApp: '',
    smsAgentId: '',
    whatsappAgentId: '',
    voiceAgentId: '',
  })
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [showSid, setShowSid] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/communications/settings'),
      api.get('/agents'),
    ])
      .then(([sRes, aRes]) => {
        const s = sRes.data
        setSettings({
          twilioAccountSid: s.twilioAccountSid === '***configured***' ? '' : (s.twilioAccountSid || ''),
          twilioAuthToken: s.twilioAuthToken === '***configured***' ? '' : (s.twilioAuthToken || ''),
          twilioPhoneNumber: s.twilioPhoneNumber || '',
          twilioWhatsAppNumber: s.twilioWhatsAppNumber || '',
          notificationPhone: s.notificationPhone || '',
          notificationWhatsApp: s.notificationWhatsApp || '',
          smsAgentId: s.smsAgentId || '',
          whatsappAgentId: s.whatsappAgentId || '',
          voiceAgentId: s.voiceAgentId || '',
        })
        setAgents(aRes.data || [])
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, string> = {}
      Object.entries(settings).forEach(([k, v]) => {
        if (v) payload[k] = v
      })
      await api.put('/communications/settings', payload)
      toast.success('Communications settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // Persist form credentials first so the API can read them (or fall back to .env)
      const payload: Record<string, string> = {}
      Object.entries(settings).forEach(([k, v]) => {
        if (v) payload[k] = v
      })
      if (Object.keys(payload).length) {
        await api.put('/communications/settings', payload)
      }

      const res = await api.post('/communications/test-connection')
      setTestResult(`Connected: ${res.data.friendlyName} (${res.data.status})`)
      toast.success('Twilio connection verified!')
    } catch (err: unknown) {
      const axiosErr = err as {
        message?: string
        code?: string
        response?: { data?: { message?: string | string[] }; status?: number }
      }
      let message = 'Connection failed'
      if (!axiosErr.response) {
        message =
          'Cannot reach API (Network Error). Start the backend on port 3001, then retry.'
      } else if (Array.isArray(axiosErr.response.data?.message)) {
        message = axiosErr.response.data.message.join(', ')
      } else if (typeof axiosErr.response.data?.message === 'string') {
        message = axiosErr.response.data.message
      } else if (axiosErr.message) {
        message = axiosErr.message
      }
      setTestResult(message)
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Local API base (browser → Nest). For Twilio webhooks use a public tunnel URL.
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`
      : 'http://localhost:3001/api/v1')
  // Set NEXT_PUBLIC_WEBHOOK_BASE=https://xxxx.ngrok-free.app/api/v1 when using ngrok
  const webhookBase = (process.env.NEXT_PUBLIC_WEBHOOK_BASE || apiBase).replace(/\/$/, '')
  const hasValidTenant = Boolean(tenantId)
  const hasAgents = agents.length > 0

  return (
    <div className="space-y-8 max-w-3xl">
      {(!hasValidTenant || !hasAgents) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">Inbound WhatsApp checklist</p>
          {!hasValidTenant && (
            <p>Tenant ID is missing — log in again so webhook URLs include a real <code className="font-mono">tenantId</code>.</p>
          )}
          {!hasAgents && (
            <p>
              This tenant has <strong>no AI agents</strong>. Platform Admin is empty — use a company tenant
              (e.g. Stormbuddy) that already has agents, or create an agent under <strong>AI Workforce</strong>, then
              paste that tenant&apos;s WhatsApp webhook URL into Twilio Sandbox settings.
            </p>
          )}
          <p className="text-amber-800/90">
            Twilio cannot call <code className="font-mono">localhost</code>. Set{' '}
            <code className="font-mono">NEXT_PUBLIC_WEBHOOK_BASE</code> to your ngrok HTTPS URL +{' '}
            <code className="font-mono">/api/v1</code>, restart the web app, then copy the WhatsApp webhook below.
          </p>
        </div>
      )}

      {/* Twilio Credentials */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm0 16a2.5 2.5 0 110-5 2.5 2.5 0 010 5zm4-8.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5zm-8 0a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Twilio Credentials</h3>
            <p className="text-sm text-gray-500">Required for SMS, WhatsApp, and Voice calls</p>
          </div>
          <a
            href="https://console.twilio.com"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-blue-600 hover:underline"
          >
            Get credentials →
          </a>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account SID</label>
              <div className="relative">
                <input
                  type={showSid ? 'text' : 'password'}
                  value={settings.twilioAccountSid}
                  onChange={(e) => setSettings((s) => ({ ...s, twilioAccountSid: e.target.value }))}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={() => setShowSid(!showSid)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 text-xs">
                  {showSid ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Auth Token</label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={settings.twilioAuthToken}
                  onChange={(e) => setSettings((s) => ({ ...s, twilioAuthToken: e.target.value }))}
                  placeholder="Your auth token"
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 text-xs">
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMS Phone Number</label>
              <input
                type="text"
                value={settings.twilioPhoneNumber}
                onChange={(e) => setSettings((s) => ({ ...s, twilioPhoneNumber: e.target.value }))}
                placeholder="+15551234567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
              <input
                type="text"
                value={settings.twilioWhatsAppNumber}
                onChange={(e) => setSettings((s) => ({ ...s, twilioWhatsAppNumber: e.target.value }))}
                placeholder="+15551234567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Must be enabled in Twilio WhatsApp sandbox</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.startsWith('Connected') ? 'text-green-600' : 'text-red-500'}`}>
                {testResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Webhook URLs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Twilio Webhook URLs</h3>
          <p className="text-sm text-gray-500">
            Paste into Twilio Sandbox / phone number → When a message comes in (HTTP POST).
            {webhookBase.includes('localhost') && (
              <span className="block mt-1 text-amber-600">
                Showing localhost — Twilio needs a public URL. Use ngrok and set NEXT_PUBLIC_WEBHOOK_BASE.
              </span>
            )}
          </p>
          {hasValidTenant && (
            <p className="text-xs text-gray-500 mt-1 font-mono">tenantId={tenantId}</p>
          )}
        </div>
        <div className="p-6 space-y-3">
          {[
            { label: 'SMS Inbound', path: `/communications/sms/inbound?tenantId=${tenantId ?? '{YOUR_TENANT_ID}'}` },
            { label: 'WhatsApp Inbound', path: `/communications/whatsapp/inbound?tenantId=${tenantId ?? '{YOUR_TENANT_ID}'}` },
            { label: 'Voice Inbound', path: `/communications/voice/inbound?tenantId=${tenantId ?? '{YOUR_TENANT_ID}'}` },
            { label: 'Voice Gather (mid-call)', path: `/communications/voice/gather?tenantId=${tenantId ?? '{YOUR_TENANT_ID}'}` },
          ].map((item) => {
            const fullUrl = `${webhookBase}${item.path}`
            return (
              <div key={item.label} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{item.label}</span>
                  <div className="mt-0.5 font-mono text-xs text-gray-800 break-all">
                    {fullUrl}
                  </div>
                </div>
                <span className="shrink-0 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">HTTP POST</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(fullUrl)
                    toast.success('Copied!')
                  }}
                  className="shrink-0 text-xs text-gray-400 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded hover:bg-white transition-colors"
                >
                  Copy
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Agent Routing */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Channel Agent Routing</h3>
          <p className="text-sm text-gray-500">Which AI agent handles each communication channel</p>
        </div>
        <div className="p-6 space-y-4">
          {[
            { key: 'smsAgentId', label: 'SMS Agent', icon: '💬', desc: 'Handles all inbound SMS messages' },
            { key: 'whatsappAgentId', label: 'WhatsApp Agent', icon: '📱', desc: 'Handles all inbound WhatsApp messages' },
            { key: 'voiceAgentId', label: 'Voice / Call Agent', icon: '📞', desc: 'Handles all inbound phone calls' },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-4">
              <div className="w-8 h-8 flex items-center justify-center text-lg">{item.icon}</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-800">{item.label}</div>
                <div className="text-xs text-gray-400">{item.desc}</div>
              </div>
              <select
                value={settings[item.key as keyof CommSettings]}
                onChange={(e) => setSettings((s) => ({ ...s, [item.key]: e.target.value }))}
                className="w-48 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Auto (first active) --</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Notification Routing */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Notification Recipients</h3>
          <p className="text-sm text-gray-500">Where to send approval requests and system alerts</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alert via SMS</label>
              <input
                type="text"
                value={settings.notificationPhone}
                onChange={(e) => setSettings((s) => ({ ...s, notificationPhone: e.target.value }))}
                placeholder="+15551234567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">Owner/admin receives approval alerts here</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alert via WhatsApp</label>
              <input
                type="text"
                value={settings.notificationWhatsApp}
                onChange={(e) => setSettings((s) => ({ ...s, notificationWhatsApp: e.target.value }))}
                placeholder="+15551234567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
