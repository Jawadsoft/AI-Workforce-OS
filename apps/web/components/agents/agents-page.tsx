'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { Plus, Search, Power, Zap, RefreshCw, Loader2 } from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-500',
  INACTIVE: 'bg-muted text-muted-foreground',
  PAUSED: 'bg-yellow-500/10 text-yellow-500',
}

export function AgentsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const qc = useQueryClient()
  const [resetting, setResetting] = useState(false)

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  const filtered = agents.filter((a: any) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'ALL' || a.status === filter
    return matchSearch && matchFilter
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Workforce</h1>
          <p className="text-sm text-muted-foreground">{agents.length} agents total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleResetWorkforce}
            disabled={resetting}
            title="Deactivate duplicates and regenerate your workforce from industry templates"
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors text-muted-foreground"
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reset Workforce
          </button>
          <Link href="/agents/marketplace"
            className="flex items-center gap-1.5 border border-border px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors">
            <Zap className="w-4 h-4" /> Marketplace
          </Link>
          <Link href="/agents/create"
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Add Agent
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((s) => (
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
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-36 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
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
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {filtered.map((agent: any) => (
            <div key={agent.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
              {agent.avatar ? (
                <img src={agent.avatar} alt={agent.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                  {agent.name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Link href={`/agents/${agent.id}`} className="font-medium text-sm hover:underline">{agent.name}</Link>
                <p className="text-xs text-muted-foreground">{agent.role}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[agent.status] ?? STATUS_COLORS.INACTIVE}`}>
                  {agent.status}
                </span>
                <button
                  onClick={() => toggleMutation.mutate({ id: agent.id, status: agent.status })}
                  title={agent.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Power className="w-4 h-4" />
                </button>
                <Link href={`/agents/${agent.id}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Configure
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
