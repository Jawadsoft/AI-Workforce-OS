'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { AlertTriangle, PauseCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'
import { hasMinRole } from '@/lib/roles'

export type AutonomyMode = 'off' | 'internal' | 'full'

export interface AutonomyState {
  mode: AutonomyMode
  updatedAt: string | null
  updatedByName: string | null
  reason: string | null
}

export function useAutonomy() {
  return useQuery<AutonomyState>({
    queryKey: ['tenant-autonomy'],
    queryFn: () => api.get('/tenants/autonomy').then((r) => r.data),
    refetchInterval: 15000,
  })
}

export function AutonomyBanner() {
  const { data } = useAutonomy()
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const canManage = hasMinRole(user?.role, 'TENANT_ADMIN')

  const resume = useMutation({
    mutationFn: () => api.patch('/tenants/autonomy', { mode: 'full', reason: 'Resumed from banner' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-autonomy'] })
      toast.success('AI workforce resumed')
    },
    onError: () => toast.error('Failed to resume AI workforce'),
  })

  if (!data || data.mode === 'full') return null

  const isStop = data.mode === 'off'
  const by = data.updatedByName ? ` by ${data.updatedByName}` : ''

  return (
    <div
      className={`mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-4 py-3 ${
        isStop
          ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
      }`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {isStop
          ? <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" />
          : <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {isStop ? 'AI workforce emergency stop is on' : 'AI workforce is internal-only'}
          </p>
          <p className="text-xs opacity-80 mt-0.5">
            {isStop
              ? 'No auto emails, ticket wakes, or pipeline advances.'
              : 'Agents can work tickets internally. Customer emails, SMS, and auto-publish are blocked.'}
            {by}
            {' '}
            <Link href="/settings?tab=security" className="underline underline-offset-2 hover:opacity-100 opacity-90">
              Settings → Security
            </Link>
          </p>
        </div>
      </div>
      {canManage && (
        <button
          onClick={() => resume.mutate()}
          disabled={resume.isPending}
          className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-background/80 text-foreground hover:bg-background transition-colors disabled:opacity-50"
        >
          {resume.isPending ? 'Resuming…' : 'Resume full autonomy'}
        </button>
      )}
    </div>
  )
}
