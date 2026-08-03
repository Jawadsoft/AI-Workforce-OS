'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, MessageSquare, CheckSquare,
  Share2, Settings, Plug, HelpCircle,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { canAccessPath } from '@/lib/roles'

const MOBILE_NAV = [
  { label: 'Home',    href: '/dashboard',  icon: LayoutDashboard },
  { label: 'Agents',  href: '/agents',     icon: Users },
  { label: 'Chat',    href: '/chat',       icon: MessageSquare },
  { label: 'Tasks',   href: '/tasks',      icon: CheckSquare },
  { label: 'Social',  href: '/social',     icon: Share2 },
  { label: 'CRM',     href: '/crm',        icon: Plug },
  { label: 'Help',    href: '/help',       icon: HelpCircle },
  { label: 'Settings',href: '/settings',   icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()
  const { user, fetchMe, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) fetchMe()
  }, [isAuthenticated, fetchMe])

  const items = MOBILE_NAV.filter((item) => canAccessPath(user?.role, item.href))

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border/60">
      <div className="h-3 bg-muted/30" />
      <div className="flex items-center justify-around overflow-x-auto scrollbar-hide px-1">
        {items.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 px-2 pt-1 pb-2 min-w-[48px] transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('w-[22px] h-[22px]', isActive && 'stroke-[2.5]')} />
              <span className={cn('text-[9px] font-medium leading-tight', isActive ? 'text-primary' : 'text-muted-foreground/70')}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
      <div className="h-[max(env(safe-area-inset-bottom,0px),8px)]" />
    </nav>
  )
}
