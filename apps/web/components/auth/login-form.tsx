'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth.store'
import { Zap, Loader2, Mail, Lock } from 'lucide-react'

export function LoginForm() {
  const router = useRouter()
  const { login, isLoading } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isRedirecting, setIsRedirecting] = useState(false)

  const busy = isLoading || isRedirecting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
      setIsRedirecting(true)
      router.push('/dashboard')
    } catch (err: any) {
      setIsRedirecting(false)
      const apiMessage = err?.response?.data?.message
      const message = Array.isArray(apiMessage) ? apiMessage[0] : apiMessage
      setError(message || 'Invalid credentials')
    }
  }

  return (
    <div
      className="rounded-3xl p-8 space-y-7"
      style={{
        background: 'rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 8px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {/* Logo */}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-[#C1FF00]/25 blur-md scale-125" />
          <div
            className="relative w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              background: '#C1FF00',
              border: '1px solid rgba(193,255,0,0.6)',
              boxShadow: '0 0 28px rgba(193,255,0,0.45)',
            }}
          >
            <Zap className="w-6 h-6 text-black" />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Unlock the power of AI
          </h1>
          <p className="text-gray-300 text-sm mt-1">
            Sign in to your AI Workforce OS
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-red-500/15 border border-red-400/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Email */}
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none transition-all"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
            onFocus={e => {
              e.currentTarget.style.border = '1px solid rgba(193,255,0,0.55)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.10)'
            }}
            onBlur={e => {
              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
            }}
          />
        </div>

        {/* Password */}
        <div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
              onFocus={e => {
                e.currentTarget.style.border = '1px solid rgba(193,255,0,0.55)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.10)'
              }}
              onBlur={e => {
                e.currentTarget.style.border = '1px solid rgba(255,255,255,0.12)'
                e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
              }}
            />
          </div>
          <div className="flex justify-end mt-1.5">
            <Link href="/forgot-password" className="text-xs text-gray-400 hover:text-white transition-colors">
              Forgot password?
            </Link>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-black tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: '#C1FF00',
            border: '1px solid rgba(193,255,0,0.8)',
            boxShadow: '0 4px 24px rgba(193,255,0,0.35)',
          }}
          onMouseEnter={e => {
            if (!busy) {
              e.currentTarget.style.background = '#d4ff33'
              e.currentTarget.style.boxShadow = '0 4px 32px rgba(193,255,0,0.5)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = '#C1FF00'
            e.currentTarget.style.boxShadow = '0 4px 24px rgba(193,255,0,0.35)'
          }}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {isRedirecting ? 'Loading workspace...' : busy ? 'Signing in...' : 'LOGIN'}
        </button>
      </form>

      {/* Footer */}
      <p className="text-center text-sm text-gray-400">
        No account?{' '}
        <Link href="/register" className="text-white font-medium hover:underline transition-colors">
          Create one
        </Link>
      </p>
    </div>
  )
}
