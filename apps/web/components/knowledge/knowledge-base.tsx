'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { FileText, Trash2, Link2, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp, Users, Eye, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn, resolveAvatarUrl } from '@/lib/utils'

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

function ChunksModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-chunks', docId],
    queryFn: () => api.get(`/knowledge/${docId}/chunks`).then(r => r.data),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-sm">Document Chunks</h2>
            {data?.docName && <p className="text-xs text-muted-foreground mt-0.5 truncate">{data.docName}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-accent rounded-md transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {isLoading && (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
            </div>
          )}

          {!isLoading && (!data?.chunks || data.chunks.length === 0) && (
            <div className="text-center py-10 text-muted-foreground text-sm">No chunks found. Document may still be processing.</div>
          )}

          {data?.chunks?.map((chunk: any) => (
            <div key={chunk.id} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  Chunk {chunk.chunkIndex + 1}
                </span>
                <span className="text-[10px] text-muted-foreground">{chunk.content.length} chars</span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        {data?.chunks?.length > 0 && (
          <div className="px-5 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">{data.chunks.length} chunks · agents search across all chunks when answering questions</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function KnowledgeBase() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [viewingChunks, setViewingChunks] = useState<string | null>(null)

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

  const [assigningAll, setAssigningAll] = useState<string | null>(null)

  const assignAll = async (docId: string, assignedAgents: string[]) => {
    const unassigned = (agents as any[]).filter(a => !assignedAgents.includes(a.id))
    if (!unassigned.length) { toast.success('Already assigned to all agents'); return }
    setAssigningAll(docId)
    try {
      await Promise.all(unassigned.map(a => api.post(`/knowledge/${docId}/assign`, { agentId: a.id })))
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success(`Assigned to all ${(agents as any[]).length} agents`)
    } catch { toast.error('Some assignments failed') }
    finally { setAssigningAll(null) }
  }

  const unassignAll = async (docId: string, assignedAgents: string[]) => {
    if (!assignedAgents.length) { toast.success('No agents assigned'); return }
    setAssigningAll(docId)
    try {
      await Promise.all(assignedAgents.map(id => api.delete(`/knowledge/${docId}/assign/${id}`)))
      qc.invalidateQueries({ queryKey: ['knowledge'] })
      toast.success('Removed from all agents')
    } catch { toast.error('Some removals failed') }
    finally { setAssigningAll(null) }
  }

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
    <>
    {viewingChunks && <ChunksModal docId={viewingChunks} onClose={() => setViewingChunks(null)} />}
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
                {doc.status === 'ready' && (
                  <button
                    onClick={() => setViewingChunks(doc.id)}
                    className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground"
                    title="View extracted chunks"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                )}
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
              <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                {/* Header row with assign-all controls */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    ASSIGN TO AGENTS
                    <span className="font-normal">({assignedAgents.length}/{(agents as any[]).length} assigned)</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={assigningAll === doc.id || assignedAgents.length === (agents as any[]).length}
                      onClick={() => assignAll(doc.id, assignedAgents)}
                      className="text-xs px-2.5 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {assigningAll === doc.id ? 'Working…' : '+ Assign All'}
                    </button>
                    <button
                      disabled={assigningAll === doc.id || assignedAgents.length === 0}
                      onClick={() => unassignAll(doc.id, assignedAgents)}
                      className="text-xs px-2.5 py-1 rounded-md border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Remove All
                    </button>
                  </div>
                </div>

                {/* Individual agent tiles */}
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
                        {resolveAvatarUrl(agent.avatar)
                          ? <img src={resolveAvatarUrl(agent.avatar)!} alt={agent.name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold flex-shrink-0">{agent.name[0]}</div>
                        }
                        <span className="truncate text-xs">{agent.name}</span>
                        {isAssigned && <Link2 className="w-3 h-3 ml-auto flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>

                {doc.status === 'ready' && assignedAgents.length > 0 && (
                  <p className="text-xs text-green-600">✓ Agents will cite this document during conversations</p>
                )}
                {doc.status === 'ready' && assignedAgents.length === 0 && (
                  <p className="text-xs text-yellow-600">⚠ Not assigned to any agents yet — click "+ Assign All" or pick individual agents above</p>
                )}
                {doc.status === 'processing' && (
                  <p className="text-xs text-yellow-600">⏳ Still processing — assign now and it'll be available when ready</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
    </>
  )
}
