'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Power, Save, Loader2, MessageSquare, Brain, Copy, CheckCheck, CheckSquare, FileText } from 'lucide-react'
import { AgentCRMPermissions } from './agent-crm-permissions'

const TABS = ['Overview', 'Configuration', 'Brain Memory', 'CRM Access', 'Tasks', 'Conversations']
const TOOLS = ['create_task', 'crm_update', 'send_email', 'search_knowledge', 'generate_document', 'schedule_appointment']

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [tab, setTab] = useState('Overview')
  const [edited, setEdited] = useState<any>(null)
  const [saved, setSaved] = useState(false)

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

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/agents/${agentId}`, edited),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId] })
      setEdited(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (status: string) =>
      api.post(`/agents/${agentId}/${status === 'ACTIVE' ? 'deactivate' : 'activate'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId] }),
  })

  if (isLoading || !agent) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    )
  }

  const data = edited ?? agent

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
          {agent.avatar ? (
            <img src={agent.avatar} alt={agent.name} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {agent.name[0]}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">{agent.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${agent.status === 'ACTIVE' ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'}`}>
            {agent.status}
          </span>
          <button
            onClick={() => toggleMutation.mutate(agent.status)}
            className="flex items-center gap-1.5 border border-border px-3 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
          >
            <Power className="w-4 h-4" />
            {agent.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          </button>
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
      )}

      {/* Configuration */}
      {tab === 'Configuration' && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-5">
          <div>
            <label className="text-sm font-medium">System Prompt</label>
            <textarea
              value={data.prompt ?? ''}
              onChange={(e) => setEdited({ ...(edited ?? agent), prompt: e.target.value })}
              rows={8}
              className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Tools & Capabilities</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TOOLS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTool(t)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    (data.tools ?? []).includes(t)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
          {edited && (
            <div className="flex justify-end">
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
