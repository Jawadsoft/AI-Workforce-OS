'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, MessageSquare, CheckSquare,
  Clock, BookOpen, FileText, Plug, UserCog,
  BarChart3, Settings, Zap, PanelLeftClose, PanelLeftOpen, Phone,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'AI Workforce', href: '/agents', icon: Users },
  { label: 'Chat', href: '/chat', icon: MessageSquare },
  { label: 'Tasks', href: '/tasks', icon: CheckSquare },
  { label: 'Approvals', href: '/approvals', icon: Clock },
  { label: 'Knowledge Base', href: '/knowledge', icon: BookOpen },
  { label: 'Documents', href: '/documents', icon: FileText },
  { label: 'CRM', href: '/crm', icon: Plug },
  { label: 'Communications', href: '/communications', icon: Phone },
  { label: 'Webhooks', href: '/webhooks', icon: Zap },
  { label: 'Team', href: '/team', icon: UserCog },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col py-5 gap-4 border-r border-border/60 bg-background transition-all duration-300',
        isCollapsed ? 'w-[72px] items-center' : 'w-60 px-4',
      )}
    >
      <div className={cn('flex items-center gap-3', isCollapsed ? 'flex-col' : 'justify-between')}>
        <Link
          href="/dashboard"
          title="AI Workforce OS"
          className={cn(
            'flex items-center rounded-2xl transition-colors',
            isCollapsed ? 'w-10 h-10 justify-center bg-primary shadow-sm' : 'gap-3',
          )}
        >
          <span className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center shadow-sm">
            <Zap className="w-5 h-5 text-primary-foreground" />
          </span>
          {!isCollapsed && <span className="font-semibold text-sm whitespace-nowrap">AI Workforce OS</span>}
        </Link>

        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-label={isCollapsed ? 'Expand sidebar menu' : 'Collapse sidebar menu'}
          className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {isCollapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
        </button>
      </div>

      <nav className={cn('flex-1 flex flex-col gap-2 overflow-y-auto w-full', isCollapsed && 'items-center px-3')}>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                'h-10 flex items-center transition-colors',
                isCollapsed ? 'w-10 justify-center rounded-full' : 'w-full gap-3 rounded-xl px-3 text-sm',
                isActive
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <Link
        href="/settings"
        title="Settings"
        className={cn(
          'h-10 flex items-center transition-colors',
          isCollapsed ? 'w-10 justify-center rounded-full' : 'w-full gap-3 rounded-xl px-3 text-sm',
          pathname === '/settings' || pathname.startsWith('/settings/')
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Settings className="w-[18px] h-[18px] shrink-0" />
        {!isCollapsed && <span>Settings</span>}
      </Link>
    </aside>
  )
}
