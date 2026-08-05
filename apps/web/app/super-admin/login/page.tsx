'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { Shield, Mail, Lock, Loader2 } from 'lucide-react'

function getApiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001/api/v1`
  }
  return 'http://localhost:3001/api/v1'
}

export default function SuperAdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await axios.post(`${getApiUrl()}/auth/login`, { email, password })
      const token = data.access_token
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.role !== 'SUPER_ADMIN' && payload.role !== 'SCOPED_ADMIN') {
        setError('Access denied: not a super admin account')
        return
      }
      localStorage.setItem('sa_access_token', token)
      // Also populate the shared session token/cookie so pages that use the
      // regular auth store (e.g. /help) recognize this super-admin as logged in.
      localStorage.setItem('access_token', token)
      document.cookie = `access_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
      router.replace('/super-admin/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div
          className="rounded-3xl p-8 space-y-7"
          style={{
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 8px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.07)',
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-white/10 blur-md scale-125" />
              <div
                className="relative w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  boxShadow: '0 0 24px rgba(255,255,255,0.10)',
                }}
              >
                <Shield className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Super Admin</h1>
              <p className="text-gray-400 text-sm mt-1">Platform administration portal</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-500/15 border border-red-400/30 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@platform.com"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onFocus={e => {
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.30)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
                }}
                onBlur={e => {
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                }}
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
                onFocus={e => {
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.30)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.09)'
                }}
                onBlur={e => {
                  e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                }}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #374151 0%, #1f2937 100%)',
                border: '1px solid rgba(255,255,255,0.15)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #4b5563 0%, #374151 100%)'
                  e.currentTarget.style.boxShadow = '0 4px 30px rgba(255,255,255,0.08)'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #374151 0%, #1f2937 100%)'
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'
              }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Signing in...' : 'SIGN IN'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
