'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles, ArrowRight, CheckCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

interface OnboardingStatus {
  complete: boolean
  hasBrain: boolean
  hasAgents: boolean
  hasIndustry: boolean
}

export function useOnboardingStatus() {
  return useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/tenants/onboarding-status').then((r) => r.data),
    staleTime: 30_000,
  })
}

export function OnboardingBanner() {
  const { user } = useAuthStore()
  const pathname = usePathname()
  const { data, isLoading } = useOnboardingStatus()

  // Only show to tenant owners and admins, not on the onboarding page itself
  if (!user?.role || !['TENANT_OWNER', 'TENANT_ADMIN'].includes(user.role)) return null
  if (pathname === '/onboarding') return null
  if (isLoading || !data || data.complete) return null

  const steps = [
    { label: 'Industry set', done: data.hasIndustry },
    { label: 'Business profile', done: data.hasBrain },
    { label: 'AI agents ready', done: data.hasAgents },
  ]
  const doneCnt = steps.filter((s) => s.done).length

  return (
    <div className="mb-4 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Sparkles className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-100">
              Your AI workforce isn&apos;t fully set up yet ({doneCnt}/{steps.length} steps done)
            </p>
            <div className="flex flex-wrap gap-3 mt-1.5">
              {steps.map((s) => (
                <span key={s.label} className={`flex items-center gap-1 text-xs ${s.done ? 'text-green-400' : 'text-violet-300/70'}`}>
                  <CheckCircle className={`w-3 h-3 ${s.done ? 'text-green-400' : 'text-violet-500'}`} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <Link
          href="/onboarding"
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          Complete Setup <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}
