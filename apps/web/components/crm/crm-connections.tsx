'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Plug, Plus, Trash2, CheckCircle, XCircle, Loader2, ExternalLink, Eye, EyeOff, Pencil, X } from 'lucide-react'

const CRM_PROVIDERS = [
  { id: 'STORMBUDDI', label: 'StormBuddi', description: 'StormBuddi roofing CRM', needsUrl: false, docsUrl: 'https://app.stormbuddi.com' },
  { id: 'HUBSPOT', label: 'HubSpot', description: 'HubSpot CRM via private app token', needsUrl: false, docsUrl: 'https://developers.hubspot.com/docs/api/private-apps' },
  { id: 'JOBNIMBUS', label: 'JobNimbus', description: 'JobNimbus field service CRM', needsUrl: false, docsUrl: 'https://www.jobnimbus.com' },
  { id: 'LARAVEL', label: 'Laravel CRM', description: 'Native Laravel CRM integration', needsUrl: true, docsUrl: '' },
  { id: 'SALESFORCE', label: 'Salesforce', description: 'Salesforce CRM integration', needsUrl: true, docsUrl: 'https://developer.salesforce.com' },
  { id: 'ZOHO', label: 'Zoho CRM', description: 'Zoho CRM API integration', needsUrl: false, docsUrl: 'https://www.zoho.com/crm/developer' },
  { id: 'CUSTOM', label: 'Custom API', description: 'Any REST API with bearer token', needsUrl: true, docsUrl: '' },
]

const emptyForm = { provider: 'STORMBUDDI', name: '', baseUrl: '', apiKey: '' }

export function CRMConnections() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [form, setForm] = useState(emptyForm)

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['crm-connections'],
    queryFn: () => api.get('/crm/connections').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/crm/connections', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-connections'] })
      setShowAdd(false)
      setForm(emptyForm)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/crm/connections/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-connections'] })
      setEditingId(null)
      setForm(emptyForm)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-connections'] }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/crm/connections/${id}`, { isActive: !isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-connections'] }),
  })

  const testConnection = async (id: string) => {
    setTestResults((r) => ({ ...r, [id]: { ok: false, message: 'Testing...' } }))
    try {
      const { data } = await api.post(`/crm/connections/${id}/test`)
      setTestResults((r) => ({ ...r, [id]: data }))
    } catch {
      setTestResults((r) => ({ ...r, [id]: { ok: false, message: 'Request failed' } }))
    }
  }

  const openEdit = (conn: any) => {
    setForm({ provider: conn.provider, name: conn.name, baseUrl: conn.baseUrl ?? '', apiKey: '' })
    setEditingId(conn.id)
  }

  const closeModal = () => {
    setShowAdd(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const isEditing = editingId !== null
  const modalOpen = showAdd || isEditing
  const selectedProvider = CRM_PROVIDERS.find((p) => p.id === form.provider)

  const handleSave = () => {
    if (isEditing) {
      const patch: any = { name: form.name }
      if (form.baseUrl) patch.baseUrl = form.baseUrl
      if (form.apiKey) patch.apiKey = form.apiKey
      updateMutation.mutate({ id: editingId!, data: patch })
    } else {
      createMutation.mutate()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Plug className="w-4 h-4" />
          <span>{connections.length} connection{connections.length !== 1 ? 's' : ''} configured</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add CRM
        </button>
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="w-full max-w-lg bg-card rounded-t-2xl sm:rounded-xl border border-border p-5 sm:p-6 space-y-4 sm:space-y-5 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">
                {isEditing ? 'Edit CRM Connection' : 'Connect a CRM'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Provider picker - only when adding */}
            {!isEditing && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CRM_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setForm((f) => ({ ...f, provider: p.id }))}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      form.provider === p.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{p.description}</p>
                  </button>
                ))}
              </div>
            )}

            {isEditing && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
                <Plug className="w-4 h-4" />
                <span>Provider: <strong className="text-foreground">{form.provider}</strong></span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Connection Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={`e.g. Production ${selectedProvider?.label ?? ''}`}
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {(selectedProvider?.needsUrl || (isEditing && form.baseUrl)) && (
                <div>
                  <label className="text-sm font-medium">Base URL</label>
                  <input
                    value={form.baseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://your-crm.com"
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}

              <div>
                <label className="text-sm font-medium">
                  {form.provider === 'HUBSPOT' ? 'Private App Token' : 'API Key / Bearer Token'}
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder={
                    isEditing
                      ? 'Enter new key to replace (leave blank to keep current)'
                      : 'Paste your API key here'
                  }
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {isEditing && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank to keep the existing API key unchanged.
                  </p>
                )}
                {!isEditing && form.provider === 'STORMBUDDI' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Get it from StormBuddi - Settings - Integrations - API Keys.{' '}
                    <a
                      href="https://app.stormbuddi.com/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                )}
                {!isEditing && form.provider === 'HUBSPOT' && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Get it from HubSpot - Settings - Integrations - Private Apps.{' '}
                    <a
                      href="https://app.hubspot.com/private-apps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 sm:py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors text-center"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={
                  !form.name ||
                  (!isEditing && !form.apiKey) ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
                className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 sm:py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isEditing ? (
                  <Pencil className="w-4 h-4" />
                ) : (
                  <Plug className="w-4 h-4" />
                )}
                {isEditing ? 'Save Changes' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connections List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 animate-pulse space-y-2">
              <div className="h-5 w-40 bg-muted rounded" />
              <div className="h-3 w-56 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
          <Plug className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="font-medium">No CRM connected yet</p>
          <p className="text-sm text-muted-foreground">
            Connect your CRM so agents can read contacts, log notes, and update records automatically.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Connect your first CRM
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn: any) => {
            const result = testResults[conn.id]
            return (
              <div key={conn.id} className="rounded-lg border border-border bg-card p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{conn.name}</p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          conn.isActive
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {conn.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {conn.provider}
                      </span>
                    </div>
                    {conn.baseUrl && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">{conn.baseUrl}</p>
                    )}
                    {conn.apiKey && (
                      <div className="flex items-center gap-1 mt-1">
                        <p className="text-xs text-muted-foreground font-mono">
                          {showKey[conn.id]
                            ? conn.apiKey
                            : conn.apiKey.slice(0, 8) + '................'}
                        </p>
                        <button
                          onClick={() => setShowKey((s) => ({ ...s, [conn.id]: !s[conn.id] }))}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {showKey[conn.id] ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => testConnection(conn.id)}
                      className="text-xs border border-border px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => openEdit(conn)}
                      className="text-xs border border-border px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate({ id: conn.id, isActive: conn.isActive })}
                      className="text-xs border border-border px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors"
                    >
                      {conn.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(conn.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {result && (
                  <div
                    className={`flex items-center gap-2 text-sm p-3 rounded-md ${
                      result.ok
                        ? 'bg-green-500/10 text-green-600'
                        : 'bg-red-500/10 text-red-600'
                    }`}
                  >
                    {result.ok ? (
                      <CheckCircle className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    {result.message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {connections.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
          <p className="text-sm font-medium">How agents use your CRM</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { action: 'Log Notes', desc: 'After every conversation, agents auto-log a summary note' },
              { action: 'Update Records', desc: 'Agents update lead status, contact info, and deal stages' },
              { action: 'Create Tasks', desc: 'Agents create follow-up tasks in your CRM automatically' },
            ].map((item) => (
              <div key={item.action} className="bg-background rounded-md p-3 border border-border">
                <p className="text-sm font-medium text-primary">{item.action}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
