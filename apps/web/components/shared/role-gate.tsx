'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import { canAccessPath, defaultHomeForRole } from '@/lib/roles'
import { Loader2, ShieldOff } from 'lucide-react'
import { useOnboardingStatus } from './onboarding-banner'

export function RoleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, fetchMe } = useAuthStore()
  const { data: onboardingData } = useOnboardingStatus()

  useEffect(() => {
    if (!isAuthenticated) fetchMe()
  }, [isAuthenticated, fetchMe])

  useEffect(() => {
    if (!user?.role) return
    if (!canAccessPath(user.role, pathname)) {
      router.replace(defaultHomeForRole(user.role))
    }
  }, [user?.role, pathname, router])

  // Auto-redirect tenant owners/admins to onboarding if not complete
  useEffect(() => {
    if (!user?.role) return
    if (!['TENANT_OWNER', 'TENANT_ADMIN'].includes(user.role)) return
    if (pathname === '/onboarding') return // already there
    if (onboardingData && !onboardingData.complete) {
      router.replace('/onboarding')
    }
  }, [user?.role, onboardingData, pathname, router])

  if (!user) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
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
