'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

function getSAToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('sa_access_token')
}

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    const token = getSAToken()
    if (!token && window.location.pathname !== '/super-admin/login') {
      router.replace('/super-admin/login')
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {children}
    </div>
  )
}
