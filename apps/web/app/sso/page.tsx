'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'

function SsoLoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const setAuth = useAuthStore.setState
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const run = async () => {
      const token = searchParams.get('token')
      const source = searchParams.get('source') || 'stormbuddi'

      if (!token) {
        setError('Missing SSO token')
        return
      }

      try {
        const { data } = await api.post('/auth/sso-login', { token, source })
        const accessToken = data.access_token as string

        localStorage.setItem('access_token', accessToken)
        document.cookie = `access_token=${accessToken}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
        setAuth({ token: accessToken })
        await fetchMe()

        router.replace('/dashboard')
      } catch (err: unknown) {
        const message =
          (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
            ?.message
        const text = Array.isArray(message)
          ? message.join(', ')
          : message || (err instanceof Error ? err.message : 'SSO login failed')
        setError(text)
      }
    }

    run()
  }, [searchParams, router, fetchMe, setAuth])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black px-4">
      <div className="max-w-md w-full rounded-lg border border-gray-700 bg-gray-800/50 p-8 shadow-xl backdrop-blur-lg text-center">
        {error ? (
          <>
            <h2 className="text-xl font-semibold text-white mb-2">SSO login failed</h2>
            <p className="text-sm text-red-400 mb-6">{error}</p>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="px-6 py-2 rounded-lg bg-lime-400 text-black font-semibold hover:bg-lime-500 transition"
            >
              Go to login
            </button>
          </>
        ) : (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-lime-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white">Logging you in…</h2>
            <p className="text-sm text-gray-400 mt-2">
              Verifying your StormBuddi session
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function SsoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-black text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin text-lime-400" />
        </div>
      }
    >
      <SsoLoginContent />
    </Suspense>
  )
}
