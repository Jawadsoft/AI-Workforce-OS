'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  CloudLightning,
  FileText,
  Inbox,
  Loader2,
  Menu,
  MessageSquare,
  Phone,
  Play,
  Plug,
  Share2,
  Shield,
  Ticket,
  Users,
  Webhook,
  X,
} from 'lucide-react'

const ACCENT = '#C1FF00'

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Workforce', href: '#workforce' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Free Demo', href: '#demo' },
]

const DEMO_INDUSTRIES = [
  'Roofing & Storm',
  'Car Dealership',
  'Cleaning & Field Service',
  'Security',
  'Property Management',
  'Healthcare',
  'Construction',
  'Real Estate',
  'Other',
]

const VALUE_CARDS = [
  {
    icon: Users,
    title: 'AI Workforce',
    body: 'Industry agents with roles, tools & CRM access.',
  },
  {
    icon: Plug,
    title: 'CRM Connected',
    body: 'HubSpot, StormBuddi, JobNimbus & more.',
  },
  {
    icon: Shield,
    title: 'Human Approvals',
    body: 'Sensitive actions wait for your team.',
  },
  {
    icon: Phone,
    title: 'Omnichannel Ops',
    body: 'Chat, SMS, WhatsApp, email & social.',
  },
]

const INTEGRATIONS = [
  'HubSpot',
  'StormBuddi',
  'Salesforce',
  'Zoho',
  'JobNimbus',
  'Twilio',
]

const PLATFORM_FEATURES = [
  {
    icon: Users,
    title: 'AI Workforce & Marketplace',
    body: 'Deploy named AI employees from industry templates — or build custom agents with prompts, tools, knowledge, and CRM permissions.',
  },
  {
    icon: MessageSquare,
    title: 'Agent Chat & Widget',
    body: 'Streaming chat with action cards for tasks, CRM updates, and PDFs. Embed a website widget that routes customers into tickets.',
  },
  {
    icon: Ticket,
    title: 'Tickets & Tasks',
    body: 'Multi-agent work tickets from chat/widget, plus a task queue for estimates, notes, emails, appointments, and follow-ups.',
  },
  {
    icon: Clock,
    title: 'Approvals & Email Review',
    body: 'Human-in-the-loop queues for CRM writes, outbound email, and document sends — plus flagged inbox review before replies go out.',
  },
  {
    icon: BookOpen,
    title: 'Knowledge Base (RAG)',
    body: 'Upload PDFs, DOCX, sheets, and more. Agents retrieve company knowledge at runtime so answers stay on-brand and accurate.',
  },
  {
    icon: FileText,
    title: 'Document Generation',
    body: 'Generate estimates, proposals, inspection reports, storm reports, scopes, and material lists as PDF or DOCX.',
  },
  {
    icon: Plug,
    title: 'CRM Integrations',
    body: 'Connect HubSpot, StormBuddi, Laravel CRM, Salesforce, Zoho, JobNimbus, or a custom API — with per-agent CRM access controls.',
  },
  {
    icon: Phone,
    title: 'Communications',
    body: 'Twilio SMS, WhatsApp, and Voice. Agents can auto-reply on inbound messages with full send logs and settings.',
  },
  {
    icon: Share2,
    title: 'Social Media',
    body: 'Generate, review, schedule, and publish posts across Facebook, Instagram, LinkedIn, and X from one calendar.',
  },
  {
    icon: Webhook,
    title: 'Webhooks',
    body: 'Trigger agents on business events — lead created, job scheduled, proposal accepted, appointment booked, and more.',
  },
  {
    icon: CloudLightning,
    title: 'Storm Data',
    body: 'NOAA SPC hail, wind, and tornado reports by date and state — built for roofing and storm-damage workflows.',
  },
  {
    icon: CheckSquare,
    title: 'Analytics & Team',
    body: 'Ops KPIs, AI workforce metrics, multi-tenant RBAC, and team roles so every operator stays in control.',
  },
]

const SOLUTIONS = [
  {
    industry: 'Roofing & Storm',
    body: 'Lead → inspection → estimate → insurance claim → job. Storm Analyst + NOAA data + StormBuddi-depth CRM tools.',
    agents: 'Cris · Jared · Arturo · Kevin',
  },
  {
    industry: 'Car Dealership',
    body: 'Sales, inventory, finance, trade-ins, appointments, and marketing agents working your dealership pipeline.',
    agents: 'Will · Inventory · Finance · Appointments',
  },
  {
    industry: 'Cleaning & Field Service',
    body: 'Quotes, scheduling, and operations for job-based businesses — wired to JobNimbus or your native CRM.',
    agents: 'Quote · Scheduler · Operations · Nora',
  },
  {
    industry: 'Security',
    body: 'Tenders, compliance, guard scheduling, and ops assistants with approval guardrails on sensitive work.',
    agents: 'Tender · Compliance · Scheduler',
  },
  {
    industry: 'Property Management',
    body: 'Tenant intake, leasing, maintenance coordination, and inspections — chat, tickets, and documents included.',
    agents: 'Tenant · Leasing · Maintenance',
  },
  {
    industry: 'Healthcare',
    body: 'Patient coordination, appointments, billing support, and compliance-aware documentation workflows.',
    agents: 'Patient · Appointments · Billing',
  },
  {
    industry: 'Construction',
    body: 'Estimating, project coordination, procurement, safety, and tender support across the job lifecycle.',
    agents: 'Estimator · Project · Procurement',
  },
  {
    industry: 'Real Estate',
    body: 'Lead qualification, property matching, leasing, and marketing agents connected to your CRM and channels.',
    agents: 'Charlie · Property · Marketing',
  },
]

const STEPS = [
  {
    step: '01',
    title: 'Analyze your website',
    body: 'Paste your URL and Brain enrich auto-fills industry, services, locations, and brand voice.',
  },
  {
    step: '02',
    title: 'Choose industry & CRM',
    body: 'Pick your vertical and connect HubSpot, StormBuddi, JobNimbus, Salesforce, Zoho, or none.',
  },
  {
    step: '03',
    title: 'Set business rules',
    body: 'Define services, locations, operating rules, and voice so every agent works your way.',
  },
  {
    step: '04',
    title: 'Generate your workforce',
    body: 'Instantly create named AI employees from industry templates — ready to chat, take tickets, and run tools.',
  },
  {
    step: '05',
    title: 'Connect & go live',
    body: 'Wire knowledge, webhooks, Twilio, social, and the embed widget — with approvals on sensitive actions.',
  },
]

const ROLES = [
  { name: 'Will — Sales Assistant', focus: 'Pipeline, follow-ups & closing support' },
  { name: 'Nora — Customer Intake', focus: 'Inbound chat, tickets & qualification' },
  { name: 'Cris — Estimator', focus: 'Quotes, pricing & estimate documents' },
  { name: 'Jared — Field Inspector', focus: 'Inspections & field reports' },
  { name: 'Arturo — Storm Analyst', focus: 'Storm damage lookup & NOAA data' },
  { name: 'Kevin — Insurance Specialist', focus: 'Claims assistance & documentation' },
  { name: 'Rex — Marketing Assistant', focus: 'Campaigns & outbound messaging' },
  { name: 'Zara — Social Media Agent', focus: 'Posts, scheduling & review→publish' },
  { name: 'Blake — Content Agent', focus: 'Blogs & long-form content' },
  { name: 'Hanna — Executive Assistant', focus: 'Coordination, notes & follow-through' },
]

function DemoRequestForm() {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [form, setForm] = useState({ name: '', email: '', company: '', phone: '', industry: '' })

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('submitting')
    window.setTimeout(() => setStatus('success'), 700)
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: `${ACCENT}1f` }}
        >
          <CheckCircle2 className="h-7 w-7" style={{ color: ACCENT }} />
        </span>
        <h3 className="text-xl font-semibold text-white">You&rsquo;re on the list</h3>
        <p className="max-w-sm text-sm text-white/55">
          Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''} — our team will reach out within one business day
          to schedule your free AI workforce demo.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-1">
        <label className="mb-1.5 block text-xs font-medium text-white/60">Full name</label>
        <input
          required
          value={form.name}
          onChange={update('name')}
          placeholder="Jordan Smith"
          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#C1FF00]/55 focus:bg-white/[0.06]"
        />
      </div>
      <div className="sm:col-span-1">
        <label className="mb-1.5 block text-xs font-medium text-white/60">Work email</label>
        <input
          required
          type="email"
          value={form.email}
          onChange={update('email')}
          placeholder="you@company.com"
          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#C1FF00]/55 focus:bg-white/[0.06]"
        />
      </div>
      <div className="sm:col-span-1">
        <label className="mb-1.5 block text-xs font-medium text-white/60">Company</label>
        <input
          required
          value={form.company}
          onChange={update('company')}
          placeholder="Company name"
          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#C1FF00]/55 focus:bg-white/[0.06]"
        />
      </div>
      <div className="sm:col-span-1">
        <label className="mb-1.5 block text-xs font-medium text-white/60">Phone (optional)</label>
        <input
          type="tel"
          value={form.phone}
          onChange={update('phone')}
          placeholder="(555) 123-4567"
          className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-[#C1FF00]/55 focus:bg-white/[0.06]"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-xs font-medium text-white/60">Industry</label>
        <select
          required
          value={form.industry}
          onChange={update('industry')}
          className="w-full appearance-none rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition focus:border-[#C1FF00]/55 focus:bg-white/[0.06]"
        >
          <option value="" disabled className="bg-[#141414]">
            Select your industry
          </option>
          {DEMO_INDUSTRIES.map((industry) => (
            <option key={industry} value={industry} className="bg-[#141414]">
              {industry}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-70 sm:col-span-2"
        style={{
          backgroundColor: ACCENT,
          boxShadow: `0 0 28px ${ACCENT}55`,
        }}
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          <>
            Apply for Free Demo
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      <p className="text-xs text-white/35 sm:col-span-2">
        No commitment — we&rsquo;ll walk through your industry&rsquo;s AI workforce and answer questions live.
      </p>
    </form>
  )
}

export function LandingPage() {
  const reduceMotion = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white antialiased">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[50vh] w-[70vw] -translate-x-1/2 rounded-full bg-[#C1FF00]/[0.06] blur-[120px]" />
        <div className="absolute right-[-10%] top-[20%] h-[40vh] w-[40vw] rounded-full bg-[#C1FF00]/[0.04] blur-[100px]" />
      </div>

      <header className="relative z-50">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="text-xl font-bold tracking-tight sm:text-2xl">AI Workforce</span>
            <span
              className="flex h-6 w-6 items-center justify-center rounded-[5px] border-2"
              style={{ borderColor: ACCENT, color: ACCENT }}
            >
              <Box className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
          </a>

          <nav className="hidden items-center gap-7 xl:flex">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="inline-flex items-center gap-1 text-[15px] font-medium text-white/85 transition hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden items-center gap-2 text-sm text-white/70 lg:flex">
              <span className="relative flex h-2 w-2">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                  style={{ backgroundColor: ACCENT }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: ACCENT }} />
              </span>
              <span>Multi-tenant CRM OS</span>
            </div>

            <a
              href="#demo"
              className="hidden items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/90 transition hover:border-white/40 hover:text-white md:inline-flex"
            >
              Free Demo
            </a>

            <Link
              href="/login"
              className="hidden items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 sm:inline-flex"
              style={{
                backgroundColor: ACCENT,
                borderColor: ACCENT,
                boxShadow: `0 0 24px ${ACCENT}55`,
              }}
            >
              Get Started
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white">
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>

            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white xl:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-white/10 bg-black/95 px-5 pb-6 pt-4 xl:hidden">
            <nav className="flex flex-col gap-4">
              {NAV.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="text-base text-white/85"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <Link href="/login" className="text-sm text-white/60" onClick={() => setMenuOpen(false)}>
                Sign in
              </Link>
              <a
                href="#demo"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 text-sm font-medium text-white/90"
                onClick={() => setMenuOpen(false)}
              >
                Apply for Free Demo
              </a>
              <Link
                href="/login"
                className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold text-black"
                style={{ backgroundColor: ACCENT }}
                onClick={() => setMenuOpen(false)}
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main id="top" className="relative z-10">
        {/* Hero */}
        <section className="relative mx-auto max-w-[1400px] px-5 pb-10 pt-4 sm:px-8 lg:px-10 lg:pb-14 lg:pt-6">
          <div className="grid items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6">
            <div className="relative z-20 pt-2 lg:pt-8">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#C1FF00]/35 bg-[#C1FF00]/10 px-3.5 py-1.5"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: ACCENT }}>
                  AI Automation Specialists
                </span>
              </motion.div>

              <motion.h1
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.05 }}
                className="max-w-[12ch] text-[clamp(2.6rem,6.2vw,5.4rem)] font-bold uppercase leading-[0.95] tracking-[-0.03em]"
              >
                Scale your operations{' '}
                <span style={{ color: ACCENT }}>10x</span> without hiring{' '}
                <span style={{ color: ACCENT }}>100 people.</span>
              </motion.h1>

              <motion.p
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.12 }}
                className="mt-6 max-w-md text-base leading-relaxed text-white/65 sm:text-lg"
              >
                Deploy role-based AI employees that handle repetitive work across your CRM, knowledge, documents,
                and approvals — so you can focus on growth, not grunt work.
              </motion.p>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.18 }}
                className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center gap-2.5 rounded-full px-5 text-sm font-bold text-black transition hover:brightness-110"
                  style={{
                    backgroundColor: ACCENT,
                    boxShadow: `0 0 32px ${ACCENT}66`,
                  }}
                >
                  Get Started
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-white">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>

                <a
                  href="#demo"
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white/90 transition hover:border-white/40 hover:text-white"
                >
                  <Calendar className="h-4 w-4" style={{ color: ACCENT }} />
                  Apply for Free Demo
                </a>
              </motion.div>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="mt-5 flex items-center gap-3"
              >
                <div className="flex -space-x-2">
                  {['W', 'N', 'C', 'Z'].map((letter, i) => (
                    <div
                      key={letter}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-black text-[11px] font-bold text-black"
                      style={{ backgroundColor: ACCENT, zIndex: 4 - i, opacity: 1 - i * 0.08 }}
                    >
                      {letter}
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-sm font-medium text-white/90">Will · Nora · Cris · Zara</p>
                  <p className="text-xs text-white/45">Industry AI employees, ready in minutes</p>
                </div>
              </motion.div>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.24 }}
                className="mt-5"
              >
                <a
                  href="#how-it-works"
                  className="inline-flex h-12 items-center gap-3 rounded-full border border-white/20 bg-white/[0.03] px-5 text-sm font-medium text-white/90 backdrop-blur transition hover:border-white/35 hover:bg-white/[0.06]"
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <Play className="h-3.5 w-3.5 fill-black text-black" />
                  </span>
                  <span className="text-left leading-tight">
                    <span className="block font-semibold">See How It Works</span>
                    <span className="block text-xs text-white/45">Website → CRM → live AI team</span>
                  </span>
                </a>
              </motion.div>
            </div>

            <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none lg:justify-self-end">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, delay: 0.1 }}
                className="relative mx-auto aspect-square w-full max-w-[520px]"
              >
                {/* Soft lime glow behind diamond */}
                <div
                  aria-hidden
                  className="absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    background: `radial-gradient(circle, ${ACCENT}45 0%, transparent 68%)`,
                    filter: 'blur(20px)',
                  }}
                />

                {/* Hexagon frame with clipped operator photo */}
                <div className="absolute left-1/2 top-1/2 h-[90%] w-[90%] -translate-x-1/2 -translate-y-1/2">
                  <div
                    className="absolute inset-0 bg-[#0a0d09]"
                    style={{
                      clipPath: 'polygon(50% 2%, 93% 26%, 93% 74%, 50% 98%, 7% 74%, 7% 26%)',
                    }}
                  >
                    <img
                      src="/marketing/hero-operator.jpg"
                      alt="AI workforce operator"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ objectPosition: '50% 32%', transform: 'scale(1.32)' }}
                    />
                    {/* Vignette to fade checkerboard/background edges into black */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          'radial-gradient(circle at 50% 42%, transparent 46%, rgba(5,8,5,0.55) 72%, rgba(5,8,5,0.95) 100%)',
                      }}
                    />
                  </div>

                  {/* Neon hexagon borders */}
                  <svg
                    aria-hidden
                    viewBox="0 0 200 200"
                    className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                  >
                    <polygon
                      points="100,4 186,52 186,148 100,196 14,148 14,52"
                      fill="none"
                      stroke={ACCENT}
                      strokeWidth="1.8"
                      opacity="0.95"
                      style={{ filter: `drop-shadow(0 0 10px ${ACCENT}) drop-shadow(0 0 22px ${ACCENT}88)` }}
                    />
                    <polygon
                      points="100,16 174,58 174,142 100,184 26,142 26,58"
                      fill="none"
                      stroke={ACCENT}
                      strokeWidth="0.7"
                      opacity="0.4"
                    />
                  </svg>
                </div>

                {/* Stats widget */}
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45, duration: 0.5 }}
                  className="absolute right-0 top-[22%] z-10 w-[150px] rounded-2xl border border-white/10 bg-[#121212]/90 p-3.5 shadow-2xl backdrop-blur-xl sm:right-1 sm:w-[168px] sm:p-4"
                >
                  <p className="text-[11px] text-white/50">AI Agents Active</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight">12</p>
                  <div className="mt-2">
                    <span className="text-[11px] font-medium" style={{ color: ACCENT }}>
                      Tasks + approvals live
                    </span>
                  </div>
                  <svg viewBox="0 0 120 36" className="mt-2 h-8 w-full overflow-visible">
                    <polyline
                      fill="none"
                      stroke={ACCENT}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points="0,28 18,24 36,26 54,16 72,18 90,8 120,4"
                      style={{ filter: `drop-shadow(0 0 6px ${ACCENT})` }}
                    />
                  </svg>
                </motion.div>
              </motion.div>
            </div>
          </div>

          {/* Value cards */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-4">
            {VALUE_CARDS.map((card, i) => (
              <motion.div
                key={card.title}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * 0.06, duration: 0.45 }}
                className="rounded-2xl border border-white/10 bg-[#141414]/90 p-5 backdrop-blur-md"
              >
                <card.icon className="h-5 w-5" style={{ color: ACCENT }} />
                <h3 className="mt-4 text-[15px] font-semibold text-white">{card.title}</h3>
                <p className="mt-1 text-sm text-white/45">{card.body}</p>
              </motion.div>
            ))}
          </div>

          {/* Integrations strip + CTA */}
          <div id="integrations" className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-2xl border border-white/10 bg-[#141414]/90 px-6 py-5 backdrop-blur-md sm:px-8">
              {INTEGRATIONS.map((name) => (
                <span
                  key={name}
                  className="text-sm font-semibold tracking-wide text-white/55 sm:text-base"
                >
                  {name}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#141414]/90 px-5 py-5 backdrop-blur-md sm:px-6">
              <p className="max-w-[240px] text-sm leading-snug text-white/75">
                Ready to deploy your AI workforce? Sign in and generate your team in minutes.
              </p>
              <Link
                href="/login"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-black transition hover:brightness-110"
                style={{
                  backgroundColor: ACCENT,
                  boxShadow: `0 0 28px ${ACCENT}66`,
                }}
                aria-label="Get started"
              >
                <ArrowUpRight className="h-5 w-5" strokeWidth={2.5} />
              </Link>
            </div>
          </div>
        </section>

        {/* Platform features */}
        <section id="features" className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
              Platform features
            </p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold uppercase tracking-tight sm:text-5xl">
              Everything in your <span style={{ color: ACCENT }}>AI CRM OS</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base text-white/50">
              The same modules your operators use daily — AI Workforce, Chat, Tickets, Tasks, Approvals,
              Knowledge, Documents, Social, CRM, Communications, Webhooks, Analytics, and Storm Data.
            </p>

            <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {PLATFORM_FEATURES.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: (i % 3) * 0.05, duration: 0.4 }}
                  className="rounded-2xl border border-white/10 bg-[#141414]/80 p-6 backdrop-blur-md"
                >
                  <feature.icon className="h-5 w-5" style={{ color: ACCENT }} />
                  <h3 className="mt-4 text-lg font-semibold text-white">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">{feature.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Solutions */}
        <section id="solutions" className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
              Industry solutions
            </p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold uppercase tracking-tight sm:text-5xl">
              Built for how <span style={{ color: ACCENT }}>your industry</span> works
            </h2>
            <p className="mt-4 max-w-2xl text-base text-white/50">
              Onboarding generates a tailored agent roster for your vertical — not a generic chatbot.
            </p>

            <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {SOLUTIONS.map((solution) => (
                <div
                  key={solution.industry}
                  className="rounded-2xl border border-white/10 bg-[#141414]/80 p-5 backdrop-blur-md"
                >
                  <h3 className="text-base font-semibold text-white">{solution.industry}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">{solution.body}</p>
                  <p className="mt-4 text-xs font-medium" style={{ color: ACCENT }}>
                    {solution.agents}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
              How it works
            </p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold uppercase tracking-tight sm:text-5xl">
              From website to <span style={{ color: ACCENT }}>live workforce</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base text-white/50">
              The same 5-step onboarding in the product — about two minutes to your first AI team.
            </p>
            <ol className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {STEPS.map((step) => (
                <li
                  key={step.step}
                  className="rounded-2xl border border-white/10 bg-[#141414]/80 p-5 backdrop-blur-md"
                >
                  <span className="text-sm font-bold" style={{ color: ACCENT }}>
                    {step.step}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/50">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Workforce */}
        <section id="workforce" className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
              Your AI team
            </p>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold uppercase tracking-tight sm:text-5xl">
              Named employees — <span style={{ color: ACCENT }}>not prompts</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base text-white/50">
              Each agent ships with a role, tools, knowledge access, CRM permissions, and approval rules.
              Add more from the Marketplace or Custom Agent Builder anytime.
            </p>
            <ul className="mt-12 divide-y divide-white/10 border-y border-white/10">
              {ROLES.map((role) => (
                <li
                  key={role.name}
                  className="flex flex-col gap-1 py-5 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <span className="text-lg font-semibold sm:text-xl">{role.name}</span>
                  <span className="text-sm text-white/40">{role.focus}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Free demo request */}
        <section id="demo" className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
                  Free demo
                </p>
                <h2 className="mt-3 max-w-md text-3xl font-bold uppercase tracking-tight sm:text-5xl">
                  See your <span style={{ color: ACCENT }}>AI workforce</span> live
                </h2>
                <p className="mt-4 max-w-md text-base text-white/50">
                  Apply for a free, guided demo. We&rsquo;ll show you the exact AI employees, CRM integration, and
                  workflows generated for your industry — no setup required on your end.
                </p>
                <ul className="mt-8 space-y-3">
                  {[
                    'Live walkthrough of your industry agent roster',
                    'See CRM, knowledge, and approvals in action',
                    'No cost, no commitment',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-white/70">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#141414]/80 p-6 backdrop-blur-md sm:p-8">
                <DemoRequestForm />
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative border-t border-white/10 py-24">
          <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-10">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#111] px-8 py-14 sm:px-14">
              <div
                aria-hidden
                className="absolute -right-20 -top-20 h-64 w-64 rounded-full blur-[90px]"
                style={{ backgroundColor: `${ACCENT}22` }}
              />
              <div className="flex items-center gap-2">
                <Inbox className="h-4 w-4" style={{ color: ACCENT }} />
                <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
                  AI Workforce OS
                </p>
              </div>
              <h2 className="mt-4 max-w-3xl text-3xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
                Deploy your AI CRM workforce today
              </h2>
              <p className="mt-4 max-w-xl text-base text-white/55">
                Sign in, run onboarding, connect your CRM, and launch agents for chat, tickets, documents,
                communications, and social — with approvals when it matters.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-black transition hover:brightness-110"
                  style={{
                    backgroundColor: ACCENT,
                    boxShadow: `0 0 32px ${ACCENT}66`,
                  }}
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#demo"
                  className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-medium text-white/80 transition hover:border-white/40 hover:text-white"
                >
                  Apply for Free Demo
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div className="flex items-center gap-2">
            <span className="font-bold">AI Workforce</span>
            <span
              className="flex h-5 w-5 items-center justify-center rounded-[4px] border"
              style={{ borderColor: ACCENT, color: ACCENT }}
            >
              <Box className="h-3 w-3" />
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/40">
            <a href="#features" className="hover:text-white/70">Features</a>
            <a href="#solutions" className="hover:text-white/70">Solutions</a>
            <a href="#integrations" className="hover:text-white/70">Integrations</a>
            <a href="#demo" className="hover:text-white/70">Free Demo</a>
            <Link href="/login" className="hover:text-white/70">Sign in</Link>
          </div>
          <p className="text-sm text-white/35">
            © {new Date().getFullYear()} AI Workforce. All rights reserved. Powered by Mitiesoft
          </p>
        </div>
      </footer>
    </div>
  )
}
