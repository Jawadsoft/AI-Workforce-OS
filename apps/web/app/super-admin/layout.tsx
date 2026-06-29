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
    <div className="min-h-screen bg-[#111111] text-white relative overflow-hidden">
      {/* Background glow orbs */}
      <div className="pointer-events-none fixed top-[-120px] left-[-120px] w-[600px] h-[600px] rounded-full bg-gray-600/10 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-gray-500/10 blur-[120px]" />
      <div className="pointer-events-none fixed top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-gray-700/8 blur-[100px]" />

      {/* Subtle grid texture */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}
