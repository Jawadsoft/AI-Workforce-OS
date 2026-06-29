'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, MessageSquare, CheckSquare,
  Clock, BookOpen, FileText, Plug, UserCog,
  BarChart3, Settings, Zap, PanelLeftClose, PanelLeftOpen, Phone,
  CloudLightning, Wrench, ChevronDown, Ticket, Share2,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'AI Workforce', href: '/agents', icon: Users },
  { label: 'Chat', href: '/chat', icon: MessageSquare },
  { label: 'Tickets', href: '/tickets', icon: Ticket },
  { label: 'Tasks', href: '/tasks', icon: CheckSquare },
  { label: 'Approvals', href: '/approvals', icon: Clock },
  { label: 'Knowledge Base', href: '/knowledge', icon: BookOpen },
  { label: 'Documents', href: '/documents', icon: FileText },
  { label: 'Social Media', href: '/social', icon: Share2 },
  { label: 'CRM', href: '/crm', icon: Plug },
  { label: 'Communications', href: '/communications', icon: Phone },
  { label: 'Webhooks', href: '/webhooks', icon: Zap },
  { label: 'Team', href: '/team', icon: UserCog },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
]

const toolItems = [
  { label: 'Storm Data', href: '/storm', icon: CloudLightning },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [toolsOpen, setToolsOpen] = useState(
    toolItems.some(t => pathname === t.href || pathname.startsWith(t.href + '/'))
  )

  const isToolsActive = toolItems.some(t => pathname === t.href || pathname.startsWith(t.href + '/'))

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col py-5 gap-4 transition-all duration-300',
        'bg-card/80 backdrop-blur-xl border-r border-border/60',
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
        {/* Main nav items */}
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

        {/* Tools group */}
        {isCollapsed ? (
          // Collapsed: show tool icons directly
          toolItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-full transition-colors',
                  isActive
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
              </Link>
            )
          })
        ) : (
          // Expanded: collapsible Tools section
          <div className="mt-1">
            <button
              onClick={() => setToolsOpen(v => !v)}
              className={cn(
                'w-full h-10 flex items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                isToolsActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Wrench className="w-[18px] h-[18px] shrink-0" />
              <span className="flex-1 text-left">Tools</span>
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', toolsOpen && 'rotate-180')} />
            </button>

            {toolsOpen && (
              <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-border/50 pl-3">
                {toolItems.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'h-9 flex items-center gap-2.5 rounded-lg px-2 text-sm transition-colors',
                        isActive
                          ? 'bg-foreground text-background shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}
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
