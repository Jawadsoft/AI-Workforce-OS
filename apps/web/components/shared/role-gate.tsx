'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { canAccessPath, defaultHomeForRole } from '@/lib/roles'
import { Loader2, ShieldOff } from 'lucide-react'
import { useOnboardingStatus } from './onboarding-banner'

const TENANT_ROLES = ['TENANT_OWNER', 'TENANT_ADMIN']

export function RoleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, fetchMe } = useAuthStore()
  const [ready, setReady] = useState(false)

  const isTenantUser = !!user && TENANT_ROLES.includes(user.role)
  const { isLoading: onboardingLoading, isError: onboardingError } = useOnboardingStatus()

  useEffect(() => {
    if (!isAuthenticated) fetchMe()
  }, [isAuthenticated, fetchMe])

  useEffect(() => {
    if (!user?.role) return
    if (!canAccessPath(user.role, pathname)) {
      router.replace(defaultHomeForRole(user.role))
    }
  }, [user?.role, pathname, router])

  // Mark ready once we have user + onboarding check resolved (or timed out)
  useEffect(() => {
    if (!user) return
    if (!isTenantUser) { setReady(true); return }
    if (!onboardingLoading || onboardingError) setReady(true)
  }, [user, isTenantUser, onboardingLoading, onboardingError])

  // Safety valve — always unblock after 4 seconds
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 4000)
    return () => clearTimeout(t)
  }, [])

  // ── Render guards ─────────────────────────────────────────────────

  if (!user) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-60 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <p className="text-xs">Loading your workspace…</p>
      </div>
    )
  }

  if (!canAccessPath(user.role, pathname)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <ShieldOff className="w-10 h-10 text-muted-foreground" />
        <div>
          <p className="font-semibold">Access restricted</p>
          <p className="text-sm text-muted-foreground mt-1">
            Your role ({user.role}) cannot open this page. Contact an admin if you need access.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
