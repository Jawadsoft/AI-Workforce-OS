'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Users, Plus, Trash2, ShieldCheck, X, Loader2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const ROLES = ['TENANT_ADMIN', 'MANAGER', 'USER', 'VIEWER']

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', TENANT_OWNER: 'Owner',
  TENANT_ADMIN: 'Admin', MANAGER: 'Manager', USER: 'Member', VIEWER: 'Viewer',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  TENANT_OWNER: 'bg-purple-100 text-purple-700',
  TENANT_ADMIN: 'bg-blue-100 text-blue-700',
  MANAGER: 'bg-orange-100 text-orange-700',
  USER: 'bg-gray-100 text-gray-700',
  VIEWER: 'bg-green-100 text-green-700',
}

export function TeamPage() {
  const qc = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'USER' })
  const [tempPw, setTempPw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get('/tenants/team').then(r => r.data?.data ?? r.data ?? []),
  })

  const inviteMutation = useMutation({
    mutationFn: () => api.post('/tenants/team/invite', form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['team'] })
      setTempPw(res.data.tempPassword)
      setForm({ name: '', email: '', role: 'USER' })
      toast.success(`${res.data.name} added to team`)
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to invite'),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/tenants/team/${id}/role`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Role updated') },
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tenants/team/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Member removed') },
  })

  const copyPw = () => {
    if (!tempPw) return
    navigator.clipboard.writeText(tempPw)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Team</h1>
          <p className="text-muted-foreground mt-1">Manage who has access to your AI Workforce OS.</p>
        </div>
        <button onClick={() => { setShowInvite(true); setTempPw(null) }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" /> Invite Member
        </button>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Invite Team Member</h2>
              <button onClick={() => setShowInvite(false)} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
            </div>

            {tempPw ? (
              /* Temp password display */
              <div className="space-y-3">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
                  <p className="text-sm font-semibold text-green-800">Member added successfully!</p>
                  <p className="text-xs text-green-700">Share these login credentials with the new member:</p>
                  <div className="bg-white rounded border border-green-200 p-3 space-y-1">
                    <p className="text-xs text-gray-500">Temporary Password:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono font-bold flex-1">{tempPw}</code>
                      <button onClick={copyPw} className="p-1 hover:bg-gray-100 rounded">
                        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-green-600">They should change their password after first login.</p>
                </div>
                <button onClick={() => { setShowInvite(false); setTempPw(null) }}
                  className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">Done</button>
              </div>
            ) : (
              /* Invite form */
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Full Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Smith"
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="jane@company.com"
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-sm font-medium">Role</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none">
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Admin: full access · Manager: manage agents & tasks · Member: use chat & view · Viewer: read-only
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowInvite(false)} className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
                  <button onClick={() => inviteMutation.mutate()} disabled={!form.name || !form.email || inviteMutation.isPending}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {inviteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {inviteMutation.isPending ? 'Adding...' : 'Add Member'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {(members as any[]).filter(m => m.isActive !== false).map((member: any) => (
            <div key={member.id} className="flex items-center gap-4 p-4">
              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0">
                {member.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{member.name}</p>
                  {['TENANT_OWNER', 'SUPER_ADMIN'].includes(member.role) && (
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {['TENANT_OWNER', 'SUPER_ADMIN'].includes(member.role) ? (
                  <Badge className={cn('text-xs', ROLE_COLORS[member.role] ?? 'bg-gray-100 text-gray-700')}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                ) : (
                  <select
                    value={member.role}
                    onChange={e => roleMutation.mutate({ id: member.id, role: e.target.value })}
                    className="text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none cursor-pointer"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
                {!['TENANT_OWNER', 'SUPER_ADMIN'].includes(member.role) && (
                  <button
                    onClick={() => { if (confirm(`Remove ${member.name} from the team?`)) removeMutation.mutate(member.id) }}
                    className="p-1.5 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
