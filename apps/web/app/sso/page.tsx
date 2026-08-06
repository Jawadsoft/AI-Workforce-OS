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
      // Get token and source from URL parameters
      const token = searchParams.get('token')
      const source = searchParams.get('source') || 'stormbuddi'

      try {
        if (!token) {
          setError('Missing SSO token')
          setProcessing(false)
          return
        }

        // Call the SSO login endpoint
        console.log('Making SSO login request to:', `${process.env.NEXT_PUBLIC_API_URL}/auth/sso-login`)
        console.log('With token:', token)
        console.log('With source:', source)
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/sso-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token, source }),
        })

        console.log('Response status:', response.status)
        console.log('Response ok:', response.ok)

        if (!response.ok) {
          const errorData = await response.json()
          console.error('Error response data:', errorData)
          throw new Error(errorData.message || 'SSO login failed')
        }

        const { access_token } = await response.json()

        // Store the JWT token
        localStorage.setItem('access_token', access_token)

        // Redirect to dashboard
        router.push('/dashboard')
      } catch (err) {
        console.error('SSO login error:', err)
        console.error('API URL being called:', process.env.NEXT_PUBLIC_API_URL)
        console.error('Token:', token)
        console.error('Source:', source)
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
            <h2 className="text-xl font-semibold text-white">Login Failed - Debug Mode</h2>
            <p className="text-sm text-gray-400 text-center">{error}</p>
            <div className="mt-4 p-4 bg-gray-900/50 rounded border border-gray-700 text-left w-full">
              <p className="text-xs text-gray-300 mb-2 font-semibold">Debug Information:</p>
              <p className="text-xs text-gray-400 break-all">
                Open browser console (F12) to see detailed error logs
              </p>
              <p className="text-xs text-gray-400 mt-2">
                API URL: {process.env.NEXT_PUBLIC_API_URL || 'NOT SET'}
              </p>
              <p className="text-xs text-gray-400">
                Token: {searchParams.get('token')?.substring(0, 20)}...
              </p>
              <p className="text-xs text-gray-400">
                Source: {searchParams.get('source')}
              </p>
            </div>
            <button
              onClick={() => {
                console.log('=== FULL DEBUG INFO ===');
                console.log('Error:', error);
                console.log('API URL:', process.env.NEXT_PUBLIC_API_URL);
                console.log('Full Token:', searchParams.get('token'));
                console.log('Source:', searchParams.get('source'));
                // Temporarily disabled redirect for debugging
                // router.push('/login')
              }}
              className="mt-4 px-6 py-2 bg-lime-400 text-black font-semibold rounded-lg hover:bg-lime-500 transition"
            >
              Copy Debug Info to Console
            </button>
            <button
              onClick={() => router.push('/login')}
              className="mt-2 px-6 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition"
            >
              Go to Login
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
