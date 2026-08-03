'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight, BookOpen, Compass } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { hasMinRole } from '@/lib/roles'
import { HELP_ARTICLES, QUICK_NAV_LINKS, canSeeArticle } from '@/lib/help-content'

type ResultItem = {
  kind: 'page' | 'help'
  id: string
  label: string
  sub?: string
  href: string
}

export function HeaderSearch() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim().toLowerCase()

    const pages: ResultItem[] = QUICK_NAV_LINKS
      .filter((link) => hasMinRole(user?.role, link.minRole))
      .filter((link) => {
        if (!q) return false
        return link.label.toLowerCase().includes(q) || link.keywords.some((k) => k.includes(q))
      })
      .map((link) => ({ kind: 'page', id: link.href, label: link.label, sub: 'Go to page', href: link.href }))

    const help: ResultItem[] = HELP_ARTICLES
      .filter((a) => canSeeArticle(user?.role, a))
      .filter((a) => {
        if (!q) return false
        const hay = [a.title, a.summary, a.category, ...a.keywords].join(' ').toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 6)
      .map((a) => ({ kind: 'help', id: a.id, label: a.title, sub: a.category, href: `/help?article=${a.id}` }))

    return [...pages.slice(0, 6), ...help]
  }, [query, user?.role])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const go = (item: ResultItem) => {
    router.push(item.href)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIndex]) {
        go(results[activeIndex])
      } else if (query.trim()) {
        router.push(`/help?q=${encodeURIComponent(query.trim())}`)
        setOpen(false)
        inputRef.current?.blur()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search agents, email, social..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-2 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No quick matches.{' '}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  router.push(`/help?q=${encodeURIComponent(query.trim())}`)
                  setOpen(false)
                }}
              >
                Search the Help Guide
              </button>
            </div>
          ) : (
            <ul className="py-1">
              {results.map((item, i) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => go(item)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      i === activeIndex ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    {item.kind === 'page' ? (
                      <Compass className="w-4 h-4 text-primary shrink-0" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-primary shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.sub && <span className="block text-xs text-muted-foreground truncate">{item.sub}</span>}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Press Enter to jump to the top result, or search the full{' '}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                router.push(`/help?q=${encodeURIComponent(query.trim())}`)
                setOpen(false)
              }}
            >
              Help Guide
            </button>
            .
          </div>
        </div>
      )}
    </div>
  )
}
