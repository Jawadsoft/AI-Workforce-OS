'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ChevronDown, ChevronUp, ExternalLink, Copy, CheckCheck, BookOpen } from 'lucide-react'

interface CRMSetupGuideProps {
  provider: string
  inline?: boolean
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative mt-2 rounded-md bg-zinc-900 text-zinc-100 text-xs p-3 font-mono overflow-x-auto">
      <button onClick={copy} className="absolute top-2 right-2 p-1 hover:bg-zinc-700 rounded transition-colors">
        {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre>{code}</pre>
    </div>
  )
}

export function CRMSetupGuide({ provider, inline = false }: CRMSetupGuideProps) {
  const [openStep, setOpenStep] = useState<number | null>(0)

  const { data: guide, isLoading } = useQuery({
    queryKey: ['crm-guide', provider],
    queryFn: () => api.get(`/brain/crm-guides/${provider}`).then((r) => r.data),
    enabled: !!provider && provider !== 'NONE',
  })

  if (!provider || provider === 'NONE') return null
  if (isLoading) return <div className="h-12 animate-pulse bg-muted rounded-lg" />
  if (!guide) return null

  const content = (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: guide.logoColor }}
          />
          <p className="font-medium text-sm">{guide.name} Setup Guide</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">~{guide.estimatedSetupMinutes} min</span>
          {guide.apiDocsUrl && (
            <a
              href={guide.apiDocsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Docs <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{guide.description}</p>

      {/* Steps */}
      <div className="space-y-2">
        {guide.steps.map((step: any, i: number) => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenStep(openStep === i ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm font-medium">{step.title}</span>
              </div>
              {openStep === i
                ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
            {openStep === i && (
              <div className="px-4 pb-4 space-y-2 border-t border-border bg-muted/30">
                <p className="text-sm text-muted-foreground pt-3">{step.instructions}</p>
                {step.url && (
                  <a
                    href={step.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open {guide.name} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {step.code && <CodeBlock code={step.code} />}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Required Scopes */}
      {guide.requiredScopes?.length > 0 && (
        <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">Required permissions/scopes</p>
          <div className="flex flex-wrap gap-1.5">
            {guide.requiredScopes.map((scope: string) => (
              <span key={scope} className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-mono">
                {scope}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Webhook endpoints */}
      {guide.webhookEndpoints?.length > 0 && (
        <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3">
          <p className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-2">Webhook endpoints to register</p>
          <div className="space-y-1">
            {guide.webhookEndpoints.map((wh: any) => (
              <div key={wh.event} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-purple-700 dark:text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">{wh.event}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground">{wh.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  if (inline) return content

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {content}
    </div>
  )
}

export function CRMSetupGuideModal({ provider, onClose }: { provider: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-xl bg-card rounded-xl border border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="font-semibold">CRM Integration Guide</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <CRMSetupGuide provider={provider} inline />
        </div>
      </div>
    </div>
  )
}
