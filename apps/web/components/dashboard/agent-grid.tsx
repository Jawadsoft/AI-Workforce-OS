'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export function AgentGrid() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Your AI Team</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse space-y-2">
              <div className="w-10 h-10 rounded-full bg-muted" />
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-3 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const activeAgents = agents?.filter((a: any) => a.status !== 'INACTIVE') ?? []

  if (!activeAgents.length) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Your AI Team</h2>
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground text-sm mb-3">No agents yet. Complete onboarding to generate your AI workforce.</p>
          <Link href="/onboarding" className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">
            Set up workforce
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Your AI Team</h2>
        <Link href="/agents/create" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Plus className="w-4 h-4" /> Add agent
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {activeAgents.slice(0, 8).map((agent: any) => (
          <Link key={agent.id} href={`/agents/${agent.id}`}>
            <div className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-muted-foreground transition-colors cursor-pointer">
              {agent.avatar ? (
                <img src={agent.avatar} alt={agent.name} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                  {agent.name[0]}
                </div>
              )}
              <p className="font-medium text-sm">{agent.name}</p>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${
                agent.status === 'ACTIVE'
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {agent.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
