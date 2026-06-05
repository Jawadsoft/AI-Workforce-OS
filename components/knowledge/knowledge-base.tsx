'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { FileText, Trash2, Link2, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATUS_MAP = {
  processing: { label: 'Processing', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  ready:      { label: 'Ready', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  error:      { label: 'Error', color: 'bg-red-100 text-red-700', icon: AlertCircle },
}

const FILE_COLORS: Record<string, string> = {
  pdf:  'text-red-500',
  docx: 'text-blue-500',
  txt:  'text-gray-500',
  md:   'text-purple-500',
  csv:  'text-green-600',
}

export function KnowledgeBase() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api.get('/knowledge').then(r => r.data?.data ?? r.data ?? []),
    refetchInterval: 8000,
  })

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then(r => r.data ?? []),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); toast.success('Document deleted') },
    onError: () => toast.error('Failed to delete'),
  })

  const assignMutation = useMutation({
    mutationFn: ({ docId, agentId }: { docId: string; agentId: string }) =>
      api.post(`/knowledge/${docId}/assign`, { agentId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); toast.success('Assigned to agent') },
  })

  const unassignMutation = useMutation({
    mutationFn: ({ docId, agentId }: { docId: string; agentId: string }) =>
      api.delete(`/knowledge/${docId}/assign/${agentId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge'] }); toast.success('Removed from agent') },
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (!docs.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border p-12 text-center space-y-3">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
        <p className="font-medium text-muted-foreground">No documents yet</p>
        <p className="text-sm text-muted-foreground">Upload PDFs, Word docs, or text files to give your agents specialised knowledge.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {docs.map((doc: any) => {
        const status = STATUS_MAP[doc.status as keyof typeof STATUS_MAP] ?? STATUS_MAP.processing
        const StatusIcon = status.icon
        const isOpen = expanded === doc.id
        const assignedAgents: string[] = doc.agents?.map((a: any) => a.agentId) ?? []
        const chunks = doc._count?.chunks ?? 0

        return (
          <div key={doc.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Row */}
            <div className="flex items-center gap-4 p-4">
              <FileText className={cn('w-8 h-8 flex-shrink-0', FILE_COLORS[doc.fileType] ?? 'text-gray-400')} />

              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{doc.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                  {chunks > 0 && <span className="text-xs text-muted-foreground">{chunks} chunks</span>}
                  <span className="text-xs text-muted-foreground">{doc._count?.agents ?? 0} agents</span>
                </div>
              </div>

              <div className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0', status.color)}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : doc.id)}
                  className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground"
                  title="Assign to agents"
                >
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${doc.name}"?`)) deleteMutation.mutate(doc.id) }}
                  className="p-1.5 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Expanded: assign to agents */}
            {isOpen && (
              <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> ASSIGN TO AGENTS
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(agents as any[]).map((agent: any) => {
                    const isAssigned = assignedAgents.includes(agent.id)
                    return (
                      <button
                        key={agent.id}
                        onClick={() => {
                          if (isAssigned) unassignMutation.mutate({ docId: doc.id, agentId: agent.id })
                          else assignMutation.mutate({ docId: doc.id, agentId: agent.id })
                        }}
                        className={cn(
                          'flex items-center gap-2 p-2 rounded-lg border text-sm transition-colors text-left',
                          isAssigned
                            ? 'border-primary/40 bg-primary/5 text-primary'
                            : 'border-border hover:bg-accent text-muted-foreground'
                        )}
                      >
                        {agent.avatar
                          ? <img src={agent.avatar} alt={agent.name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold flex-shrink-0">{agent.name[0]}</div>
                        }
                        <span className="truncate text-xs">{agent.name}</span>
                        {isAssigned && <Link2 className="w-3 h-3 ml-auto flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
                {doc.status === 'ready' && (
                  <p className="text-xs text-green-600 mt-1">✓ Agents will cite this document during conversations</p>
                )}
                {doc.status === 'processing' && (
                  <p className="text-xs text-yellow-600 mt-1">⏳ Still processing — assign now and it'll be available when ready</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
