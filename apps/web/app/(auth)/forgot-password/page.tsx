'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shadow">
            <Zap className="w-6 h-6 text-white" />
          </div>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center space-y-4">
            <div className="text-4xl">📧</div>
            <h1 className="text-xl font-bold text-gray-900">Check your inbox</h1>
            <p className="text-gray-500 text-sm">
              If <strong>{email}</strong> is registered, you'll receive a password reset link shortly.
            </p>
            <p className="text-gray-400 text-xs">Check your spam folder if you don't see it within a minute.</p>
            <Link
              href="/login"
              className="block mt-4 text-sm text-blue-600 hover:underline"
            >
              ← Back to login
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Forgot password?</h1>
              <p className="text-gray-500 text-sm mt-1">Enter your email and we'll send you a reset link.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              Remember it?{' '}
              <Link href="/login" className="text-blue-600 hover:underline font-medium">
                Back to login
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
