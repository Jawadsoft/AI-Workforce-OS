'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ChevronLeft, Save, Loader2, Lock, GitMerge } from 'lucide-react'
import { useFeatures, FEATURES } from '@/hooks/use-features'

const INDUSTRIES = ['ROOFING', 'CAR_DEALERSHIP', 'CLEANING', 'SECURITY', 'PROPERTY_MANAGEMENT', 'HEALTHCARE', 'CONSTRUCTION', 'REAL_ESTATE', 'OTHER']
const DEFAULT_TOOLS = ['create_task', 'crm_update', 'send_email', 'search_knowledge', 'generate_document', 'schedule_appointment']

type CreateMode = 'custom' | 'merge'

function firstName(name: string) {
  return name.split(/[—(]/)[0].trim().split(/\s+/)[0] || name
}

function suggestMergedName(primary?: { name: string }, secondary?: { name: string } | null) {
  if (!primary) return ''
  if (!secondary) return `${firstName(primary.name)} — Combined`
  return `${firstName(primary.name)} + ${firstName(secondary.name)}`
}

function suggestMergedRole(primary?: { role: string }, secondary?: { role: string } | null) {
  if (!primary) return ''
  if (!secondary) return primary.role
  const p = primary.role.split(/[—(]/)[0].trim()
  const s = secondary.role.split(/[—(]/)[0].trim()
  if (p.toLowerCase() === s.toLowerCase()) return p
  return `${p} & ${s}`
}

export function CreateAgentForm() {
  const router = useRouter()
  const qc = useQueryClient()
  const { isEnabled, isLoading: featuresLoading } = useFeatures()
  const createAgentsEnabled = isEnabled(FEATURES.CREATE_AGENTS)
  const [mode, setMode] = useState<CreateMode>('custom')
  const [form, setForm] = useState({
    name: '',
    role: '',
    industry: 'OTHER',
    prompt: '',
    tools: ['create_task', 'crm_update'],
    permissions: ['read_conversations', 'create_tasks'],
  })
  const [mergeForm, setMergeForm] = useState({
    primaryAgentId: '',
    secondaryAgentId: '',
    name: '',
    role: '',
    setAsWhatsappAgent: true,
    deactivateSources: false,
  })
  const [error, setError] = useState('')

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data?.data ?? r.data ?? []),
    enabled: mode === 'merge' && createAgentsEnabled,
  })

  const activeAgents = useMemo(
    () => (agents as any[]).filter((a) => a.status !== 'INACTIVE'),
    [agents],
  )

  const primaryAgent = activeAgents.find((a) => a.id === mergeForm.primaryAgentId)
  const secondaryAgent = mergeForm.secondaryAgentId
    ? activeAgents.find((a) => a.id === mergeForm.secondaryAgentId)
    : null

  useEffect(() => {
    if (mode !== 'merge' || !primaryAgent) return
    setMergeForm((f) => ({
      ...f,
      name: f.name || suggestMergedName(primaryAgent, secondaryAgent),
      role: f.role || suggestMergedRole(primaryAgent, secondaryAgent),
    }))
  }, [mode, primaryAgent?.id, secondaryAgent?.id])

  const createMutation = useMutation({
    mutationFn: () => api.post('/agents', form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      router.push(`/agents/${res.data.id}`)
    },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create agent'),
  })

  const mergeMutation = useMutation({
    mutationFn: () =>
      api.post('/agents/merge', {
        primaryAgentId: mergeForm.primaryAgentId,
        secondaryAgentId: mergeForm.secondaryAgentId || undefined,
        name: mergeForm.name || undefined,
        role: mergeForm.role || undefined,
        setAsWhatsappAgent: mergeForm.setAsWhatsappAgent,
        deactivateSources: mergeForm.deactivateSources,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      router.push(`/agents/${res.data.id}`)
    },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to merge agents'),
  })

  const toggleTool = (t: string) =>
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : [...f.tools, t],
    }))

  const secondaryOptions = activeAgents.filter((a) => a.id !== mergeForm.primaryAgentId)

  if (!featuresLoading && !createAgentsEnabled) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
        </div>
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Create AI Agent</h2>
        <p className="text-muted-foreground">This feature is not enabled for your account. Contact your administrator.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Create AI Agent</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'custom' ? 'Build a custom AI employee' : 'Combine two existing agents into one new role'}
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border pb-1">
        <button
          type="button"
          onClick={() => { setMode('custom'); setError('') }}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'custom' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Blank agent
        </button>
        <button
          type="button"
          onClick={() => { setMode('merge'); setError('') }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'merge' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <GitMerge className="w-3.5 h-3.5" />
          Merge from existing
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>
      )}

      {mode === 'custom' ? (
        <div className="rounded-lg border border-border bg-card p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Agent Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Sarah - Lead Qualifier"
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role *</label>
              <input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                placeholder="e.g. Lead Qualification Specialist"
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Industry</label>
            <select
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">System Prompt *</label>
            <p className="text-xs text-muted-foreground mb-1">Define how this agent thinks, speaks, and behaves</p>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="You are a lead qualification specialist for [company]. Your job is to..."
              rows={6}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Tools & Capabilities</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEFAULT_TOOLS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTool(t)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    form.tools.includes(t)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 space-y-5">
          <p className="text-sm text-muted-foreground">
            Creates a <strong className="text-foreground font-medium">new</strong> agent. Your existing agents (Will, Jake, etc.) stay unchanged.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Primary agent *</label>
              <p className="text-xs text-muted-foreground mb-1">Main identity, voice, and industry</p>
              <select
                value={mergeForm.primaryAgentId}
                onChange={(e) =>
                  setMergeForm((f) => ({
                    ...f,
                    primaryAgentId: e.target.value,
                    secondaryAgentId: f.secondaryAgentId === e.target.value ? '' : f.secondaryAgentId,
                    name: '',
                    role: '',
                  }))
                }
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select agent…</option>
                {activeAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Secondary agent (optional)</label>
              <p className="text-xs text-muted-foreground mb-1">Extra scope merged into the prompt</p>
              <select
                value={mergeForm.secondaryAgentId}
                onChange={(e) => setMergeForm((f) => ({ ...f, secondaryAgentId: e.target.value, name: '', role: '' }))}
                disabled={!mergeForm.primaryAgentId}
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              >
                <option value="">None — primary only copy</option>
                {secondaryOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
                ))}
              </select>
            </div>
          </div>

          {primaryAgent && (
            <div className="rounded-md bg-muted/50 border border-border p-3 text-xs text-muted-foreground space-y-1">
              <p><span className="font-medium text-foreground">Primary:</span> {primaryAgent.name} ({primaryAgent.role})</p>
              {secondaryAgent && (
                <p><span className="font-medium text-foreground">Adds scope from:</span> {secondaryAgent.name} ({secondaryAgent.role})</p>
              )}
              <p className="pt-1">The new agent keeps the primary identity. Secondary prompt is added as extra skills (not a second “you are…”). Tools, knowledge, and CRM access are combined.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">New agent name</label>
              <input
                value={mergeForm.name}
                onChange={(e) => setMergeForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={suggestMergedName(primaryAgent, secondaryAgent) || 'Will + Jake'}
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-sm font-medium">New role title</label>
              <input
                value={mergeForm.role}
                onChange={(e) => setMergeForm((f) => ({ ...f, role: e.target.value }))}
                placeholder={suggestMergedRole(primaryAgent, secondaryAgent) || 'Sales & Handyman'}
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={mergeForm.setAsWhatsappAgent}
                onChange={(e) => setMergeForm((f) => ({ ...f, setAsWhatsappAgent: e.target.checked }))}
                className="rounded border-border"
              />
              Use as WhatsApp agent for this tenant
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-muted-foreground">
              <input
                type="checkbox"
                checked={mergeForm.deactivateSources}
                onChange={(e) => setMergeForm((f) => ({ ...f, deactivateSources: e.target.checked }))}
                className="rounded border-border"
              />
              Deactivate secondary agent after merge (primary stays active)
            </label>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Link href="/agents" className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">
          Cancel
        </Link>
        {mode === 'custom' ? (
          <button
            onClick={() => createMutation.mutate()}
            disabled={!form.name || !form.role || !form.prompt || createMutation.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Create Agent
          </button>
        ) : (
          <button
            onClick={() => mergeMutation.mutate()}
            disabled={!mergeForm.primaryAgentId || mergeMutation.isPending}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mergeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
            Create merged agent
          </button>
        )}
      </div>
    </div>
  )
}
