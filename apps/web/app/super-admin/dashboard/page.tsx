'use client'
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useRouter } from 'next/navigation'

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

// ── Industry → recommended CRM ────────────────────────────────────
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
  isActive: boolean; createdAt: string
  owner: { name: string; email: string; isActive: boolean } | null
  stats: { agents: number; conversations: number; users: number }
}
interface Template {
  id: string; name: string; role: string; description: string
  industries: string[]; isPublic: boolean; avatar?: string; tools: string[]
}

const emptyConfig = { industry: '', crmProvider: '', crmName: '', crmBaseUrl: '', crmApiKey: '' }

const TABS = ['Overview', 'Tenants', 'Marketplace']

export default function SuperAdminDashboard() {
  const router = useRouter()
  const [tab, setTab] = useState('Overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTenant, setSearchTenant] = useState('')
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [configForm, setConfigForm] = useState(emptyConfig)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')

  const api = useSAApi()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, tenantsRes, templatesRes] = await Promise.all([
        api.get('/super-admin/stats'),
        api.get('/super-admin/tenants'),
        api.get('/super-admin/templates'),
      ])
      setStats(statsRes.data)
      setTenants(tenantsRes.data)
      setTemplates(templatesRes.data)
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

  async function toggleTemplate(id: string) {
    await api.post(`/super-admin/templates/${id}/toggle-visibility`)
    loadData()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await api.delete(`/super-admin/templates/${id}`)
    loadData()
  }

  function openConfigModal(t: Tenant) {
    setEditingTenant(t)
    setConfigForm({
      industry: t.industry ?? '',
      crmProvider: '',
      crmName: '',
      crmBaseUrl: '',
      crmApiKey: '',
    })
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
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="w-60 border-r border-gray-800 flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-xs font-bold">SA</div>
            <div>
              <p className="text-sm font-semibold">Super Admin</p>
              <p className="text-xs text-gray-500">Platform Control</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <button onClick={signOut} className="w-full text-left text-sm text-gray-500 hover:text-red-400 transition-colors">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {tab === 'Overview' && <OverviewTab stats={stats} tenants={tenants} />}
            {tab === 'Tenants' && (
              <TenantsTab
                tenants={filteredTenants}
                search={searchTenant}
                onSearch={setSearchTenant}
                onToggle={toggleTenant}
                onDelete={deleteTenant}
                onConfigure={openConfigModal}
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

      {/* Configure Tenant Modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-bold text-white">Configure Tenant</h2>
              <p className="text-sm text-gray-400 mt-0.5">{editingTenant.name} — set industry & CRM access</p>
            </div>

            {/* Industry */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">Industry</label>
              <select
                value={configForm.industry}
                onChange={e => setConfigForm(f => ({ ...f, industry: e.target.value, crmProvider: '' }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Select Industry --</option>
                {INDUSTRIES.map(i => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>

            {/* CRM Setup */}
            <div className="space-y-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wider">CRM Connection</label>

              {/* Recommended badges */}
              {recommendedCRMs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-gray-500">Recommended for {configForm.industry}:</span>
                  {recommendedCRMs.map(crm => (
                    <button
                      key={crm}
                      onClick={() => setConfigForm(f => ({ ...f, crmProvider: crm }))}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${configForm.crmProvider === crm ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-indigo-900/30 border-indigo-700 text-indigo-300 hover:bg-indigo-900/60'}`}
                    >
                      {crm}
                    </button>
                  ))}
                </div>
              )}

              {/* CRM Provider */}
              <select
                value={configForm.crmProvider}
                onChange={e => setConfigForm(f => ({ ...f, crmProvider: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Select CRM Provider --</option>
                {CRM_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              {configForm.crmProvider && (
                <div className="space-y-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                  <DarkInput
                    label="Connection Name (optional)"
                    placeholder={`${configForm.crmProvider} — ${editingTenant.name}`}
                    value={configForm.crmName}
                    onChange={v => setConfigForm(f => ({ ...f, crmName: v }))}
                  />
                  {selectedCRMProvider?.needsUrl && (
                    <DarkInput
                      label="Base URL"
                      placeholder="https://yourcrm.com/api"
                      value={configForm.crmBaseUrl}
                      onChange={v => setConfigForm(f => ({ ...f, crmBaseUrl: v }))}
                    />
                  )}
                  <DarkInput
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
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2.5 text-red-300 text-sm">
                {configError}
              </div>
            )}

            {/* Info notice */}
            <div className="bg-indigo-900/20 border border-indigo-800 rounded-lg px-4 py-3 text-xs text-indigo-300">
              Setting the industry will automatically apply recommended CRM tool permissions to all active agents for this tenant.
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={saveConfig}
                disabled={configSaving || (!configForm.industry && !configForm.crmProvider)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                {configSaving ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                onClick={() => setEditingTenant(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Dark Input helper ─────────────────────────────────────────────

function DarkInput({ label, placeholder, value, onChange, type = 'text' }: {
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
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ stats, tenants }: { stats: Stats | null; tenants: Tenant[] }) {
  const statCards = [
    { label: 'Total Tenants', value: stats?.tenants ?? 0, color: 'text-indigo-400' },
    { label: 'Total Agents', value: stats?.agents ?? 0, color: 'text-emerald-400' },
    { label: 'Conversations', value: stats?.conversations ?? 0, color: 'text-blue-400' },
    { label: 'Total Users', value: stats?.users ?? 0, color: 'text-purple-400' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-gray-400 mt-1">Real-time platform statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
            <p className="text-sm text-gray-400">{card.label}</p>
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>{card.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Tenants</h2>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Industry</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Agents</th>
              </tr>
            </thead>
            <tbody>
              {tenants.slice(0, 8).map(t => (
                <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-gray-400">{t.industry ?? 'N/A'}</td>
                  <td className="px-4 py-3 text-gray-400">{t.owner?.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
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

// ── Tenants Tab ───────────────────────────────────────────────────

function TenantsTab({ tenants, search, onSearch, onToggle, onDelete, onConfigure }: {
  tenants: Tenant[]
  search: string
  onSearch: (v: string) => void
  onToggle: (id: string, isActive: boolean) => void
  onDelete: (id: string) => void
  onConfigure: (t: Tenant) => void
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant Management</h1>
          <p className="text-gray-400 mt-1">{tenants.length} tenants total</p>
        </div>
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search tenants..."
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-indigo-500 w-64"
        />
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
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
              <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{t.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.slug}</p>
                </td>
                <td className="px-4 py-3">
                  {t.industry ? (
                    <span className="bg-indigo-900/40 text-indigo-300 text-xs px-2 py-0.5 rounded-full">{t.industry}</span>
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.isActive ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                    {t.isActive ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onConfigure(t)}
                      className="text-xs px-2.5 py-1 rounded-md font-medium bg-indigo-900/40 text-indigo-400 hover:bg-indigo-900/70 transition-colors"
                    >
                      Configure
                    </button>
                    <button
                      onClick={() => onToggle(t.id, t.isActive)}
                      className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${t.isActive ? 'bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/60' : 'bg-green-900/40 text-green-400 hover:bg-green-900/60'}`}
                    >
                      {t.isActive ? 'Suspend' : 'Activate'}
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      className="text-xs px-2.5 py-1 rounded-md font-medium bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors"
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
    setForm({
      name: t.name, role: t.role, description: t.description,
      defaultPrompt: '', tools: t.tools.join(', '), industries: t.industries.join(', '),
      avatar: t.avatar ?? '', isPublic: t.isPublic,
    })
    setEditId(t.id)
    setShowNew(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Marketplace Templates</h1>
          <p className="text-gray-400 mt-1">Control which agent templates tenants can see</p>
        </div>
        <button
          onClick={() => { setShowNew(true); setEditId(null) }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Template
        </button>
      </div>

      {showNew && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-lg">{editId ? 'Edit Template' : 'New Template'}</h2>
          <div className="grid grid-cols-2 gap-4">
            <DarkInput label="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <DarkInput label="Role / Job Title" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} />
            <DarkInput label="Industries (comma-separated)" value={form.industries} onChange={v => setForm(f => ({ ...f, industries: v }))} />
            <DarkInput label="Tools (comma-separated)" value={form.tools} onChange={v => setForm(f => ({ ...f, tools: v }))} />
            <DarkInput label="Avatar URL" value={form.avatar} onChange={v => setForm(f => ({ ...f, avatar: v }))} />
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="isPublic"
                checked={form.isPublic}
                onChange={e => setForm(f => ({ ...f, isPublic: e.target.checked }))}
                className="w-4 h-4 accent-indigo-500"
              />
              <label htmlFor="isPublic" className="text-sm text-gray-300">Visible in tenant marketplace</label>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Default System Prompt</label>
            <textarea value={form.defaultPrompt} onChange={e => setForm(f => ({ ...f, defaultPrompt: e.target.value }))} rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-3">
            <button onClick={saveTemplate} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              {saving ? 'Saving...' : 'Save Template'}
            </button>
            <button onClick={() => { setShowNew(false); setEditId(null) }} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(t => (
          <div key={t.id} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-900/50 flex items-center justify-center text-lg">
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
                className={`w-10 h-6 rounded-full transition-colors relative ${t.isPublic ? 'bg-indigo-600' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${t.isPublic ? 'translate-x-5 left-0' : 'translate-x-1 left-0'}`} />
              </button>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2">{t.description}</p>
            <div className="flex flex-wrap gap-1">
              {t.industries.slice(0, 3).map(ind => (
                <span key={ind} className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded-full">{ind}</span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className={`text-xs font-medium ${t.isPublic ? 'text-green-400' : 'text-gray-500'}`}>
                {t.isPublic ? 'Public' : 'Hidden'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => startEdit(t)} className="text-xs text-indigo-400 hover:text-indigo-300">Edit</button>
                <button onClick={() => onDelete(t.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
