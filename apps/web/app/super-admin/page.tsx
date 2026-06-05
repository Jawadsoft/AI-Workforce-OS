'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SuperAdminRoot() {
  const router = useRouter()
  useEffect(() => {
    const token = localStorage.getItem('sa_access_token')
    router.replace(token ? '/super-admin/dashboard' : '/super-admin/login')
  }, [router])
  return null
}
