'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function SsoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    const handleSsoLogin = async () => {
      try {
        // Get token and source from URL parameters
        const token = searchParams.get('token')
        const source = searchParams.get('source') || 'stormbuddi'

        if (!token) {
          setError('Missing SSO token')
          setProcessing(false)
          return
        }

        // Call the SSO login endpoint
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sso-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, source }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || 'SSO login failed')
        }

        const { access_token } = await response.json()

        // Store the JWT token
        localStorage.setItem('access_token', access_token)

        // Redirect to dashboard
        router.push('/dashboard')
      } catch (err) {
        console.error('SSO login error:', err)
        setError(err instanceof Error ? err.message : 'SSO login failed')
        setProcessing(false)
      }
    }

    handleSsoLogin()
  }, [searchParams, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black">
      <div className="max-w-md w-full px-6 py-8 bg-gray-800/50 backdrop-blur-lg border border-gray-700 rounded-lg shadow-xl">
        {processing ? (
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-lime-400" />
            <h2 className="text-xl font-semibold text-white">Logging you in...</h2>
            <p className="text-sm text-gray-400 text-center">
              Please wait while we verify your credentials
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg
                className="h-6 w-6 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white">Login Failed</h2>
            <p className="text-sm text-gray-400 text-center">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="mt-4 px-6 py-2 bg-lime-400 text-black font-semibold rounded-lg hover:bg-lime-500 transition"
            >
              Go to Login
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
