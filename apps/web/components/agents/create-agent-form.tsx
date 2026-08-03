'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ChevronLeft, Save, Loader2, Lock } from 'lucide-react'
import { useFeatures, FEATURES } from '@/hooks/use-features'

const INDUSTRIES = ['ROOFING', 'CAR_DEALERSHIP', 'CLEANING', 'SECURITY', 'PROPERTY_MANAGEMENT', 'HEALTHCARE', 'CONSTRUCTION', 'REAL_ESTATE', 'OTHER']
const DEFAULT_TOOLS = ['create_task', 'crm_update', 'send_email', 'search_knowledge', 'generate_document', 'schedule_appointment']

export function CreateAgentForm() {
  const router = useRouter()
  const qc = useQueryClient()
  const { isEnabled, isLoading: featuresLoading } = useFeatures()
  const createAgentsEnabled = isEnabled(FEATURES.CREATE_AGENTS)
  const [form, setForm] = useState({
    name: '',
    role: '',
    industry: 'OTHER',
    prompt: '',
    tools: ['create_task', 'crm_update'],
    permissions: ['read_conversations', 'create_tasks'],
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post('/agents', form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      router.push(`/agents/${res.data.id}`)
    },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to create agent'),
  })

  const toggleTool = (t: string) =>
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : [...f.tools, t],
    }))

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
          <p className="text-sm text-muted-foreground">Build a custom AI employee</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">{error}</div>
      )}

      <div className="rounded-lg border border-border bg-card p-6 space-y-5">
        {/* Name & Role */}
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

        {/* Industry */}
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

        {/* System Prompt */}
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

        {/* Tools */}
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

      <div className="flex justify-end gap-3">
        <Link href="/agents" className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">
          Cancel
        </Link>
        <button
          onClick={() => mutation.mutate()}
          disabled={!form.name || !form.role || !form.prompt || mutation.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Create Agent
        </button>
      </div>
    </div>
  )
}
