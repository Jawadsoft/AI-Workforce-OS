import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatRelativeTime(date: string | Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Converts an agent avatar value to a fully-qualified URL.
 * - Already-absolute URLs (http/https) and data: URIs are returned as-is.
 * - Local upload paths like /uploads/avatars/charlie.png are prefixed with
 *   the API origin so the browser fetches from the API server, not the frontend.
 */
export function resolveAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  if (avatar.startsWith('http') || avatar.startsWith('data:')) return avatar
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ??
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:3001/api/v1`
      : 'http://localhost:3001/api/v1')
  const apiOrigin = apiBase.replace('/api/v1', '')
  return `${apiOrigin}${avatar}`
}
