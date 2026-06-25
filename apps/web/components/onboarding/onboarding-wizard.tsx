'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Zap, CheckCircle, Loader2, ChevronRight, ChevronLeft, Globe, Sparkles, AlertCircle } from 'lucide-react'
import { resolveAvatarUrl } from '@/lib/utils'

const INDUSTRIES = [
  { id: 'ROOFING', label: 'Roofing', emoji: '🏠', agents: 8 },
  { id: 'CAR_DEALERSHIP', label: 'Car Dealership', emoji: '🚗', agents: 8 },
  { id: 'CLEANING', label: 'Cleaning Company', emoji: '🧹', agents: 7 },
  { id: 'SECURITY', label: 'Security Company', emoji: '🛡️', agents: 6 },
  { id: 'PROPERTY_MANAGEMENT', label: 'Property Management', emoji: '🏢', agents: 8 },
  { id: 'HEALTHCARE', label: 'Healthcare', emoji: '🏥', agents: 6 },
  { id: 'CONSTRUCTION', label: 'Construction', emoji: '🏗️', agents: 8 },
  { id: 'REAL_ESTATE', label: 'Real Estate', emoji: '🏡', agents: 8 },
  { id: 'OTHER', label: 'Other', emoji: '💼', agents: 4 },
]

const CRMS = [
  { id: 'LARAVEL', label: 'Laravel CRM', badge: 'Native' },
  { id: 'HUBSPOT', label: 'HubSpot', badge: 'Popular' },
  { id: 'SALESFORCE', label: 'Salesforce', badge: '' },
  { id: 'ZOHO', label: 'Zoho CRM', badge: '' },
  { id: 'JOBNIMBUS', label: 'JobNimbus', badge: 'Field Service' },
  { id: 'CUSTOM', label: 'Custom CRM / API', badge: '' },
  { id: 'NONE', label: 'No CRM yet', badge: '' },
]

// Which CRMs show a setup guide link
const GUIDE_CRMS = ['HUBSPOT', 'SALESFORCE', 'JOBNIMBUS', 'LARAVEL', 'ZOHO', 'CUSTOM']

const STEPS = ['Website', 'Industry', 'CRM', 'Business Profile', 'Generate']

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [generatedAgents, setGeneratedAgents] = useState<any[]>([])
  const [brainResult, setBrainResult] = useState<any>(null)
  const [analyzeError, setAnalyzeError] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  const [form, setForm] = useState({
    websiteUrl: '',
    industry: '',
    crm: '',
    services: '',
    locations: '',
    businessRules: '',
    brandVoice: 'Professional and helpful',
  })

  const canNext = () => {
    if (step === 0) return true // website step is optional
    if (step === 1) return !!form.industry
    if (step === 2) return !!form.crm
    if (step === 3) return !!form.services
    return true
  }

  const analyzeWebsite = async () => {
    if (!form.websiteUrl.trim()) return
    setIsAnalyzing(true)
    setAnalyzeError('')
    try {
      const { data } = await api.post('/brain/enrich', { websiteUrl: form.websiteUrl.trim() })
      setBrainResult(data)
      // Auto-fill form from brain
      setForm((f) => ({
        ...f,
        industry: data.industry && data.industry !== 'OTHER' ? data.industry : f.industry,
        crm: data.crmHint && data.crmHint !== 'NONE' ? data.crmHint : f.crm,
        services: data.services?.join(', ') || f.services,
        locations: data.locations?.join(', ') || f.locations,
        brandVoice: data.brandVoice || f.brandVoice,
      }))
    } catch (err: any) {
      setAnalyzeError(err.response?.data?.message ?? 'Could not reach website. You can still fill in details manually.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    setIsLoading(true)
    try {
      await api.patch('/tenants/onboard', {
        industry: form.industry,
        crm: form.crm,
        services: form.services,
        locations: form.locations,
        businessRules: form.businessRules,
        brandVoice: form.brandVoice,
      })
      const { data } = await api.post('/tenants/generate-workforce', { industry: form.industry })
      setGeneratedAgents(data)
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleNext = async () => {
    if (step === 3) {
      setStep(4)
      await handleGenerate()
    } else {
      setStep((s) => s + 1)
    }
  }

  const selectedCRM = CRMS.find((c) => c.id === form.crm)

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold">Set up your AI Workforce</h1>
          <p className="text-muted-foreground text-sm mt-1">Takes less than 2 minutes</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                  i < step ? 'bg-primary border-primary text-primary-foreground' :
                  i === step ? 'border-primary text-primary' :
                  'border-border text-muted-foreground'
                }`}>
                  {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-xs mt-1 ${i === step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-4 ${i < step ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="rounded-xl border border-border bg-card p-6 min-h-64">

          {/* Step 0: Website */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Let's learn about your business</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your website URL and our AI will auto-fill your industry, services, locations, and suggest the best CRM.
                </p>
              </div>

              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="url"
                    value={form.websiteUrl}
                    onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && analyzeWebsite()}
                    placeholder="https://yourcompany.com"
                    className="w-full pl-9 pr-3 py-2.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <button
                  onClick={analyzeWebsite}
                  disabled={!form.websiteUrl.trim() || isAnalyzing}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {isAnalyzing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                    : <><Sparkles className="w-4 h-4" /> Analyze</>}
                </button>
              </div>

              {analyzeError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {analyzeError}
                </div>
              )}

              {isAnalyzing && (
                <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Scraping and analyzing your website with AI...</span>
                  </div>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-3 rounded bg-muted animate-pulse" style={{ width: `${60 + i * 15}%` }} />
                  ))}
                </div>
              )}

              {brainResult && !isAnalyzing && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      Website analyzed — fields auto-filled! ({brainResult.confidence}% confidence)
                    </p>
                  </div>
                  {brainResult.summary && (
                    <p className="text-sm text-muted-foreground italic">"{brainResult.summary}"</p>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div><span className="text-muted-foreground">Industry: </span><strong>{brainResult.industry}</strong></div>
                    <div><span className="text-muted-foreground">Size: </span><strong>{brainResult.companySize}</strong></div>
                    <div><span className="text-muted-foreground">Suggested CRM: </span><strong>{brainResult.crmHint}</strong></div>
                    <div><span className="text-muted-foreground">Locations: </span><strong>{brainResult.locations?.slice(0,2).join(', ')}</strong></div>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                Don't have a website yet? <button onClick={handleNext} className="text-primary hover:underline">Skip and fill in manually →</button>
              </p>
            </div>
          )}

          {/* Step 1: Industry */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">What industry are you in?</h2>
                {brainResult && (
                  <p className="text-sm text-muted-foreground mt-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 inline mr-1" />
                    Auto-detected: <strong>{brainResult.industry}</strong> — you can change this
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind.id}
                    onClick={() => setForm((f) => ({ ...f, industry: ind.id }))}
                    className={`rounded-lg border-2 p-3 text-left transition-colors ${
                      form.industry === ind.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <p className="text-base mb-0.5">{ind.emoji}</p>
                    <p className="font-medium text-sm">{ind.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ind.agents} AI agents</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: CRM */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Which CRM do you use?</h2>
                {brainResult?.crmHint && brainResult.crmHint !== 'NONE' && (
                  <p className="text-sm text-muted-foreground mt-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 inline mr-1" />
                    Detected from your website: <strong>{brainResult.crmHint}</strong>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CRMS.map((crm) => (
                  <button
                    key={crm.id}
                    onClick={() => setForm((f) => ({ ...f, crm: crm.id }))}
                    className={`rounded-lg border-2 p-3 text-left transition-colors flex items-center justify-between ${
                      form.crm === crm.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <span className="font-medium text-sm">{crm.label}</span>
                    {crm.badge && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{crm.badge}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* CRM Setup Guide inline teaser */}
              {form.crm && GUIDE_CRMS.includes(form.crm) && (
                <div className="rounded-lg bg-muted/30 border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Need help connecting <strong>{selectedCRM?.label}</strong>?
                    </p>
                    <button
                      onClick={() => setShowGuide(!showGuide)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showGuide ? 'Hide' : 'View'} setup guide
                    </button>
                  </div>
                  {showGuide && (
                    <div className="mt-3 border-t border-border pt-3">
                      <CRMStepGuideInline provider={form.crm} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Business Profile */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Tell us about your business</h2>
                {brainResult && (
                  <p className="text-sm text-muted-foreground mt-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 inline mr-1" />
                    Fields pre-filled from your website — review and adjust
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Services you offer <span className="text-destructive">*</span></label>
                  <textarea
                    value={form.services}
                    onChange={(e) => setForm((f) => ({ ...f, services: e.target.value }))}
                    placeholder="e.g. Roof replacement, storm damage repair, gutters, inspections..."
                    rows={2}
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Service locations</label>
                  <input
                    type="text"
                    value={form.locations}
                    onChange={(e) => setForm((f) => ({ ...f, locations: e.target.value }))}
                    placeholder="e.g. Dallas, TX and surrounding areas"
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Business rules or policies</label>
                  <textarea
                    value={form.businessRules}
                    onChange={(e) => setForm((f) => ({ ...f, businessRules: e.target.value }))}
                    placeholder="e.g. Always get approval before sending estimates over $10,000..."
                    rows={2}
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Brand voice</label>
                  <input
                    type="text"
                    value={form.brandVoice}
                    onChange={(e) => setForm((f) => ({ ...f, brandVoice: e.target.value }))}
                    placeholder="e.g. Professional, friendly, and concise"
                    className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Generate */}
          {step === 4 && (
            <div className="space-y-4 text-center">
              {isLoading ? (
                <div className="py-8 space-y-4">
                  <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                  <h2 className="text-lg font-semibold">Building your AI workforce...</h2>
                  <p className="text-muted-foreground text-sm">Creating role-specific agents for your business</p>
                </div>
              ) : generatedAgents.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    <h2 className="text-lg font-semibold">Your AI team is ready!</h2>
                  </div>
                  <p className="text-muted-foreground text-sm">{generatedAgents.length} AI employees created and ready to work</p>
                  <div className="grid grid-cols-2 gap-2 text-left">
                    {generatedAgents.map((agent: any) => (
                      <div key={agent.id} className="rounded-lg border border-border p-3 flex items-center gap-2">
                        {resolveAvatarUrl(agent.avatar) ? (
                          <img src={resolveAvatarUrl(agent.avatar)!} alt={agent.name} className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {agent.name[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">{agent.name}</p>
                          <p className="text-xs text-muted-foreground">{agent.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Go to Dashboard →
                  </button>
                </div>
              ) : (
                <div className="py-8 space-y-4">
                  <p className="text-muted-foreground text-sm">Setting up your workforce...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        {step < 4 && (
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={handleNext}
              disabled={!canNext()}
              className="flex items-center gap-1 bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {step === 3 ? 'Generate Workforce' : 'Next'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Inline CRM step guide (lightweight, just first 2 steps)
function CRMStepGuideInline({ provider }: { provider: string }) {
  const [data, setData] = useState<any>(null)

  if (!data) {
    api.get(`/brain/crm-guides/${provider}`).then((r) => setData(r.data)).catch(() => {})
  }
  if (!data) return <div className="h-12 animate-pulse bg-muted rounded" />

  return (
    <div className="space-y-2">
      {data.steps.slice(0, 3).map((step: any, i: number) => (
        <div key={i} className="flex gap-3 text-sm">
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
          <div>
            <p className="font-medium">{step.title}</p>
            <p className="text-muted-foreground text-xs mt-0.5">{step.instructions}</p>
            {step.url && (
              <a href={step.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                Open {data.name} →
              </a>
            )}
          </div>
        </div>
      ))}
      {data.steps.length > 3 && (
        <p className="text-xs text-muted-foreground pl-8">+{data.steps.length - 3} more steps — view full guide in CRM Settings after onboarding</p>
      )}
    </div>
  )
}
