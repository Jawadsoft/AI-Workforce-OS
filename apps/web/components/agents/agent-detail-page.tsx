'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Power, Save, Loader2, MessageSquare, Brain, Copy, CheckCheck, CheckSquare, FileText, Camera, EyeOff, Eye, Volume2, Play, GitMerge, Trash2 } from 'lucide-react'
import { AgentCRMPermissions } from './agent-crm-permissions'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { resolveAvatarUrl } from '@/lib/utils'

import { canEditAgents } from '@/lib/roles'

const TABS = ['Overview', 'Configuration', 'Brain Memory', 'CRM Access', 'Tasks', 'Conversations']
const TOOLS = ['create_task', 'crm_update', 'send_email', 'search_knowledge', 'generate_document', 'schedule_appointment']

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [tab, setTab] = useState('Overview')
  const [edited, setEdited] = useState<any>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState('')
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null)

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => api.get(`/agents/${agentId}`).then((r) => r.data),
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['agent-tasks', agentId],
    queryFn: () => api.get(`/tasks?agentId=${agentId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: tab === 'Tasks',
  })

  const { data: conversations = [] } = useQuery({
    queryKey: ['agent-convos', agentId],
    queryFn: () => api.get(`/chat?agentId=${agentId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: tab === 'Conversations',
  })

  const { data: voices = [] } = useQuery({
    queryKey: ['elevenlabs-voices'],
    queryFn: () => api.get('/agents/voices').then((r) => r.data),
    enabled: tab === 'Configuration',
    staleTime: 5 * 60 * 1000,
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      const { name, role, prompt, tools, permissions, status, approvalRules, voiceId } = edited ?? {}
      const payload: any = {}
      if (name !== undefined) payload.name = name
      if (role !== undefined) payload.role = role
      if (prompt !== undefined) payload.prompt = prompt
      if (tools !== undefined) payload.tools = tools
      if (permissions !== undefined) payload.permissions = permissions
      if (status !== undefined) payload.status = status
      if (approvalRules !== undefined) payload.approvalRules = approvalRules
      if (voiceId !== undefined) payload.voiceId = voiceId
      return api.patch(`/agents/${agentId}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      setEdited(null)
      setSaved(true)
      toast.success('Agent updated successfully')
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to save changes'
      toast.error(msg)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (status: string) =>
      api.post(`/agents/${agentId}/${status === 'ACTIVE' ? 'deactivate' : 'activate'}`),
    onSuccess: (_data, status) => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      setConfirmDeactivate(false)
      toast.success(status === 'ACTIVE' ? 'Agent set to inactive — hidden from dashboard & workforce' : 'Agent reactivated')
    },
    onError: () => toast.error('Failed to update agent status'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/agents/${agentId}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      const moved = res.data?.reassignedName
      toast.success(moved ? `Agent deleted. Conversations moved to ${moved}.` : 'Agent deleted')
      router.push('/agents')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to delete agent')
      setConfirmDelete(false)
    },
  })

  const { user, fetchMe, isAuthenticated } = useAuthStore()
  const canEdit = canEditAgents(user?.role)

  useEffect(() => { if (!isAuthenticated) fetchMe() }, [])

  if (isLoading || !agent) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    )
  }

  const data = edited ?? agent
  const mergeSource = (agent.approvalRules as Record<string, unknown> | null)?.mergeSource as
    | { primaryName?: string; secondaryName?: string; mergedAt?: string }
    | undefined

  const previewVoice = async (previewUrl: string | undefined, voiceId: string) => {
    if (!previewUrl) return
    setPreviewingVoice(voiceId)
    try {
      const audio = new Audio(previewUrl)
      audio.onended = () => setPreviewingVoice(null)
      audio.onerror = () => setPreviewingVoice(null)
      await audio.play()
    } catch {
      setPreviewingVoice(null)
    }
  }

  const toggleTool = (t: string) => {
    const tools = data.tools ?? []
    setEdited({ ...(edited ?? agent), tools: tools.includes(t) ? tools.filter((x: string) => x !== t) : [...tools, t] })
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          {/* Avatar with optional edit */}
          <div className="relative group">
            {resolveAvatarUrl(edited?.avatar ?? agent.avatar) ? (
              <img src={resolveAvatarUrl(edited?.avatar ?? agent.avatar)!} alt={agent.name} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                {agent.name[0]}
              </div>
            )}
            {canEdit && (
              <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Camera className="w-4 h-4 text-white" />
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const formData = new FormData()
                    formData.append('file', file)
                    try {
                      // Do NOT set Content-Type manually — axios auto-sets multipart/form-data
                      // with the correct boundary when passed a FormData object
                      const res = await api.post(`/agents/${agentId}/avatar`, formData)
                      qc.invalidateQueries({ queryKey: ['agent', agentId] })
                      qc.invalidateQueries({ queryKey: ['agents'] })
                      setEdited((prev: any) => ({ ...(prev ?? agent), avatar: res.data.avatar }))
                      toast.success('Avatar updated')
                    } catch {
                      toast.error('Failed to upload avatar')
                    }
                  }}
                />
              </label>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{data.name}</h1>
              {mergeSource && (
                <span
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 font-medium"
                  title={
                    mergeSource.secondaryName
                      ? `Merged from ${mergeSource.primaryName} + ${mergeSource.secondaryName}`
                      : `Merged from ${mergeSource.primaryName}`
                  }
                >
                  <GitMerge className="w-3 h-3" />
                  Merged
                </span>
              )}
              {agent.status === 'INACTIVE' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium">Inactive</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{data.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Deactivate / Activate — tenant admin only */}
          {canEdit && (
            <>
              {confirmDeactivate && agent.status === 'ACTIVE' ? (
                <div className="flex items-center gap-1.5 border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 rounded-md text-sm">
                  <span className="text-amber-600 text-xs">Hide from dashboard?</span>
                  <button
                    onClick={() => toggleMutation.mutate(agent.status)}
                    disabled={toggleMutation.isPending}
                    className="text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
                  >
                    {toggleMutation.isPending ? 'Saving…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirmDeactivate(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => agent.status === 'ACTIVE' ? setConfirmDeactivate(true) : toggleMutation.mutate(agent.status)}
                  disabled={toggleMutation.isPending}
                  className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-md text-sm transition-colors ${
                    agent.status === 'ACTIVE'
                      ? 'border-border hover:bg-accent text-muted-foreground hover:text-foreground'
                      : 'border-green-500/50 bg-green-500/10 text-green-600 hover:bg-green-500/20'
                  }`}
                >
                  {agent.status === 'ACTIVE' ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {agent.status === 'ACTIVE' ? 'Set Inactive' : 'Reactivate'}
                </button>
              )}
              {confirmDelete ? (
                <div className="flex items-center gap-1.5 border border-destructive/50 bg-destructive/10 px-3 py-1.5 rounded-md text-sm">
                  <span className="text-destructive text-xs">Delete permanently?</span>
                  <button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="text-xs font-medium text-destructive hover:text-destructive/80"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-1.5 border border-destructive/40 px-3 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
            </>
          )}
          <Link
            href={`/chat?agentId=${agent.id}`}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            <MessageSquare className="w-4 h-4" /> Chat
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'Overview' && (
        <div className="space-y-4">
          {mergeSource && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 text-sm">
              <p className="font-medium flex items-center gap-1.5 text-violet-700">
                <GitMerge className="w-4 h-4" /> Merged agent
              </p>
              <p className="text-muted-foreground mt-1">
                Built from <span className="text-foreground">{mergeSource.primaryName}</span>
                {mergeSource.secondaryName ? (
                  <> + <span className="text-foreground">{mergeSource.secondaryName}</span></>
                ) : null}
                {mergeSource.mergedAt ? (
                  <> · {new Date(mergeSource.mergedAt).toLocaleString()}</>
                ) : null}
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Industry', value: agent.industry?.replace('_', ' ') },
            { label: 'Status', value: agent.status },
            { label: 'Tools', value: agent.tools?.length + ' enabled' },
            { label: 'Created', value: new Date(agent.createdAt).toLocaleDateString() },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="font-medium mt-1 text-sm">{s.value}</p>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Configuration */}
      {tab === 'Configuration' && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Agent Name</label>
              <input
                value={data.name ?? ''}
                readOnly={!canEdit}
                onChange={canEdit ? (e) => setEdited({ ...(edited ?? agent), name: e.target.value }) : undefined}
                className={`w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role / Title</label>
              <input
                value={data.role ?? ''}
                readOnly={!canEdit}
                onChange={canEdit ? (e) => setEdited({ ...(edited ?? agent), role: e.target.value }) : undefined}
                className={`w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">System Prompt</label>
            <textarea
              value={data.prompt ?? ''}
              onChange={canEdit ? (e) => setEdited({ ...(edited ?? agent), prompt: e.target.value }) : undefined}
              readOnly={!canEdit}
              rows={8}
              className={`w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Tools & Capabilities</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TOOLS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={canEdit ? () => toggleTool(t) : undefined}
                  disabled={!canEdit}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    (data.tools ?? []).includes(t)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  } ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
          {/* Voice Selection */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Volume2 className="w-4 h-4 text-muted-foreground" />
              <label className="text-sm font-medium">Agent Voice</label>
              {data.voiceId && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {(voices as any[]).find((v: any) => v.voice_id === data.voiceId)?.name ?? data.voiceId}
                </span>
              )}
            </div>
            <input
              type="text"
              placeholder="Search voices..."
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              className="w-full mb-2 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {voices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                {tab === 'Configuration' ? 'Loading voices…' : ''}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                {(voices as any[])
                  .filter((v: any) =>
                    !voiceSearch || v.name.toLowerCase().includes(voiceSearch.toLowerCase())
                  )
                  .map((voice: any) => {
                    const isSelected = data.voiceId === voice.voice_id
                    return (
                      <div
                        key={voice.voice_id}
                        onClick={canEdit ? () => setEdited({ ...(edited ?? agent), voiceId: voice.voice_id }) : undefined}
                        className={`relative flex flex-col gap-1 rounded-lg border p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground'
                        } ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-medium truncate">{voice.name}</span>
                          {voice.preview_url && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); previewVoice(voice.preview_url, voice.voice_id) }}
                              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-accent transition-colors"
                              title="Preview voice"
                            >
                              {previewingVoice === voice.voice_id
                                ? <Loader2 className="w-3 h-3 animate-spin text-primary" />
                                : <Play className="w-3 h-3 text-muted-foreground" />
                              }
                            </button>
                          )}
                        </div>
                        {voice.labels?.gender && (
                          <span className="text-xs text-muted-foreground capitalize">{voice.labels.gender}</span>
                        )}
                        {isSelected && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
            {!canEdit && data.voiceId && (
              <p className="text-xs text-muted-foreground mt-1">Voice: {(voices as any[]).find((v: any) => v.voice_id === data.voiceId)?.name ?? data.voiceId}</p>
            )}
          </div>

          {edited && (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setEdited(null)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saved ? 'Saved!' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Brain Memory */}
      {tab === 'Brain Memory' && <BrainMemoryTab agentId={agentId} agentName={agent.name} />}

      {/* Tasks */}
      {tab === 'Tasks' && (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No tasks for this agent yet</div>
          ) : (
            tasks.map((task: any) => (
              <div key={task.id} className="flex items-center gap-3 p-4">
                <CheckSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{task.status}</p>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* CRM Access */}
      {tab === 'CRM Access' && (
        <AgentCRMPermissions agentId={agentId} agentRole={data.role} />
      )}

      {/* Conversations */}
      {tab === 'Conversations' && (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No conversations yet</div>
          ) : (
            conversations.map((c: any) => (
              <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 p-4 hover:bg-accent/30 transition-colors">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.title ?? 'Untitled conversation'}</p>
                  <p className="text-xs text-muted-foreground">{c.channel ?? 'chat'}</p>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function BrainMemoryTab({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [copied, setCopied] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agent-system-prompt', agentId],
    queryFn: () => api.get(`/chat/agents/${agentId}/system-prompt`).then((r) => r.data),
  })

  const prompt = data?.prompt ?? ''

  const copy = () => {
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">Full system prompt sent to {agentName}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refetch()}
              className="text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs border border-border px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              {copied ? <CheckCheck className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This is the exact prompt injected into every conversation with this agent — includes their role, your business knowledge base, and any manual overrides from Settings → Business Brain.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-4 bg-muted rounded" style={{ width: `${50 + Math.random() * 45}%` }} />
          ))}
        </div>
      ) : prompt ? (
        <div className="rounded-lg border border-border bg-zinc-950 text-zinc-100 p-4 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[600px] overflow-y-auto">
          {prompt}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-2">
          <Brain className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No brain context yet.</p>
          <p className="text-xs text-muted-foreground">
            Go to <strong>Settings → Business Brain</strong> and analyze your website to enrich your agents with business knowledge.
          </p>
        </div>
      )}
    </div>
  )
}
