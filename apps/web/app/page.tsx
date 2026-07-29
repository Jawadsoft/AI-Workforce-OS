import type { Metadata } from 'next'
import { Space_Grotesk } from 'next/font/google'
import { LandingPage } from '@/components/marketing/landing-page'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-landing',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AI Workforce OS — Hire an AI Workforce Inside Your CRM',
  description:
    'Multi-tenant AI employee platform: industry agents, CRM integrations, approvals, knowledge, documents, tickets, Twilio communications, social, webhooks, and storm data.',
}

export default function RootPage() {
  return (
    <div
      className={spaceGrotesk.variable}
      style={{ fontFamily: 'var(--font-landing), system-ui, sans-serif' }}
    >
      <LandingPage />
    </div>
  )
}
