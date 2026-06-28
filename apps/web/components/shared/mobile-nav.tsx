'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, MessageSquare, CheckSquare,
  Share2, Settings, Plug, BarChart3,
} from 'lucide-react'

const MOBILE_NAV = [
  { label: 'Home',    href: '/dashboard',  icon: LayoutDashboard },
  { label: 'Agents',  href: '/agents',     icon: Users },
  { label: 'Chat',    href: '/chat',       icon: MessageSquare },
  { label: 'Tasks',   href: '/tasks',      icon: CheckSquare },
  { label: 'Social',  href: '/social',     icon: Share2 },
  { label: 'CRM',     href: '/crm',        icon: Plug },
  { label: 'Reports', href: '/analytics',  icon: BarChart3 },
  { label: 'Settings',href: '/settings',   icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border/60">
      {/* Gap between chat input and nav */}
      <div className="h-3 bg-muted/40" />
      <div className="flex items-center justify-around overflow-x-auto scrollbar-hide px-1">
        {MOBILE_NAV.map(({ label, href, icon: Icon }) => {
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
      {/* Bottom safe area + extra breathing room */}
      <div className="h-[max(env(safe-area-inset-bottom,0px),8px)]" />
    </nav>
  )
}
