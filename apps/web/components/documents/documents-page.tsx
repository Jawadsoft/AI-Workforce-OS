'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { FileText, Download, Trash2, Plus, Loader2, Wand2, X, ChevronRight, LayoutTemplate } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

const TYPE_COLORS: Record<string, string> = {
  estimate: 'bg-blue-100 text-blue-700',
  inspection: 'bg-orange-100 text-orange-700',
  sow: 'bg-purple-100 text-purple-700',
  invoice: 'bg-green-100 text-green-700',
  supplement: 'bg-amber-100 text-amber-700',
  custom: 'bg-gray-100 text-gray-700',
}

export function DocumentsPage() {
  const qc = useQueryClient()
  const [showGenerate, setShowGenerate] = useState(false)
  const [mode, setMode] = useState<'template' | 'ai'>('template')
  const [form, setForm] = useState({ type: 'estimate', title: '', prompt: '', data: '' })
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api.get('/documents').then(r => r.data?.data ?? r.data ?? []),
  })

  const { data: templates = [] } = useQuery({
    queryKey: ['doc-templates'],
    queryFn: () => api.get('/documents/templates').then(r => r.data),
  })

  const generateMutation = useMutation({
    mutationFn: (payload: any) => api.post('/documents/generate', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] })
      setShowGenerate(false)
      setForm({ type: 'estimate', title: '', prompt: '', data: '' })
      toast.success('Document generated!')
    },
    onError: () => toast.error('Failed to generate document'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Deleted') },
  })

  const handleDownload = async (doc: any) => {
    setDownloading(doc.id)
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${API_BASE}/documents/download/${doc.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${doc.title}.${doc.format === 'PDF' ? 'pdf' : 'html'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Download failed') }
    finally { setDownloading(null) }
  }

  const handleGenerate = () => {
    if (!form.title) { toast.error('Please enter a document title'); return }
    const payload: any = { type: form.type, title: form.title }
    if (mode === 'ai') {
      payload.prompt = form.prompt
    } else if (form.data) {
      try { payload.data = JSON.parse(form.data) } catch { toast.error('Invalid JSON in data field'); return }
    }
    generateMutation.mutate(payload)
  }

  const selectedTemplate = templates.find((t: any) => t.id === form.type)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-muted-foreground mt-1">Generate professional PDFs — estimates, proposals, reports, invoices.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/documents/templates"
            className="flex items-center gap-2 border border-border px-4 py-2 rounded-md text-sm hover:bg-accent transition-colors">
            <LayoutTemplate className="w-4 h-4" /> Templates
          </Link>
          <button onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Generate Document
          </button>
        </div>
      </div>

      {/* Generate Modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-xl bg-card rounded-xl border border-border p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Generate Document</h2>
              <button onClick={() => setShowGenerate(false)} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => setMode('template')}
                className={cn('flex-1 py-2 text-sm font-medium transition-colors', mode === 'template' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                From Template
              </button>
              <button onClick={() => setMode('ai')}
                className={cn('flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5', mode === 'ai' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                <Wand2 className="w-3.5 h-3.5" /> AI Generate
              </button>
            </div>

            {/* Document type */}
            <div className="grid grid-cols-2 gap-2">
              {(templates as any[]).map((t: any) => (
                <button key={t.id} onClick={() => setForm(f => ({ ...f, type: t.id }))}
                  className={cn('p-3 rounded-lg border-2 text-left transition-colors', form.type === t.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground')}>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{t.description}</p>
                </button>
              ))}
            </div>

            {/* Title */}
            <div>
              <label className="text-sm font-medium">Document Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={`e.g. ${selectedTemplate?.label ?? 'Estimate'} for John Smith`}
                className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>

            {mode === 'ai' ? (
              <div>
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-purple-500" /> Describe what to include
                </label>
                <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                  rows={4} placeholder="e.g. Generate an estimate for John Smith at 123 Main St for a full roof replacement. Include: 40 squares of architectural shingles at $180 each, underlayment, labor..."
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium">Data (JSON) — optional</label>
                <p className="text-xs text-muted-foreground mb-1">
                  Fields: {selectedTemplate?.fields?.join(', ') ?? 'type-specific'}
                </p>
                <textarea value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                  rows={5} placeholder='{"customerName": "John Smith", "address": "123 Main St", "lineItems": [{"description": "Roofing", "qty": 1, "unitPrice": 8500}]}'
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowGenerate(false)} className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
              <button onClick={handleGenerate} disabled={generateMutation.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {generateMutation.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents list */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center space-y-3">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="font-medium text-muted-foreground">No documents yet</p>
          <p className="text-sm text-muted-foreground">Click "Generate Document" to create your first PDF.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {(docs as any[]).map((doc: any) => (
            <div key={doc.id} className="flex items-center gap-4 p-4 hover:bg-accent/20 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{doc.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={cn('text-xs', TYPE_COLORS[doc.type] ?? TYPE_COLORS.custom)}>{doc.type}</Badge>
                  <span className="text-xs text-muted-foreground">{doc.format}</span>
                  <span className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => handleDownload(doc)} disabled={downloading === doc.id}
                  className="flex items-center gap-1.5 text-xs border border-border px-2.5 py-1.5 rounded-md hover:bg-accent transition-colors">
                  {downloading === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Download
                </button>
                <button onClick={() => deleteMutation.mutate(doc.id)}
                  className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
