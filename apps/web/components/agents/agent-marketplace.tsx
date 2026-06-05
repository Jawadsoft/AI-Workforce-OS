'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ChevronLeft, Zap, Download, Loader2 } from 'lucide-react'

export function AgentMarketplace() {
  const qc = useQueryClient()
  const [installing, setInstalling] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['agent-templates'],
    queryFn: () => api.get('/agents/templates').then((r) => r.data),
  })

  const installMutation = useMutation({
    mutationFn: (templateId: string) => api.post(`/agents/install-template/${templateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      setInstalling(null)
    },
  })

  const filtered = templates.filter((t: any) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.role.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Agent Marketplace</h1>
          <p className="text-sm text-muted-foreground">Install pre-built AI employees for your industry</p>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search templates..."
        className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 animate-pulse space-y-3">
              <div className="h-5 w-32 bg-muted rounded" />
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="h-8 w-full bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No templates found. Check back soon.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((tmpl: any) => (
            <div key={tmpl.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div>
                <p className="font-medium">{tmpl.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{tmpl.role}</p>
              </div>
              {tmpl.industries?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tmpl.industries.slice(0, 2).map((ind: string) => (
                    <span key={ind} className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {ind.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setInstalling(tmpl.id)
                  installMutation.mutate(tmpl.id)
                }}
                disabled={installMutation.isPending && installing === tmpl.id}
                className="w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {installMutation.isPending && installing === tmpl.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                Install
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
