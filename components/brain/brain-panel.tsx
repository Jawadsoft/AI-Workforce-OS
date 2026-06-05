'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Brain, RefreshCw, Loader2, Globe, CheckCircle, ChevronDown, ChevronUp,
  Save, Phone, Mail, MapPin, Star, Users, Award, DollarSign, Link2
} from 'lucide-react'
import { WebsiteAnalyzer } from './website-analyzer'
import { CRMSetupGuideModal } from './crm-setup-guide'

const INDUSTRY_LABELS: Record<string, string> = {
  ROOFING: 'Roofing', CAR_DEALERSHIP: 'Car Dealership', CLEANING: 'Cleaning',
  SECURITY: 'Security', PROPERTY_MANAGEMENT: 'Property Management',
  HEALTHCARE: 'Healthcare', CONSTRUCTION: 'Construction',
  REAL_ESTATE: 'Real Estate', OTHER: 'Other',
}

const CRM_LABELS: Record<string, string> = {
  HUBSPOT: 'HubSpot', SALESFORCE: 'Salesforce', JOBNIMBUS: 'JobNimbus',
  LARAVEL: 'Laravel CRM', ZOHO: 'Zoho CRM', CUSTOM: 'Custom API', NONE: 'None',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      </div>
      {children}
    </div>
  )
}

function TagList({ items, color = 'default' }: { items: string[]; color?: 'default' | 'green' | 'blue' }) {
  if (!items?.length) return <p className="text-sm text-muted-foreground">—</p>
  const cls = color === 'green' ? 'bg-green-500/10 text-green-700 dark:text-green-300'
    : color === 'blue' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
    : 'bg-muted text-foreground'
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{item}</span>
      ))}
    </div>
  )
}

export function BrainPanel() {
  const qc = useQueryClient()
  const [showReanalyze, setShowReanalyze] = useState(false)
  const [showGuide, setShowGuide] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState({
    targetCustomerProfile: '',
    competitors: '',
    priceRange: '',
    forbiddenTopics: '',
    escalationContacts: '',
    uniqueSellingPoints: '',
  })

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['brain-profile'],
    queryFn: () => api.get('/brain/profile').then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/brain/manual-context', manual),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brain-profile'] })
      setShowManual(false)
    },
  })

  const brain = data?.brain ?? null
  const mc = brain?.manualContext ?? {}

  const openManual = () => {
    setManual({
      targetCustomerProfile: mc.targetCustomerProfile ?? '',
      competitors: mc.competitors ?? '',
      priceRange: mc.priceRange ?? '',
      forbiddenTopics: mc.forbiddenTopics ?? '',
      escalationContacts: mc.escalationContacts ?? '',
      uniqueSellingPoints: mc.uniqueSellingPoints ?? '',
    })
    setShowManual(true)
  }

  return (
    <div className="space-y-5">
      {showGuide && <CRMSetupGuideModal provider={showGuide} onClose={() => setShowGuide(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold">Business Intelligence Brain</h2>
            <p className="text-xs text-muted-foreground">AI agents use this in every conversation</p>
          </div>
        </div>
        <button
          onClick={() => setShowReanalyze(!showReanalyze)}
          className="flex items-center gap-1.5 text-sm border border-border px-3 py-1.5 rounded-md hover:bg-accent transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {brain ? 'Re-analyze' : 'Analyze website'}
        </button>
      </div>

      {/* Re-analyze */}
      {showReanalyze && (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium mb-3">Enter your website URL</p>
          <WebsiteAnalyzer compact onAnalyzed={() => { refetch(); setShowReanalyze(false) }} />
        </div>
      )}

      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !brain && !showReanalyze && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-3">
          <Globe className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="font-medium">Brain not enriched yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Enter your website URL and AI will automatically extract your company profile, services, target customers, USPs, contact info, and more.
          </p>
          <button
            onClick={() => setShowReanalyze(true)}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
          >
            Analyze my website
          </button>
        </div>
      )}

      {/* Brain data */}
      {!isLoading && brain && (
        <div className="space-y-4">

          {/* Auto-detected header */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-green-500/5">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium">Auto-detected from website</span>
                {brain.pagesScraped?.length > 0 && (
                  <span className="text-xs text-muted-foreground">({brain.pagesScraped.length} pages scraped)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {brain.scrapedAt && (
                  <span className="text-xs text-muted-foreground">Last: {timeAgo(brain.scrapedAt)}</span>
                )}
                {brain.confidence && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    brain.confidence >= 80 ? 'bg-green-500/10 text-green-600'
                    : brain.confidence >= 60 ? 'bg-yellow-500/10 text-yellow-600'
                    : 'bg-red-500/10 text-red-600'
                  }`}>
                    {brain.confidence}% confident
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 space-y-5">
              {/* Summary */}
              {brain.summary && (
                <p className="text-sm text-muted-foreground italic border-l-2 border-primary pl-3">
                  "{brain.summary}"
                </p>
              )}

              {/* Identity */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {brain.companyName && <InfoRow label="Company" value={brain.companyName} />}
                {brain.tagline && <InfoRow label="Tagline" value={`"${brain.tagline}"`} />}
                {brain.industry && <InfoRow label="Industry" value={INDUSTRY_LABELS[brain.industry] ?? brain.industry} />}
                {brain.teamSize && <InfoRow label="Team size" value={brain.teamSize} />}
                {brain.yearsInBusiness && <InfoRow label="Years in business" value={brain.yearsInBusiness} />}
                {brain.brandVoice && <InfoRow label="Brand voice" value={brain.brandVoice} />}
              </div>

              {/* Company description */}
              {brain.companyDescription && (
                <Section title="Company Description" icon={Brain}>
                  <p className="text-sm leading-relaxed">{brain.companyDescription}</p>
                </Section>
              )}

              {/* Services */}
              {brain.services?.length > 0 && (
                <Section title="Services Offered" icon={Star}>
                  <TagList items={brain.services} color="blue" />
                </Section>
              )}

              {/* Target customers */}
              {brain.targetCustomers && (
                <Section title="Target Customers" icon={Users}>
                  <p className="text-sm">{brain.targetCustomers}</p>
                </Section>
              )}

              {/* USPs */}
              {brain.uniqueSellingPoints?.length > 0 && (
                <Section title="Unique Selling Points" icon={Award}>
                  <ul className="space-y-1">
                    {brain.uniqueSellingPoints.map((usp: string) => (
                      <li key={usp} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                        {usp}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Service areas */}
              {brain.serviceAreas?.length > 0 && (
                <Section title="Service Areas" icon={MapPin}>
                  <TagList items={brain.serviceAreas} />
                </Section>
              )}

              {/* Certifications */}
              {brain.certifications?.length > 0 && (
                <Section title="Certifications & Licenses" icon={Award}>
                  <TagList items={brain.certifications} color="green" />
                </Section>
              )}

              {/* Pricing */}
              {brain.pricingSignals && (
                <Section title="Pricing Signals" icon={DollarSign}>
                  <p className="text-sm">{brain.pricingSignals}</p>
                </Section>
              )}

              {/* Business rules */}
              {brain.businessRules && (
                <Section title="Policies & Guarantees" icon={Award}>
                  <p className="text-sm">{brain.businessRules}</p>
                </Section>
              )}

              {/* Contact */}
              {(brain.phone || brain.email || brain.address) && (
                <Section title="Contact Information" icon={Phone}>
                  <div className="space-y-1">
                    {brain.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {brain.phone}
                      </div>
                    )}
                    {brain.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {brain.email}
                      </div>
                    )}
                    {brain.address && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {brain.address}
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* CRM suggestion */}
              {brain.crmHint && brain.crmHint !== 'NONE' && (
                <Section title="Suggested CRM" icon={Link2}>
                  <button
                    onClick={() => setShowGuide(brain.crmHint)}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {CRM_LABELS[brain.crmHint]} — View setup guide →
                  </button>
                </Section>
              )}

              {/* Scraped pages */}
              {brain.pagesScraped?.length > 0 && (
                <div className="pt-1 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    Pages analyzed: {brain.pagesScraped.join(' · ')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Manual overrides */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <button
              onClick={() => showManual ? setShowManual(false) : openManual()}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Manual context overrides</span>
                {Object.values(mc).some(Boolean) && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {Object.values(mc).filter(Boolean).length} fields set
                  </span>
                )}
              </div>
              {showManual ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showManual && (
              <div className="border-t border-border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Override or add context that wasn't on your website. Agents use this in every conversation.
                </p>
                {[
                  { key: 'uniqueSellingPoints', label: 'Unique selling points', placeholder: 'e.g. 20+ years experience, licensed & insured, same-day service, 5-star Google rating...' },
                  { key: 'targetCustomerProfile', label: 'Target customer profile', placeholder: 'e.g. Homeowners 35-65 in storm-prone areas, insurance-covered roofing jobs...' },
                  { key: 'priceRange', label: 'Price / service range', placeholder: 'e.g. Roofs from $8,000–$25,000 depending on size and materials...' },
                  { key: 'competitors', label: 'vs. competitors (what makes you better)', placeholder: 'e.g. Unlike XYZ Roofing, we offer lifetime warranties and same-day estimates...' },
                  { key: 'escalationContacts', label: 'Escalation contacts', placeholder: 'e.g. For complaints over $5k or unhappy customers, call John at 555-1234...' },
                  { key: 'forbiddenTopics', label: 'Never discuss / off-limits', placeholder: 'e.g. Never mention the 2022 contract dispute or promise delivery dates without manager approval...' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs font-medium">{label}</label>
                    <textarea
                      value={(manual as any)[key]}
                      onChange={(e) => setManual((m) => ({ ...m, [key]: e.target.value }))}
                      placeholder={placeholder}
                      rows={2}
                      className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground"
                    />
                  </div>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowManual(false)} className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-accent transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save context
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* How agents use it */}
          <div className="rounded-lg bg-muted/30 border border-border p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How agents use your brain</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Industry-aware replies', desc: 'Agents reference your exact services and industry' },
                { label: 'Personalized pitches', desc: 'Stan uses your USPs and price range in sales conversations' },
                { label: 'Location context', desc: 'Agents mention your service areas naturally in conversation' },
                { label: 'Guardrails enforced', desc: 'Forbidden topics and escalation rules are always respected' },
              ].map(({ label, desc }) => (
                <div key={label} className="bg-background rounded-md p-3 border border-border">
                  <p className="text-xs font-medium text-primary">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  )
}
