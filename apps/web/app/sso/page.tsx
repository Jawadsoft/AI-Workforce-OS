'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function SsoTestContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const source = searchParams.get('source')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black px-4">
      <div className="max-w-2xl w-full rounded-lg border border-gray-700 bg-gray-800/50 p-8 shadow-xl backdrop-blur-lg">
        <h1 className="text-2xl font-semibold text-white mb-2">SSO Test Page</h1>
        <p className="text-sm text-gray-400 mb-6">
          Token handoff from StormBuddi — no login attempted.
        </p>

        <div className="space-y-4 font-mono text-sm">
          <div>
            <p className="text-gray-500 mb-1">source</p>
            <p className="text-lime-400 break-all">{source ?? '(missing)'}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">token</p>
            <pre className="text-lime-400 whitespace-pre-wrap break-all rounded border border-gray-700 bg-black/40 p-4">
              {token ?? '(missing)'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SsoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-black text-gray-400">
          Loading…
        </div>
      }
    >
      <SsoTestContent />
    </Suspense>
  )
}
