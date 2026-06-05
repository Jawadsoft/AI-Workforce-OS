'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { Globe, Loader2, Sparkles, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { CRMSetupGuide } from './crm-setup-guide'

interface AnalysisResult {
  companyName: string
  industry: string
  services: string[]
  locations: string[]
  brandVoice: string
  crmHint: string
  companySize: string
  confidence: number
  summary: string
  crmSetupGuide?: any
}

interface WebsiteAnalyzerProps {
  onAnalyzed?: (result: AnalysisResult) => void
  compact?: boolean
}

const INDUSTRY_LABELS: Record<string, string> = {
  ROOFING: 'Roofing',
  CAR_DEALERSHIP: 'Car Dealership',
  CLEANING: 'Cleaning',
  SECURITY: 'Security',
  PROPERTY_MANAGEMENT: 'Property Management',
  HEALTHCARE: 'Healthcare',
  CONSTRUCTION: 'Construction',
  REAL_ESTATE: 'Real Estate',
  OTHER: 'Other',
}

const CRM_LABELS: Record<string, string> = {
  HUBSPOT: 'HubSpot',
  SALESFORCE: 'Salesforce',
  JOBNIMBUS: 'JobNimbus',
  LARAVEL: 'Laravel CRM',
  ZOHO: 'Zoho CRM',
  CUSTOM: 'Custom API',
  NONE: 'Not detected',
}

export function WebsiteAnalyzer({ onAnalyzed, compact = false }: WebsiteAnalyzerProps) {
  const [url, setUrl] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  const analyze = async () => {
    if (!url.trim()) return
    setIsAnalyzing(true)
    setError('')
    setResult(null)
    try {
      const { data } = await api.post('/brain/enrich', { websiteUrl: url.trim() })
      setResult(data)
      onAnalyzed?.(data)
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Could not analyze website. Please check the URL and try again.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const confidenceColor =
    !result ? '' :
    result.confidence >= 80 ? 'text-green-500' :
    result.confidence >= 60 ? 'text-yellow-500' :
    'text-red-500'

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* URL Input */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
            placeholder="https://yourcompany.com"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          onClick={analyze}
          disabled={!url.trim() || isAnalyzing}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {isAnalyzing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Auto-fill from website</>
          )}
        </button>
      </div>

      {/* Loading state */}
      {isAnalyzing && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Scraping website content...</span>
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-3 rounded bg-muted animate-pulse" style={{ width: `${70 + i * 10}%` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && !isAnalyzing && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-green-500/5 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                Analysis complete
                {(result as any).pagesScraped?.length > 1 && (
                  <span className="ml-1 text-muted-foreground font-normal">
                    ({(result as any).pagesScraped.length} pages scraped)
                  </span>
                )}
              </span>
            </div>
            <span className={`text-xs font-medium ${confidenceColor}`}>
              {result.confidence}% confidence
            </span>
          </div>

          {/* Extracted data */}
          <div className="p-4 space-y-3">
            {result.summary && (
              <p className="text-sm text-muted-foreground italic border-l-2 border-primary pl-3">"{result.summary}"</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Company</p>
                <p className="text-sm font-medium">{result.companyName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Industry detected</p>
                <p className="text-sm font-medium">{INDUSTRY_LABELS[result.industry] ?? result.industry}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Company size</p>
                <p className="text-sm font-medium capitalize">{(result as any).teamSize ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Suggested CRM</p>
                <p className="text-sm font-medium">{CRM_LABELS[result.crmHint] ?? result.crmHint}</p>
              </div>
              {(result as any).yearsInBusiness && (
                <div>
                  <p className="text-xs text-muted-foreground">Years in business</p>
                  <p className="text-sm font-medium">{(result as any).yearsInBusiness}</p>
                </div>
              )}
              {(result as any).pricingSignals && (
                <div>
                  <p className="text-xs text-muted-foreground">Pricing</p>
                  <p className="text-sm font-medium">{(result as any).pricingSignals}</p>
                </div>
              )}
            </div>

            {(result as any).companyDescription && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Company description</p>
                <p className="text-sm leading-relaxed">{(result as any).companyDescription}</p>
              </div>
            )}

            {result.services.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Services found ({result.services.length})</p>
                <div className="flex flex-wrap gap-1">
                  {result.services.map((s: string) => (
                    <span key={s} className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {(result as any).targetCustomers && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Target customers</p>
                <p className="text-sm">{(result as any).targetCustomers}</p>
              </div>
            )}

            {(result as any).uniqueSellingPoints?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Unique selling points</p>
                <ul className="space-y-0.5">
                  {(result as any).uniqueSellingPoints.map((u: string) => (
                    <li key={u} className="flex items-start gap-1.5 text-sm">
                      <CheckCircle className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(result as any).serviceAreas?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Service areas</p>
                <div className="flex flex-wrap gap-1">
                  {(result as any).serviceAreas.map((l: string) => (
                    <span key={l} className="text-xs bg-muted px-2 py-0.5 rounded-full">{l}</span>
                  ))}
                </div>
              </div>
            )}

            {(result as any).certifications?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Certifications</p>
                <div className="flex flex-wrap gap-1">
                  {(result as any).certifications.map((c: string) => (
                    <span key={c} className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Contact info */}
            {((result as any).phone || (result as any).email) && (
              <div className="flex gap-4 text-sm">
                {(result as any).phone && <span>📞 {(result as any).phone}</span>}
                {(result as any).email && <span>✉️ {(result as any).email}</span>}
              </div>
            )}

            {result.brandVoice && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Brand voice</p>
                <p className="text-sm">{result.brandVoice}</p>
              </div>
            )}

            {/* CRM Setup Guide toggle */}
            {result.crmHint && result.crmHint !== 'NONE' && (
              <div className="pt-1 border-t border-border">
                <button
                  onClick={() => setShowGuide(!showGuide)}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  {showGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showGuide ? 'Hide' : 'Show'} {CRM_LABELS[result.crmHint]} setup guide
                </button>
                {showGuide && (
                  <div className="mt-3">
                    <CRMSetupGuide provider={result.crmHint} inline />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
