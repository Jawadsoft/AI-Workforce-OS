'use client'
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'

function getApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001/api/v1`
  }
  return 'http://localhost:3001/api/v1'
}

function useSAApi() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sa_access_token') : ''
  return axios.create({
    baseURL: getApiBase(),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
}

// ── Constants ─────────────────────────────────────────────────────

const INDUSTRIES = [
  { value: 'ROOFING', label: 'Roofing & Storm Damage' },
  { value: 'HVAC', label: 'HVAC & Home Services' },
  { value: 'CLEANING', label: 'Cleaning Services' },
  { value: 'SECURITY', label: 'Security Services' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'HUMAN_RESOURCES', label: 'Human Resources & Staffing' },
  { value: 'LANDSCAPING', label: 'Landscaping & Lawn Care' },
  { value: 'PEST_CONTROL', label: 'Pest Control' },
  { value: 'CONSTRUCTION', label: 'Construction' },
  { value: 'HEALTHCARE', label: 'Healthcare' },
  { value: 'PROPERTY_MANAGEMENT', label: 'Property Management' },
  { value: 'CAR_DEALERSHIP', label: 'Car Dealership' },
  { value: 'OTHER', label: 'Other' },
]

const CRM_PROVIDERS = [
  { value: 'STORMBUDDI', label: 'StormBuddi', needsUrl: false },
  { value: 'HUBSPOT', label: 'HubSpot', needsUrl: false },
  { value: 'JOBNIMBUS', label: 'JobNimbus', needsUrl: false },
  { value: 'LARAVEL', label: 'Laravel CRM', needsUrl: true },
  { value: 'SALESFORCE', label: 'Salesforce', needsUrl: true },
  { value: 'ZOHO', label: 'Zoho CRM', needsUrl: false },
  { value: 'CUSTOM', label: 'Custom API', needsUrl: true },
]

const INDUSTRY_CRM_MAP: Record<string, string[]> = {
  ROOFING: ['STORMBUDDI', 'JOBNIMBUS'],
  HVAC: ['JOBNIMBUS', 'LARAVEL'],
  CLEANING: ['LARAVEL', 'CUSTOM'],
  SECURITY: ['SALESFORCE', 'ZOHO'],
  REAL_ESTATE: ['HUBSPOT', 'SALESFORCE'],
  INSURANCE: ['SALESFORCE', 'HUBSPOT'],
  HUMAN_RESOURCES: ['HUBSPOT', 'ZOHO'],
  LANDSCAPING: ['LARAVEL', 'CUSTOM'],
  PEST_CONTROL: ['LARAVEL', 'CUSTOM'],
  CONSTRUCTION: ['JOBNIMBUS', 'SALESFORCE'],
  HEALTHCARE: ['SALESFORCE', 'CUSTOM'],
  PROPERTY_MANAGEMENT: ['HUBSPOT', 'CUSTOM'],
  CAR_DEALERSHIP: ['HUBSPOT', 'SALESFORCE'],
  OTHER: ['CUSTOM'],
}

// ── Types ─────────────────────────────────────────────────────────

interface Stats { tenants: number; agents: number; conversations: number; users: number }
interface Tenant {
  id: string; name: string; slug: string; industry: string | null
  isActive: boolean; isApproved: boolean; createdAt: string
  owner: { name: string; email: string; isActive: boolean } | null
  stats: { agents: number; conversations: number; users: number }
}
interface PendingTenant {
  id: string; name: string; slug: string; industry: string | null; createdAt: string
  owner: { name: string; email: string } | null
}
interface Template {
  id: string; name: string; role: string; description: string
  industries: string[]; isPublic: boolean; avatar?: string; tools: string[]
}
interface TenantAgent { id: string; name: string; role: string; status: string }

const emptyConfig = { industry: '', crmProvider: '', crmName: '', crmBaseUrl: '', crmApiKey: '' }

const TABS = ['Overview', 'Approvals', 'Tenants', 'Marketplace']

const ALL_FEATURE_FLAGS = [
  { key: 'widget',               label: 'Website Widget',           desc: 'Public chat widget embed' },
  { key: 'document_generation',  label: 'Document Generation',      desc: 'AI-generated PDFs & estimates' },
  { key: 'crm_integration',      label: 'CRM Integration',          desc: 'CRM connectors & data sync' },
  { key: 'email_scanner',        label: 'Email Scanner',            desc: 'Gmail/IMAP inbox monitoring' },
  { key: 'twilio_communications',label: 'SMS / WhatsApp / Voice',   desc: 'Twilio SMS, WhatsApp and phone' },
  { key: 'storm_data',           label: 'Storm Data (NOAA)',        desc: 'Hail/tornado/wind reports for agents' },
  { key: 'marketplace',          label: 'Agent Marketplace',        desc: 'Template agent library' },
  { key: 'file_uploads',         label: 'File & Image Uploads',     desc: 'Attach images/docs in chat (vision)' },
  { key: 'social_media',         label: 'Social Media',            desc: 'AI post generation & scheduling' },
  { key: 'blog_generation',      label: 'Blog Generation',          desc: 'AI blog writing & CMS publishing' },
  { key: 'google_reviews',       label: 'Google Reviews',           desc: 'Review monitoring & reply drafts' },
  { key: 'follow_up_sequences',  label: 'Follow-up Sequences',      desc: 'Automated email/SMS follow-up campaigns' },
  { key: 'calendar_integration', label: 'Calendar Integration',     desc: 'Google/Outlook real calendar booking' },
  { key: 'sms_tools',            label: 'SMS Tool Access',          desc: 'Full tool suite on SMS/WhatsApp channels' },
  { key: 'agent_analytics',      label: 'Agent Analytics Queries',  desc: 'Agents can answer analytics questions' },
]

// ── Glassmorphism style helpers ───────────────────────────────────

const glass = {
  card: {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.08)',
  } as React.CSSProperties,
  cardElevated: {
    background: 'rgba(255,255,255,0.06)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.10)',
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
  } as React.CSSProperties,
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.10)',
  } as React.CSSProperties,
  inputFocus: {
    background: 'rgba(255,255,255,0.09)',
    border: '1px solid rgba(255,255,255,0.28)',
  } as React.CSSProperties,
}

export default function SuperAdminDashboard() {
  const router = useRouter()
  const [tab, setTab] = useState('Overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [pendingTenants, setPendingTenants] = useState<PendingTenant[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTenant, setSearchTenant] = useState('')
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [configForm, setConfigForm] = useState(emptyConfig)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [widgetTenant, setWidgetTenant] = useState<Tenant | null>(null)
  const [widgetAgents, setWidgetAgents] = useState<TenantAgent[]>([])
  const [widgetLoading, setWidgetLoading] = useState(false)
  const [copiedLink, setCopiedLink] = useState('')
  const [featureTenant, setFeatureTenant] = useState<Tenant | null>(null)
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({})
  const [featureSaving, setFeatureSaving] = useState(false)

  const api = useSAApi()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, tenantsRes, templatesRes, pendingRes] = await Promise.all([
        api.get('/super-admin/stats'),
        api.get('/super-admin/tenants'),
        api.get('/super-admin/templates'),
        api.get('/super-admin/tenants/pending'),
      ])
      setStats(statsRes.data)
      setTenants(tenantsRes.data)
      setTemplates(templatesRes.data)
      setPendingTenants(pendingRes.data)
    } catch {
      router.replace('/super-admin/login')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  async function toggleTenant(id: string, isActive: boolean) {
    await api.post(`/super-admin/tenants/${id}/${isActive ? 'suspend' : 'activate'}`)
    loadData()
  }

  async function deleteTenant(id: string) {
    if (!confirm('Permanently delete this tenant? All data will be lost.')) return
    await api.delete(`/super-admin/tenants/${id}`)
    loadData()
  }

  async function openFeatureFlags(tenant: Tenant) {
    setFeatureTenant(tenant)
    try {
      const res = await api.get(`/super-admin/tenants/${tenant.id}/features`)
      const flagMap: Record<string, boolean> = {}
      for (const f of ALL_FEATURE_FLAGS) flagMap[f.key] = false
      for (const flag of res.data) { if (flag.enabled) flagMap[flag.feature] = true }
      if (!res.data.find((f: any) => f.feature === 'widget')) flagMap['widget'] = true
      if (!res.data.find((f: any) => f.feature === 'document_generation')) flagMap['document_generation'] = true
      if (!res.data.find((f: any) => f.feature === 'marketplace')) flagMap['marketplace'] = true
      setFeatureFlags(flagMap)
    } catch { setFeatureFlags({}) }
  }

  async function saveFeatureFlags() {
    if (!featureTenant) return
    setFeatureSaving(true)
    try {
      await Promise.all(
        Object.entries(featureFlags).map(([feature, enabled]) =>
          api.post(`/super-admin/tenants/${featureTenant.id}/features`, { feature, enabled })
        )
      )
      setFeatureTenant(null)
    } catch { /* ignore */ } finally { setFeatureSaving(false) }
  }

  async function approveTenant(id: string) {
    await api.post(`/super-admin/tenants/${id}/approve`)
    loadData()
  }

  async function rejectTenant(id: string) {
    if (!confirm('Reject this signup? The account will be permanently removed.')) return
    await api.post(`/super-admin/tenants/${id}/reject`)
    loadData()
  }

  async function toggleTemplate(id: string) {
    await api.post(`/super-admin/templates/${id}/toggle-visibility`)
    loadData()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await api.delete(`/super-admin/templates/${id}`)
    loadData()
  }

  async function openWidgetModal(t: Tenant) {
    setWidgetTenant(t)
    setWidgetAgents([])
    setWidgetLoading(true)
    try {
      const res = await api.get(`/super-admin/tenants/${t.id}`)
      setWidgetAgents((res.data.agents ?? []).filter((a: TenantAgent) => a.status === 'ACTIVE'))
    } catch {
      setWidgetAgents([])
    } finally {
      setWidgetLoading(false)
    }
  }

  function openConfigModal(t: Tenant) {
    setEditingTenant(t)
    setConfigForm({ industry: t.industry ?? '', crmProvider: '', crmName: '', crmBaseUrl: '', crmApiKey: '' })
    setConfigError('')
  }

  async function saveConfig() {
    if (!editingTenant) return
    setConfigSaving(true)
    setConfigError('')
    try {
      const payload: any = {}
      if (configForm.industry) payload.industry = configForm.industry
      if (configForm.crmProvider) payload.crmProvider = configForm.crmProvider
      if (configForm.crmName) payload.crmName = configForm.crmName
      if (configForm.crmBaseUrl) payload.crmBaseUrl = configForm.crmBaseUrl
      if (configForm.crmApiKey) payload.crmApiKey = configForm.crmApiKey
      await api.patch(`/super-admin/tenants/${editingTenant.id}/config`, payload)
      setEditingTenant(null)
      loadData()
    } catch (e: any) {
      setConfigError(e.response?.data?.message || 'Failed to save')
    } finally {
      setConfigSaving(false)
    }
  }

  function signOut() {
    localStorage.removeItem('sa_access_token')
    router.replace('/super-admin/login')
  }

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(searchTenant.toLowerCase()) ||
    t.owner?.email.toLowerCase().includes(searchTenant.toLowerCase())
  )

  const selectedCRMProvider = CRM_PROVIDERS.find(p => p.value === configForm.crmProvider)
  const recommendedCRMs = configForm.industry ? (INDUSTRY_CRM_MAP[configForm.industry] ?? []) : []

  return (
    <div className="flex h-screen text-white">
      {/* Sidebar */}
      <aside
        className="w-60 flex flex-col shrink-0"
        style={{
          background: 'rgba(255,255,255,0.03)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="p-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Super Admin</p>
              <p className="text-xs text-gray-500">Platform Control</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between"
              style={tab === t ? {
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff',
              } : {
                color: 'rgba(255,255,255,0.5)',
                border: '1px solid transparent',
              }}
              onMouseEnter={e => {
                if (tab !== t) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
                }
              }}
              onMouseLeave={e => {
                if (tab !== t) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
                }
              }}
            >
              <span>{t}</span>
              {t === 'Approvals' && pendingTenants.length > 0 && (
                <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {pendingTenants.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            onClick={signOut}
            className="w-full text-left text-sm text-gray-500 hover:text-red-400 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : (
          <>
            {tab === 'Overview' && <OverviewTab stats={stats} tenants={tenants} pendingCount={pendingTenants.length} onViewApprovals={() => setTab('Approvals')} />}
            {tab === 'Approvals' && <ApprovalsTab tenants={pendingTenants} onApprove={approveTenant} onReject={rejectTenant} />}
            {tab === 'Tenants' && (
              <TenantsTab
                tenants={filteredTenants}
                search={searchTenant}
                onSearch={setSearchTenant}
                onToggle={toggleTenant}
                onDelete={deleteTenant}
                onConfigure={openConfigModal}
                onWidget={openWidgetModal}
                onFeatures={openFeatureFlags}
              />
            )}
            {tab === 'Marketplace' && (
              <MarketplaceTab
                templates={templates}
                onToggle={toggleTemplate}
                onDelete={deleteTemplate}
                showNew={showNewTemplate}
                setShowNew={setShowNewTemplate}
                api={api}
                refresh={loadData}
              />
            )}
          </>
        )}
      </main>

      {/* Widget Links Modal */}
      {widgetTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg rounded-2xl p-6 space-y-5" style={glass.cardElevated}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Widget Links</h2>
                <p className="text-sm text-gray-400 mt-0.5">{widgetTenant.name} — copy a link to test or embed</p>
              </div>
              <button
                onClick={() => setWidgetTenant(null)}
                className="text-gray-500 hover:text-white text-xl leading-none transition-colors"
              >×</button>
            </div>

            {widgetLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'transparent' }} />
              </div>
            ) : widgetAgents.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-6">No active agents found for this tenant.</p>
            ) : (
              <div className="space-y-3">
                {widgetAgents.map(agent => {
                  const frontendBase = typeof window !== 'undefined'
                    ? `${window.location.protocol}//${window.location.hostname}:3000`
                    : 'http://localhost:3000'
                  const widgetLink = `${frontendBase}/widget/${widgetTenant.id}/${agent.id}`
                  const isCopied = copiedLink === agent.id

                  return (
                    <div key={agent.id} className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-white text-sm">{agent.name}</p>
                          <p className="text-xs text-gray-400">{agent.role}</p>
                        </div>
                        <div className="flex gap-2">
                          <a
                            href={widgetLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs px-2.5 py-1.5 rounded-lg transition-colors text-gray-300 hover:text-white"
                            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)' }}
                          >
                            Preview
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(widgetLink)
                              setCopiedLink(agent.id)
                              setTimeout(() => setCopiedLink(''), 2000)
                            }}
                            className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium ${isCopied ? 'text-green-400' : 'text-gray-300 hover:text-white'}`}
                            style={{ background: isCopied ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isCopied ? 'rgba(74,222,128,0.20)' : 'rgba(255,255,255,0.10)'}` }}
                          >
                            {isCopied ? 'Copied!' : 'Copy Link'}
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 font-mono break-all rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        {widgetLink}
                      </p>
                    </div>
                  )
                })}

                <div className="mt-4 pt-4 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Embed Snippet (first agent)</p>
                  {widgetAgents[0] && (() => {
                    const apiBase = typeof window !== 'undefined'
                      ? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`
                      : 'http://localhost:3001/api/v1'
                    const snippet = `<script>\n  window.AIWORKFORCE_TENANT = "${widgetTenant.id}";\n  window.AIWORKFORCE_AGENT  = "${widgetAgents[0].id}";\n</script>\n<script src="${apiBase}/public/widget.js" async></script>`
                    return (
                      <div className="relative">
                        <pre className="rounded-lg p-3 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono" style={{ background: 'rgba(0,0,0,0.4)' }}>
                          {snippet}
                        </pre>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(snippet)
                            setCopiedLink('snippet')
                            setTimeout(() => setCopiedLink(''), 2000)
                          }}
                          className="absolute top-2 right-2 text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
                          style={{ background: 'rgba(255,255,255,0.08)' }}
                        >
                          {copiedLink === 'snippet' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feature Flags Modal */}
      {featureTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" style={glass.cardElevated}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Feature Flags</h2>
                <p className="text-sm text-gray-400 mt-0.5">{featureTenant.name} — enable or disable platform features</p>
              </div>
              <button onClick={() => setFeatureTenant(null)} className="text-gray-500 hover:text-white text-xl leading-none transition-colors">×</button>
            </div>

            <div className="space-y-2">
              {ALL_FEATURE_FLAGS.map(f => (
                <div
                  key={f.key}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div>
                    <p className="text-sm font-medium text-white">{f.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{f.desc}</p>
                  </div>
                  <button
                    onClick={() => setFeatureFlags(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                    className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
                    style={{ background: featureFlags[f.key] ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)' }}
                  >
                    <span
                      className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                      style={{ transform: featureFlags[f.key] ? 'translateX(24px)' : 'translateX(4px)' }}
                    />
                  </button>
                </div>
              ))}
            </div>

            <div className="rounded-lg px-4 py-3 text-xs text-gray-400" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              Changes take effect immediately. The tenant's UI will update on their next page load.
            </div>

            <div className="flex gap-3 pt-1">
              <GlassButton onClick={saveFeatureFlags} disabled={featureSaving} variant="primary" className="flex-1">
                {featureSaving ? 'Saving...' : 'Save Feature Flags'}
              </GlassButton>
              <GlassButton onClick={() => setFeatureTenant(null)} variant="secondary" className="flex-1">
                Cancel
              </GlassButton>
            </div>
          </div>
        </div>
      )}

      {/* Configure Tenant Modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto" style={glass.cardElevated}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Configure Tenant</h2>
                <p className="text-sm text-gray-400 mt-0.5">{editingTenant.name} — set industry & CRM access</p>
              </div>
              <button onClick={() => setEditingTenant(null)} className="text-gray-500 hover:text-white text-xl leading-none transition-colors">×</button>
            </div>

            {/* Industry */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Industry</label>
              <GlassSelect
                value={configForm.industry}
                onChange={v => setConfigForm(f => ({ ...f, industry: v, crmProvider: '' }))}
              >
                <option value="">-- Select Industry --</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </GlassSelect>
            </div>

            {/* CRM Setup */}
            <div className="space-y-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">CRM Connection</label>

              {recommendedCRMs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-gray-500">Recommended for {configForm.industry}:</span>
                  {recommendedCRMs.map(crm => (
                    <button
                      key={crm}
                      onClick={() => setConfigForm(f => ({ ...f, crmProvider: crm }))}
                      className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                      style={configForm.crmProvider === crm
                        ? { background: 'rgba(255,255,255,0.20)', border: '1px solid rgba(255,255,255,0.30)', color: '#fff' }
                        : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }
                      }
                    >
                      {crm}
                    </button>
                  ))}
                </div>
              )}

              <GlassSelect
                value={configForm.crmProvider}
                onChange={v => setConfigForm(f => ({ ...f, crmProvider: v }))}
              >
                <option value="">-- Select CRM Provider --</option>
                {CRM_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </GlassSelect>

              {configForm.crmProvider && (
                <div className="space-y-3 rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <GlassInput
                    label="Connection Name (optional)"
                    placeholder={`${configForm.crmProvider} — ${editingTenant.name}`}
                    value={configForm.crmName}
                    onChange={v => setConfigForm(f => ({ ...f, crmName: v }))}
                  />
                  {selectedCRMProvider?.needsUrl && (
                    <GlassInput
                      label="Base URL"
                      placeholder="https://yourcrm.com/api"
                      value={configForm.crmBaseUrl}
                      onChange={v => setConfigForm(f => ({ ...f, crmBaseUrl: v }))}
                    />
                  )}
                  <GlassInput
                    label="API Key / Bearer Token *"
                    placeholder="sk_live_..."
                    value={configForm.crmApiKey}
                    onChange={v => setConfigForm(f => ({ ...f, crmApiKey: v }))}
                    type="password"
                  />
                  <p className="text-xs text-gray-500">* Required to create/update the CRM connection for this tenant</p>
                </div>
              )}
            </div>

            {configError && (
              <div className="rounded-xl bg-red-500/10 border border-red-400/25 px-4 py-2.5 text-red-300 text-sm">
                {configError}
              </div>
            )}

            <div className="rounded-lg px-4 py-3 text-xs text-gray-400" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              Setting the industry will automatically apply recommended CRM tool permissions to all active agents for this tenant.
            </div>

            <div className="flex gap-3 pt-1">
              <GlassButton
                onClick={saveConfig}
                disabled={configSaving || (!configForm.industry && !configForm.crmProvider)}
                variant="primary"
                className="flex-1"
              >
                {configSaving ? 'Saving...' : 'Save Configuration'}
              </GlassButton>
              <GlassButton onClick={() => setEditingTenant(null)} variant="secondary" className="flex-1">
                Cancel
              </GlassButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared Glass UI primitives ────────────────────────────────────

function GlassInput({ label, placeholder, value, onChange, type = 'text' }: {
  label: string; placeholder?: string; value: string
  onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-white placeholder-gray-600 text-sm outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
        onFocus={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
          e.currentTarget.style.border = '1px solid rgba(255,255,255,0.25)'
        }}
        onBlur={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
          e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)'
        }}
      />
    </div>
  )
}

function GlassSelect({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-all cursor-pointer"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {children}
    </select>
  )
}

function GlassButton({ children, onClick, disabled, variant = 'secondary', className = '' }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  className?: string
}) {
  const base = variant === 'primary'
    ? { background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)', border: '1px solid rgba(255,255,255,0.15)' }
    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-semibold py-2.5 rounded-xl text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white ${className}`}
      style={base}
      onMouseEnter={e => {
        if (!disabled) e.currentTarget.style.background = variant === 'primary'
          ? 'linear-gradient(135deg, #4b5563 0%, #374151 100%)'
          : 'rgba(255,255,255,0.10)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = base.background
      }}
    >
      {children}
    </button>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ stats, tenants, pendingCount, onViewApprovals }: {
  stats: Stats | null; tenants: Tenant[]; pendingCount: number; onViewApprovals: () => void
}) {
  const statCards = [
    { label: 'Total Tenants', value: stats?.tenants ?? 0, color: 'text-gray-200' },
    { label: 'Total Agents', value: stats?.agents ?? 0, color: 'text-emerald-400' },
    { label: 'Conversations', value: stats?.conversations ?? 0, color: 'text-blue-400' },
    { label: 'Total Users', value: stats?.users ?? 0, color: 'text-purple-400' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
        <p className="text-gray-400 mt-1">Real-time platform statistics</p>
      </div>

      {pendingCount > 0 && (
        <div
          onClick={onViewApprovals}
          className="flex items-center justify-between rounded-xl px-5 py-4 cursor-pointer transition-all"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.20)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.12)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.08)')}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'rgba(251,191,36,0.15)' }}>
              <span className="text-amber-400 text-lg font-bold">!</span>
            </div>
            <div>
              <p className="text-amber-300 font-semibold text-sm">{pendingCount} signup{pendingCount > 1 ? 's' : ''} awaiting approval</p>
              <p className="text-amber-500/70 text-xs">Review and approve new tenant registrations</p>
            </div>
          </div>
          <span className="text-amber-400 text-sm font-medium">Review →</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="rounded-xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-sm text-gray-400">{card.label}</p>
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>{card.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4 text-white">Recent Tenants</h2>
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Industry</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Agents</th>
              </tr>
            </thead>
            <tbody>
              {tenants.slice(0, 8).map(t => (
                <tr key={t.id} className="transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 font-medium text-white">{t.name}</td>
                  <td className="px-4 py-3 text-gray-400">{t.industry ?? 'N/A'}</td>
                  <td className="px-4 py-3 text-gray-400">{t.owner?.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                      {t.isActive ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.stats.agents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Approvals Tab ─────────────────────────────────────────────────

function ApprovalsTab({ tenants, onApprove, onReject }: {
  tenants: PendingTenant[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Pending Approvals</h1>
        <p className="text-gray-400 mt-1">
          {tenants.length === 0 ? 'No pending signups — all caught up!' : `${tenants.length} signup${tenants.length > 1 ? 's' : ''} waiting for review`}
        </p>
      </div>

      {tenants.length === 0 ? (
        <div className="rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.10)' }}>
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-gray-300 font-medium">All caught up</p>
          <p className="text-gray-500 text-sm">No pending tenant approvals at this time.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(t => (
            <div key={t.id} className="rounded-xl p-5 flex items-center justify-between gap-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-400 font-bold text-sm shrink-0" style={{ background: 'rgba(251,191,36,0.10)' }}>
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{t.name}</p>
                  <p className="text-sm text-gray-400 truncate">{t.owner?.email ?? 'No owner'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {t.industry && (
                      <span className="text-xs px-2 py-0.5 rounded-full text-gray-300" style={{ background: 'rgba(255,255,255,0.08)' }}>{t.industry}</span>
                    )}
                    <span className="text-xs text-gray-600">
                      Registered {new Date(t.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onApprove(t.id)} className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  Approve
                </button>
                <button onClick={() => onReject(t.id)} className="text-red-400 hover:text-red-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)' }}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tenants Tab ───────────────────────────────────────────────────

function TenantsTab({ tenants, search, onSearch, onToggle, onDelete, onConfigure, onWidget, onFeatures }: {
  tenants: Tenant[]
  search: string
  onSearch: (v: string) => void
  onToggle: (id: string, isActive: boolean) => void
  onDelete: (id: string) => void
  onConfigure: (t: Tenant) => void
  onWidget: (t: Tenant) => void
  onFeatures: (t: Tenant) => void
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenant Management</h1>
          <p className="text-gray-400 mt-1">{tenants.length} tenants total</p>
        </div>
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search tenants..."
          className="rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 outline-none transition-all w-64"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
          onFocus={e => {
            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.25)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
          }}
          onBlur={e => {
            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)'
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
          }}
        />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <th className="text-left px-4 py-3">Company</th>
              <th className="text-left px-4 py-3">Industry</th>
              <th className="text-left px-4 py-3">Owner</th>
              <th className="text-left px-4 py-3">Users</th>
              <th className="text-left px-4 py-3">Agents</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr
                key={t.id}
                className="transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{t.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.slug}</p>
                </td>
                <td className="px-4 py-3">
                  {t.industry ? (
                    <span className="text-xs px-2 py-0.5 rounded-full text-gray-300" style={{ background: 'rgba(255,255,255,0.08)' }}>{t.industry}</span>
                  ) : (
                    <span className="text-gray-600 text-xs">Not set</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-gray-300">{t.owner?.name ?? '—'}</p>
                  <p className="text-xs text-gray-500">{t.owner?.email ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-gray-400">{t.stats.users}</td>
                <td className="px-4 py-3 text-gray-400">{t.stats.agents}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${t.isActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                      {t.isActive ? 'Active' : 'Suspended'}
                    </span>
                    {!t.isApproved && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium w-fit bg-amber-900/30 text-amber-400">
                        Pending
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { label: 'Widget', color: 'rgba(168,85,247,0.12)', textColor: '#c084fc', hoverBg: 'rgba(168,85,247,0.20)', onClick: () => onWidget(t) },
                      { label: 'Configure', color: 'rgba(255,255,255,0.08)', textColor: 'rgba(255,255,255,0.7)', hoverBg: 'rgba(255,255,255,0.12)', onClick: () => onConfigure(t) },
                      { label: 'Features', color: 'rgba(168,85,247,0.12)', textColor: '#c084fc', hoverBg: 'rgba(168,85,247,0.20)', onClick: () => onFeatures(t) },
                    ].map(btn => (
                      <button
                        key={btn.label}
                        onClick={btn.onClick}
                        className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                        style={{ background: btn.color, color: btn.textColor, border: '1px solid rgba(255,255,255,0.06)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = btn.hoverBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = btn.color)}
                      >
                        {btn.label}
                      </button>
                    ))}
                    <button
                      onClick={() => onToggle(t.id, t.isActive)}
                      className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                      style={t.isActive
                        ? { background: 'rgba(234,179,8,0.12)', color: '#fbbf24', border: '1px solid rgba(255,255,255,0.06)' }
                        : { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(255,255,255,0.06)' }
                      }
                    >
                      {t.isActive ? 'Suspend' : 'Activate'}
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Marketplace Tab ───────────────────────────────────────────────

function MarketplaceTab({ templates, onToggle, onDelete, showNew, setShowNew, api, refresh }: {
  templates: Template[]
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  showNew: boolean
  setShowNew: (v: boolean) => void
  api: any
  refresh: () => void
}) {
  const [form, setForm] = useState({ name: '', role: '', description: '', defaultPrompt: '', tools: '', industries: '', avatar: '', isPublic: true })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  async function saveTemplate() {
    setSaving(true)
    try {
      const payload = {
        ...form,
        tools: form.tools.split(',').map(s => s.trim()).filter(Boolean),
        industries: form.industries.split(',').map(s => s.trim()).filter(Boolean),
      }
      if (editId) {
        await api.patch(`/super-admin/templates/${editId}`, payload)
      } else {
        await api.post('/super-admin/templates', payload)
      }
      setShowNew(false)
      setEditId(null)
      setForm({ name: '', role: '', description: '', defaultPrompt: '', tools: '', industries: '', avatar: '', isPublic: true })
      refresh()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(t: Template) {
    setForm({ name: t.name, role: t.role, description: t.description, defaultPrompt: '', tools: t.tools.join(', '), industries: t.industries.join(', '), avatar: t.avatar ?? '', isPublic: t.isPublic })
    setEditId(t.id)
    setShowNew(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Marketplace Templates</h1>
          <p className="text-gray-400 mt-1">Control which agent templates tenants can see</p>
        </div>
        <GlassButton onClick={() => { setShowNew(true); setEditId(null) }} variant="primary" className="px-5">
          + New Template
        </GlassButton>
      </div>

      {showNew && (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <h2 className="font-semibold text-lg text-white">{editId ? 'Edit Template' : 'New Template'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <GlassInput label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <GlassInput label="Role / Job Title" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} />
            <GlassInput label="Industries (comma-separated)" value={form.industries} onChange={v => setForm(f => ({ ...f, industries: v }))} />
            <GlassInput label="Tools (comma-separated)" value={form.tools} onChange={v => setForm(f => ({ ...f, tools: v }))} />
            <GlassInput label="Avatar URL" value={form.avatar} onChange={v => setForm(f => ({ ...f, avatar: v }))} />
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="isPublic"
                checked={form.isPublic}
                onChange={e => setForm(f => ({ ...f, isPublic: e.target.checked }))}
                className="w-4 h-4 accent-gray-400"
              />
              <label htmlFor="isPublic" className="text-sm text-gray-300">Visible in tenant marketplace</label>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-white text-sm outline-none transition-all resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Default System Prompt</label>
            <textarea
              value={form.defaultPrompt}
              onChange={e => setForm(f => ({ ...f, defaultPrompt: e.target.value }))}
              rows={4}
              className="w-full rounded-xl px-3 py-2 text-white text-sm outline-none transition-all resize-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
            />
          </div>
          <div className="flex gap-3">
            <GlassButton onClick={saveTemplate} disabled={saving} variant="primary" className="px-5">
              {saving ? 'Saving...' : 'Save Template'}
            </GlassButton>
            <GlassButton onClick={() => { setShowNew(false); setEditId(null) }} variant="secondary" className="px-5">
              Cancel
            </GlassButton>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(t => (
          <div key={t.id} className="rounded-xl p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {t.avatar ? <img src={t.avatar} alt="" className="w-10 h-10 rounded-xl object-cover" /> : '🤖'}
                </div>
                <div>
                  <p className="font-semibold text-white">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.role}</p>
                </div>
              </div>
              <button
                onClick={() => onToggle(t.id)}
                title={t.isPublic ? 'Hide from marketplace' : 'Show in marketplace'}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
                style={{ background: t.isPublic ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)' }}
              >
                <span
                  className="absolute h-4 w-4 rounded-full bg-white transition-transform"
                  style={{ transform: t.isPublic ? 'translateX(24px)' : 'translateX(4px)' }}
                />
              </button>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2">{t.description}</p>
            <div className="flex flex-wrap gap-1">
              {t.industries.slice(0, 3).map(ind => (
                <span key={ind} className="text-xs px-2 py-0.5 rounded-full text-gray-400" style={{ background: 'rgba(255,255,255,0.06)' }}>{ind}</span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className={`text-xs font-medium ${t.isPublic ? 'text-green-400' : 'text-gray-500'}`}>
                {t.isPublic ? 'Public' : 'Hidden'}
              </span>
              <div className="flex gap-3">
                <button onClick={() => startEdit(t)} className="text-xs text-gray-400 hover:text-white transition-colors">Edit</button>
                <button onClick={() => onDelete(t.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
