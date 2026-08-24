'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { Plus, Search, EyeOff, Eye, Zap, RefreshCw, Loader2, Pencil, X, Check, MessageSquare, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { resolveAvatarUrl } from '@/lib/utils'
import { canEditAgents } from '@/lib/roles'
import { useFeatures, FEATURES } from '@/hooks/use-features'

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-500',
  INACTIVE: 'bg-muted text-muted-foreground',
  PAUSED: 'bg-yellow-500/10 text-yellow-500',
}

export function AgentsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const qc = useQueryClient()
  const [resetting, setResetting] = useState(false)
  const { user, fetchMe, isAuthenticated } = useAuthStore()
  const canEdit = canEditAgents(user?.role)
  const { isEnabled } = useFeatures()
  const marketplaceEnabled = isEnabled(FEATURES.MARKETPLACE)
  const createAgentsEnabled = isEnabled(FEATURES.CREATE_AGENTS)
  const resetWorkforceEnabled = isEnabled(FEATURES.RESET_WORKFORCE)

  useEffect(() => { if (!isAuthenticated) fetchMe() }, [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')

  const renameMutation = useMutation({
    mutationFn: ({ id, name, role }: { id: string; name: string; role: string }) =>
      api.patch(`/agents/${id}`, { name, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      setEditingId(null)
    },
  })

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  const { data: tenantSettings } = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api.get('/tenants/settings').then((r) => r.data),
  })

  const handleResetWorkforce = async () => {
    const industry = tenantSettings?.industry ?? 'ROOFING'
    if (!confirm(`This will deactivate all current agents and regenerate your ${industry} workforce from templates. Continue?`)) return
    setResetting(true)
    try {
      await api.post('/tenants/reset-workforce', { industry })
      qc.invalidateQueries({ queryKey: ['agents'] })
    } finally {
      setResetting(false)
    }
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/agents/${id}/${status === 'ACTIVE' ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const filtered = agents.filter((a: any) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'ALL' || a.status === filter
    return matchSearch && matchFilter
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">AI Workforce</h1>
          <p className="text-sm text-muted-foreground">
            {agents.filter((a: any) => a.status === 'ACTIVE').length} active
            {agents.filter((a: any) => a.status === 'INACTIVE').length > 0 && (
              <span className="ml-1 text-muted-foreground/60">· {agents.filter((a: any) => a.status === 'INACTIVE').length} inactive</span>
            )}
          </p>
        </div>
        {/* Actions — icon-only on mobile, full labels on sm+ */}
        <div className="flex items-center gap-1.5 shrink-0">
          {resetWorkforceEnabled && (
            <button
              onClick={handleResetWorkforce}
              disabled={resetting}
              title="Reset Workforce"
              className="flex items-center gap-1.5 border border-border px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors text-muted-foreground"
            >
              {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="hidden sm:inline">Reset Workforce</span>
            </button>
          )}
          {marketplaceEnabled && (
            <Link href="/agents/marketplace"
              className="flex items-center gap-1.5 border border-border px-2.5 py-2 rounded-md text-sm hover:bg-accent transition-colors">
              <Zap className="w-4 h-4" />
              <span className="hidden sm:inline">Marketplace</span>
            </Link>
          )}
          {createAgentsEnabled && (
            <Link href="/agents/create"
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-2.5 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Agent</span>
            </Link>
          )}
        </div>
      </div>

      {/* Filters — stacked on mobile, inline on sm+ */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex rounded-md border border-border overflow-hidden self-start sm:self-auto">
          {(['ACTIVE', 'ALL', 'INACTIVE'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 text-sm transition-colors ${filter === s ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}`}
            >
              {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
              <div className="aspect-[3/4] bg-muted" />
              <div className="p-3 space-y-2">
                <div className="h-3.5 w-3/4 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">No agents found</p>
          <Link href="/agents/create" className="mt-3 inline-block text-sm text-primary hover:underline">Create one</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {filtered.map((agent: any) => (
            <div
              key={agent.id}
              className={`relative rounded-xl border border-border bg-card overflow-hidden flex flex-col group transition-shadow hover:shadow-md ${agent.status === 'INACTIVE' ? 'opacity-60' : ''}`}
            >
              {/* Thumbnail */}
              <Link href={`/agents/${agent.id}`} className="block">
                {resolveAvatarUrl(agent.avatar) ? (
                  <div className="aspect-[3/4] w-full overflow-hidden bg-muted">
                    <img
                      src={resolveAvatarUrl(agent.avatar)!}
                      alt={agent.name}
                      className="w-full h-full object-cover object-top transition-transform group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className="aspect-[3/4] w-full bg-primary/10 flex items-center justify-center">
                    <span className="text-5xl font-bold text-primary/40">{agent.name[0]}</span>
                  </div>
                )}
              </Link>

              {/* Info */}
              <div className="px-3 py-2 flex-1 flex flex-col gap-0.5">
                {editingId === agent.id ? (
                  <div className="flex flex-col gap-1.5">
                    <input
                      autoFocus
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Name"
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      value={editRole}
                      onChange={e => setEditRole(e.target.value)}
                      placeholder="Role"
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => renameMutation.mutate({ id: agent.id, name: editName, role: editRole })}
                        disabled={renameMutation.isPending}
                        className="flex-1 py-1 rounded-md bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors"
                      >
                        {renameMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 rounded-md hover:bg-accent text-muted-foreground transition-colors text-xs"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Link href={`/agents/${agent.id}`} className="font-semibold text-sm leading-tight hover:underline truncate">{agent.name}</Link>
                    <p className="text-xs text-muted-foreground truncate">{agent.role}</p>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-3 pb-2 flex items-center justify-between gap-1">
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[agent.status] ?? STATUS_COLORS.INACTIVE}`}>
                  {agent.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </span>
                {editingId !== agent.id && (
                  <div className="flex items-center gap-0.5">
                    {agent.status === 'ACTIVE' && (
                      <Link
                        href={`/chat?agentId=${agent.id}`}
                        title="Chat with this agent"
                        className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-primary"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </Link>
                    )}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => { setEditingId(agent.id); setEditName(agent.name); setEditRole(agent.role) }}
                          title="Rename"
                          className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleMutation.mutate({ id: agent.id, status: agent.status })}
                          title={agent.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
                        >
                          {agent.status === 'ACTIVE' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Permanently delete ${agent.name}? Conversations move to another agent. This cannot be undone.`)) {
                              deleteMutation.mutate(agent.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          title="Delete agent"
                          className="p-1 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
