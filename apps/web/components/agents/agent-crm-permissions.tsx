'use client'

import { useState, useEffect } from 'react'
import { Shield, CheckCircle2, XCircle, RefreshCw, Info, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { api } from '@/lib/api'

interface CRMConnection {
  id: string
  provider: string
  name: string
  isActive: boolean
}

interface AgentAccess {
  connectionId: string
  permissions: string[]
}

const ALL_PERMISSIONS = [
  { id: 'read_customers', label: 'Read Customers', description: 'Look up customer records by name, phone, or email', group: 'Data Access' },
  { id: 'read_leads', label: 'Read Leads', description: 'View leads and pipeline data', group: 'Data Access' },
  { id: 'read_jobs', label: 'Read Jobs', description: 'Access job details and status', group: 'Data Access' },
  { id: 'read_proposals', label: 'Read Proposals', description: 'View proposal details and values', group: 'Data Access' },
  { id: 'read_materials', label: 'Read Materials', description: 'View materials and parts lists for jobs', group: 'Data Access' },
  { id: 'read_notes', label: 'Read Notes', description: 'View conversation and visit history', group: 'Data Access' },
  { id: 'write_notes', label: 'Write Notes', description: 'Log notes to customer records', group: 'Data Write' },
  { id: 'create_tasks', label: 'Create Tasks', description: 'Create follow-up tasks in CRM', group: 'Data Write' },
  { id: 'update_leads', label: 'Update Lead Stage', description: 'Move leads through the pipeline', group: 'Data Write' },
  { id: 'update_records', label: 'Update Records', description: 'Update customer, job, or other records', group: 'Data Write' },
]

const GROUPS = ['Data Access', 'Data Write']

interface IndustryDefaults {
  label: string
  recommendedCRM: string[]
  defaultTools: string[]
  agentRoleDefaults: Record<string, string[]>
  workflow: string
}

interface AgentCRMPermissionsProps {
  agentId: string
  agentRole: string
}

export function AgentCRMPermissions({ agentId, agentRole }: AgentCRMPermissionsProps) {
  const { toast } = useToast()
  const [connections, setConnections] = useState<CRMConnection[]>([])
  const [access, setAccess] = useState<AgentAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [industryDefaults, setIndustryDefaults] = useState<IndustryDefaults | null>(null)
  const [tenantIndustry, setTenantIndustry] = useState<string | null>(null)

  // Base role defaults (fallback when no industry is detected)
  const ROLE_DEFAULTS: Record<string, string[]> = {
    'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
    'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
    'Inspector': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
    'Insurance Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    'Executive Assistant': ['read_leads', 'read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    'Lead Qualification Assistant': ['read_leads', 'update_leads', 'read_notes', 'write_notes', 'create_tasks'],
    'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
  }

  // Effective defaults: use industry-specific if available, fall back to role defaults
  const effectiveDefaults: string[] = (
    industryDefaults?.agentRoleDefaults?.[agentRole] ??
    ROLE_DEFAULTS[agentRole] ??
    ['read_customers', 'read_notes', 'write_notes']
  )

  useEffect(() => {
    load()
  }, [agentId])

  async function load() {
    setLoading(true)
    try {
      const [connRes, accessRes, brainRes] = await Promise.all([
        api.get('/crm/connections'),
        api.get(`/agents/${agentId}/crm-access`).catch(() => ({ data: [] })),
        api.get('/brain/profile').catch(() => ({ data: null })),
      ])
      setConnections(connRes.data ?? [])
      setAccess(accessRes.data ?? [])

      // Load industry defaults if tenant has an industry
      const industry = brainRes.data?.tenant?.industry
      if (industry) {
        setTenantIndustry(industry)
        api.get(`/crm/industry-defaults/${industry}`)
          .then(r => setIndustryDefaults(r.data))
          .catch(() => null)
      }
    } catch {
      toast({ title: 'Failed to load CRM connections', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  function getPermissions(connectionId: string): string[] {
    return access.find(a => a.connectionId === connectionId)?.permissions ?? effectiveDefaults
  }

  function hasAccess(connectionId: string): boolean {
    return access.some(a => a.connectionId === connectionId)
  }

  async function toggleAccess(conn: CRMConnection) {
    setSaving(conn.id)
    try {
      if (hasAccess(conn.id)) {
        await api.delete(`/crm/connections/${conn.id}/revoke/${agentId}`)
        setAccess(prev => prev.filter(a => a.connectionId !== conn.id))
        toast({ title: `Access revoked from ${conn.name}` })
      } else {
        await api.post(`/crm/connections/${conn.id}/grant/${agentId}`, { permissions: effectiveDefaults })
        setAccess(prev => [...prev, { connectionId: conn.id, permissions: effectiveDefaults }])
        toast({ title: `Access granted to ${conn.name}` })
      }
    } catch {
      toast({ title: 'Failed to update access', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  async function updatePermission(connectionId: string, permission: string, enabled: boolean) {
    const current = getPermissions(connectionId)
    const updated = enabled ? [...new Set([...current, permission])] : current.filter(p => p !== permission)

    setAccess(prev =>
      prev.map(a => a.connectionId === connectionId ? { ...a, permissions: updated } : a)
    )
    setSaving(connectionId)
    try {
      await api.post(`/crm/connections/${connectionId}/grant/${agentId}`, { permissions: updated })
    } catch {
      toast({ title: 'Failed to save permission', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="text-center py-12 space-y-3">
        <Shield className="h-10 w-10 text-gray-300 mx-auto" />
        <p className="text-gray-500 font-medium">No CRM connections configured</p>
        <p className="text-sm text-gray-400">Go to Settings → CRM to add a connection first</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Industry-aware notice */}
      {industryDefaults ? (
        <div className="flex gap-2 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700 border border-indigo-100">
          <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5 text-indigo-500" />
          <div>
            <span className="font-semibold">Industry defaults applied:</span>
            <span className="ml-1">{industryDefaults.label} — permissions for <strong>{agentRole}</strong> are pre-selected based on your industry workflow.</span>
            {industryDefaults.workflow && (
              <p className="mt-1 text-xs text-indigo-500">Workflow: {industryDefaults.workflow}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>Default permissions for <strong>{agentRole}</strong> role are pre-selected. Enable access per connection and fine-tune permissions below.</span>
        </div>
      )}

      {connections.map(conn => {
        const enabled = hasAccess(conn.id)
        const perms = getPermissions(conn.id)
        const isSaving = saving === conn.id

        return (
          <div key={conn.id} className="border rounded-xl overflow-hidden">
            {/* Connection header */}
            <div className="flex items-center justify-between p-4 bg-gray-50">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${conn.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                <div>
                  <p className="font-semibold text-gray-900">{conn.name}</p>
                  <p className="text-xs text-gray-500">{conn.provider}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {enabled ? (
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-gray-500">
                    <XCircle className="h-3 w-3 mr-1" /> No access
                  </Badge>
                )}
                <Switch
                  checked={enabled}
                  onCheckedChange={() => toggleAccess(conn)}
                  disabled={isSaving}
                />
              </div>
            </div>

            {/* Permission toggles */}
            {enabled && (
              <div className="p-4 space-y-5">
                {GROUPS.map(group => {
                  const groupPerms = ALL_PERMISSIONS.filter(p => p.group === group)
                  return (
                    <div key={group}>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{group}</h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {groupPerms.map(perm => {
                          const isRecommended = effectiveDefaults.includes(perm.id)
                          return (
                            <div
                              key={perm.id}
                              className={`flex items-start gap-3 p-3 rounded-lg border hover:bg-gray-50 ${isRecommended ? 'border-indigo-200 bg-indigo-50/30' : ''}`}
                            >
                              <Switch
                                id={`${conn.id}-${perm.id}`}
                                checked={perms.includes(perm.id)}
                                onCheckedChange={(v) => updatePermission(conn.id, perm.id, v)}
                                disabled={isSaving}
                                className="mt-0.5"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`${conn.id}-${perm.id}`} className="font-medium text-sm cursor-pointer">
                                    {perm.label}
                                  </Label>
                                  {isRecommended && (
                                    <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">Recommended</span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{perm.description}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
