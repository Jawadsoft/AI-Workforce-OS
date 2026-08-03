'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ChevronLeft, Zap, Download, Loader2, CheckCircle2, Lock } from 'lucide-react'
import { resolveAvatarUrl } from '@/lib/utils'
import { useFeatures, FEATURES } from '@/hooks/use-features'

const INDUSTRY_LABELS: Record<string, string> = {
  ROOFING: 'Roofing',
  HVAC: 'HVAC',
  CLEANING: 'Cleaning',
  SECURITY: 'Security',
  REAL_ESTATE: 'Real Estate',
  INSURANCE: 'Insurance',
  HUMAN_RESOURCES: 'HR',
  LANDSCAPING: 'Landscaping',
  PEST_CONTROL: 'Pest Control',
  CONSTRUCTION: 'Construction',
  HEALTHCARE: 'Healthcare',
  PROPERTY_MANAGEMENT: 'Property Mgmt',
  CAR_DEALERSHIP: 'Car Dealership',
  OTHER: 'Other',
}

const ROLE_ICONS: Record<string, string> = {
  'Customer Intake Specialist': '📞',
  'Sales Assistant': '🎯',
  'Estimator': '📋',
  'Field Inspector': '🔍',
  'Insurance Specialist': '🛡️',
  'Executive Assistant': '💼',
  'Lead Qualification Specialist': '⚡',
  'Operations Coordinator': '📊',
  'HR Coordinator': '👥',
  'Property Care Specialist': '🏢',
  'Storm Analyst': '🌩️',
  'Marketing Assistant': '📣',
}

export function AgentMarketplace() {
  const qc = useQueryClient()
  const { isEnabled, isLoading: featuresLoading } = useFeatures()
  const marketplaceEnabled = isEnabled(FEATURES.MARKETPLACE)
  const [installing, setInstalling] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['agent-templates'],
    queryFn: () => api.get('/agents/templates').then((r) => r.data),
    enabled: marketplaceEnabled,
  })

  const { data: existingAgents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents').then((r) => r.data),
  })

  const installedTemplateIds = new Set(
    (existingAgents as any[]).map((a: any) => a.templateId).filter(Boolean)
  )

  const installMutation = useMutation({
    mutationFn: (templateId: string) => api.post(`/agents/install-template/${templateId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      setInstalling(null)
    },
    onError: () => setInstalling(null),
  })

  // Collect all unique industries from templates
  const allIndustries = [...new Set(templates.flatMap((t: any) => t.industries ?? []))] as string[]

  const filtered = templates.filter((t: any) => {
    const matchesSearch = !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.role.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase())
    const matchesIndustry = !industryFilter || (t.industries ?? []).includes(industryFilter)
    return matchesSearch && matchesIndustry
  })

  if (!featuresLoading && !marketplaceEnabled) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
        </div>
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Agent Marketplace</h2>
        <p className="text-muted-foreground">This feature is not enabled for your account. Contact your administrator.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/agents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Agent Marketplace</h1>
          <p className="text-sm text-muted-foreground">
            Install pre-built AI employees for your industry
            {templates.length > 0 && <span className="ml-1 text-primary font-medium">— {templates.length} available</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-56"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setIndustryFilter('')}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${!industryFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-foreground'}`}
          >
            All
          </button>
          {allIndustries.map(ind => (
            <button
              key={ind}
              onClick={() => setIndustryFilter(ind === industryFilter ? '' : ind)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${industryFilter === ind ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-foreground'}`}
            >
              {INDUSTRY_LABELS[ind] ?? ind}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 animate-pulse space-y-3">
              <div className="flex gap-3 items-center">
                <div className="w-10 h-10 bg-muted rounded-xl" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-28 bg-muted rounded" />
                  <div className="h-3 w-20 bg-muted rounded" />
                </div>
              </div>
              <div className="h-10 w-full bg-muted rounded" />
              <div className="h-8 w-full bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm font-medium">No agents match your filters</p>
          <button onClick={() => { setSearch(''); setIndustryFilter('') }} className="mt-2 text-xs text-primary hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tmpl: any) => {
            const isInstalling = installMutation.isPending && installing === tmpl.id
            const isInstalled = installedTemplateIds.has(tmpl.id)
            const icon = ROLE_ICONS[tmpl.role] ?? '🤖'

            return (
              <div key={tmpl.id} className="rounded-xl border border-border bg-card p-5 space-y-4 flex flex-col hover:shadow-md transition-shadow">
                {/* Agent header */}
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-xl flex-shrink-0">
                    {resolveAvatarUrl(tmpl.avatar)
                      ? <img src={resolveAvatarUrl(tmpl.avatar)!} alt="" className="w-11 h-11 rounded-xl object-cover" />
                      : icon}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-tight">{tmpl.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{tmpl.role}</p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground leading-relaxed flex-1 line-clamp-3">
                  {tmpl.description}
                </p>

                {/* Industry tags */}
                {tmpl.industries?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tmpl.industries.slice(0, 4).map((ind: string) => (
                      <span key={ind} className="text-xs bg-muted/60 px-2 py-0.5 rounded-full text-muted-foreground">
                        {INDUSTRY_LABELS[ind] ?? ind.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {tmpl.industries.length > 4 && (
                      <span className="text-xs text-muted-foreground">+{tmpl.industries.length - 4} more</span>
                    )}
                  </div>
                )}

                {/* Install button */}
                <button
                  onClick={() => {
                    if (isInstalled || isInstalling) return
                    setInstalling(tmpl.id)
                    installMutation.mutate(tmpl.id)
                  }}
                  disabled={isInstalling || isInstalled}
                  className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isInstalled
                      ? 'bg-green-50 text-green-700 border border-green-200 cursor-default'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                  }`}
                >
                  {isInstalling ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Installing...</>
                  ) : isInstalled ? (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> Installed</>
                  ) : (
                    <><Download className="w-3.5 h-3.5" /> Install Agent</>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
