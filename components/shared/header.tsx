'use client'

import { Bell, Search, LogOut } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'

type HeaderAgent = {
  id: string
  name: string
  role?: string
  avatar?: string
  status?: string
}

export function Header() {
  const { user, fetchMe, logout, isAuthenticated } = useAuthStore()
  const router = useRouter()
  const { data: agents = [] } = useQuery<HeaderAgent[]>({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  useEffect(() => {
    if (!isAuthenticated) fetchMe()
  }, [isAuthenticated, fetchMe])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  return (
    <header className="relative h-20 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Search className="w-4 h-4" />
        <span className="text-sm">Search anything...</span>
      </div>
      <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:flex">
        <div className="flex items-center gap-2 rounded-[2rem] border border-white/70 bg-white/55 px-4 py-2 shadow-sm backdrop-blur-xl">
          {agents.slice(0, 8).map((agent, index) => (
            <div key={agent.id} className="relative flex flex-col items-center gap-1" title={`${agent.name}${agent.role ? ` - ${agent.role}` : ''}`}>
              {agent.avatar ? (
                <img
                  src={agent.avatar}
                  alt={agent.name}
                  className="h-9 w-9 rounded-full border-2 border-white object-cover shadow-sm"
                />
              ) : (
                <div className="h-9 w-9 rounded-full border-2 border-white bg-muted flex items-center justify-center text-xs font-semibold text-foreground shadow-sm">
                  {agent.name[0]}
                </div>
              )}
              <span className="absolute -bottom-1.5 left-1/2 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground ring-2 ring-white">
                {index + 1}
              </span>
            </div>
          ))}
          {agents.length === 0 && (
            <span className="px-3 text-xs text-muted-foreground">No agents yet</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-md hover:bg-accent transition-colors">
          <Bell className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-2 pl-2 border-l border-border">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-none">{user?.name ?? 'Loading...'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{user?.role?.replace('_', ' ')}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
            {initials}
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </header>
  )
}
