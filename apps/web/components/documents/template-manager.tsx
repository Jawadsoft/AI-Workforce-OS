'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  ChevronLeft, Plus, Upload, FileText, Star, StarOff,
  Trash2, Edit2, Eye, EyeOff, Loader2, CloudUpload, X, CheckCircle2,
  Wand2, Sparkles, Globe,
} from 'lucide-react'
import Link from 'next/link'

const TYPE_LABELS: Record<string, string> = {
  estimate: 'Estimate / Proposal',
  inspection: 'Inspection Report',
  sow: 'Statement of Work',
  invoice: 'Invoice',
  custom: 'Custom',
}

const TYPE_COLORS: Record<string, string> = {
  estimate: 'bg-blue-100 text-blue-700',
  inspection: 'bg-purple-100 text-purple-700',
  sow: 'bg-orange-100 text-orange-700',
  invoice: 'bg-green-100 text-green-700',
  custom: 'bg-gray-100 text-gray-700',
}

const INDUSTRIES = [
  { value: 'ROOFING', label: 'Roofing' },
  { value: 'HVAC', label: 'HVAC' },
  { value: 'CONSTRUCTION', label: 'Construction' },
  { value: 'LANDSCAPING', label: 'Landscaping' },
  { value: 'CLEANING', label: 'Cleaning Services' },
  { value: 'PEST_CONTROL', label: 'Pest Control' },
  { value: 'PROPERTY_MANAGEMENT', label: 'Property Management' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'HEALTHCARE', label: 'Healthcare' },
  { value: 'CAR_DEALERSHIP', label: 'Car Dealership' },
  { value: 'HUMAN_RESOURCES', label: 'Human Resources' },
  { value: 'OTHER', label: 'Other' },
]

const STYLES = [
  { value: 'modern', label: 'Modern', desc: 'Clean, bold accents, contemporary layout' },
  { value: 'classic', label: 'Classic', desc: 'Traditional, formal, corporate serif' },
  { value: 'minimal', label: 'Minimal', desc: 'Whitespace-driven, typography-focused' },
]

type Tab = 'list' | 'upload' | 'paste' | 'ai'

export function TemplateManager() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  // Upload state
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [converting, setConverting] = useState(false)
  const [converted, setConverted] = useState<{ htmlBody: string; suggestedName: string; suggestedType: string } | null>(null)

  // AI generate state
  const [aiConfig, setAiConfig] = useState({ type: 'estimate', industry: 'ROOFING', style: 'modern' as 'modern' | 'classic' | 'minimal' })
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiGenerated, setAiGenerated] = useState<{ htmlBody: string; suggestedName: string } | null>(null)
  const [aiPreview, setAiPreview] = useState(false)

  // Paste / Edit form state
  const [form, setForm] = useState({ name: '', type: 'estimate', description: '', htmlBody: '', isDefault: false })

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['document-templates'],
    queryFn: () => api.get('/document-templates').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/document-templates', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('Template saved')
      setTab('list')
      setForm({ name: '', type: 'estimate', description: '', htmlBody: '', isDefault: false })
      setConverted(null)
    },
    onError: () => toast.error('Failed to save template'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/document-templates/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('Template updated')
      setEditingId(null)
      setTab('list')
      setForm({ name: '', type: 'estimate', description: '', htmlBody: '', isDefault: false })
    },
    onError: () => toast.error('Failed to update template'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/document-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('Template deleted')
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api.post(`/document-templates/${id}/set-default`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] })
      toast.success('Set as default template')
    },
  })

  const handleAiGenerate = async () => {
    setAiGenerating(true)
    setAiGenerated(null)
    setAiPreview(false)
    try {
      const res = await api.post('/document-templates/generate-ai', aiConfig)
      setAiGenerated(res.data)
      setForm(f => ({ ...f, name: res.data.suggestedName, type: aiConfig.type, htmlBody: res.data.htmlBody }))
      toast.success('Template generated — review and save')
    } catch {
      toast.error('AI generation failed. Try again.')
    } finally {
      setAiGenerating(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setUploadFile(file)
  }

  const handleConvert = async () => {
    if (!uploadFile) return
    setConverting(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      const res = await api.post('/document-templates/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setConverted(res.data)
      setForm(f => ({
        ...f,
        name: res.data.suggestedName,
        type: res.data.suggestedType,
        htmlBody: res.data.htmlBody,
      }))
      toast.success('File converted successfully — review and save')
    } catch {
      toast.error('Conversion failed. Try a different file.')
    } finally {
      setConverting(false)
    }
  }

  const handleSave = () => {
    if (!form.name.trim()) return toast.error('Template name is required')
    if (!form.htmlBody.trim()) return toast.error('Template HTML is required')
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const handleEdit = (tmpl: any) => {
    setEditingId(tmpl.id)
    setForm({ name: tmpl.name, type: tmpl.type, description: tmpl.description ?? '', htmlBody: tmpl.htmlBody, isDefault: tmpl.isDefault })
    setTab('paste')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/documents" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Document Templates</h1>
            <p className="text-sm text-muted-foreground">Upload or create templates that agents use when generating documents</p>
          </div>
        </div>
        {tab === 'list' && (
          <div className="flex gap-2">
            <button onClick={() => { setTab('ai'); setEditingId(null); setAiGenerated(null); setAiPreview(false) }}
              className="flex items-center gap-1.5 text-sm border border-primary/40 text-primary bg-primary/5 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
              <Sparkles className="w-4 h-4" /> AI Generate
            </button>
            <button onClick={() => { setTab('upload'); setEditingId(null); setConverted(null) }}
              className="flex items-center gap-1.5 text-sm border border-border px-3 py-1.5 rounded-lg hover:bg-accent transition-colors">
              <Upload className="w-4 h-4" /> Upload File
            </button>
            <button onClick={() => { setTab('paste'); setEditingId(null); setForm({ name: '', type: 'estimate', description: '', htmlBody: '', isDefault: false }) }}
              className="flex items-center gap-1.5 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> Paste HTML
            </button>
          </div>
        )}
      </div>

      {/* ── LIST TAB ─────────────────────────────────────────────── */}
      {tab === 'list' && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-16 text-center">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-sm">No templates yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Upload your company documents (.docx, .pdf) and AI will convert them into reusable templates</p>
              <button onClick={() => setTab('upload')} className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
                Upload Your First Template
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Group by type */}
              {Object.entries(TYPE_LABELS).map(([type, label]) => {
                const group = templates.filter((t: any) => t.type === type)
                if (!group.length) return null
                return (
                  <div key={type}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
                    <div className="space-y-2">
                      {group.map((tmpl: any) => (
                        <div key={tmpl.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium truncate">{tmpl.name}</p>
                              {tmpl.isDefault && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">DEFAULT</span>
                              )}
                            </div>
                            {tmpl.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{tmpl.description}</p>}
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(tmpl.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setPreviewHtml(previewHtml === tmpl.id ? null : tmpl.id)}
                              title="Preview" className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                              {previewHtml === tmpl.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setDefaultMutation.mutate(tmpl.id)}
                              title={tmpl.isDefault ? 'Default' : 'Set as default'}
                              className={`p-1.5 rounded-md hover:bg-accent transition-colors ${tmpl.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                              {tmpl.isDefault ? <Star className="w-3.5 h-3.5 fill-current" /> : <StarOff className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => handleEdit(tmpl)}
                              className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(tmpl.id) }}
                              className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Inline preview */}
                    {templates.filter((t: any) => t.type === type && t.id === previewHtml).map((tmpl: any) => (
                      <div key={`preview-${tmpl.id}`} className="mt-2 rounded-xl border border-border bg-white overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
                          <p className="text-xs font-medium">Preview: {tmpl.name}</p>
                          <button onClick={() => setPreviewHtml(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <iframe
                          srcDoc={tmpl.htmlBody}
                          className="w-full h-96 border-0"
                          sandbox="allow-same-origin"
                          title="Template preview"
                        />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── UPLOAD TAB ───────────────────────────────────────────── */}
      {tab === 'upload' && (
        <div className="max-w-2xl space-y-6">
          <div
            onClick={() => fileRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors
              ${uploadFile ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/50'}`}
          >
            <input ref={fileRef} type="file" accept=".docx,.pdf,.html,.txt" onChange={handleFileChange} className="hidden" />
            {uploadFile ? (
              <>
                <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="font-medium text-sm">{uploadFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{(uploadFile.size / 1024).toFixed(0)} KB · Click to change</p>
              </>
            ) : (
              <>
                <CloudUpload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="font-medium text-sm">Drop your template here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .docx, .pdf, .html, .txt — max 10MB</p>
              </>
            )}
          </div>

          {uploadFile && !converted && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">What happens next:</p>
              <ol className="space-y-1 list-decimal list-inside text-xs">
                <li>Your file is extracted to text/HTML</li>
                <li>AI identifies all variable fields (names, amounts, dates)</li>
                <li>Replaces them with <code className="bg-muted px-1 rounded">{'{{placeholder}}'}</code> variables</li>
                <li>You review and save the converted template</li>
              </ol>
            </div>
          )}

          {converted && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Converted successfully! Review the template below, then adjust and save.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Template Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Document Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">HTML Template (edit if needed)</label>
                <textarea
                  value={form.htmlBody}
                  onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))}
                  rows={12}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                Set as default template for {TYPE_LABELS[form.type]}
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setTab('list'); setUploadFile(null); setConverted(null) }}
              className="flex-1 border border-border px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors">
              Cancel
            </button>
            {!converted ? (
              <button onClick={handleConvert} disabled={!uploadFile || converting}
                className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {converting ? <><Loader2 className="w-4 h-4 animate-spin" /> Converting...</> : 'Convert with AI'}
              </button>
            ) : (
              <button onClick={handleSave} disabled={createMutation.isPending}
                className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Template'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── PASTE HTML TAB ───────────────────────────────────────── */}
      {tab === 'paste' && (
        <div className="max-w-2xl space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Template Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Standard Roof Estimate"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Document Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of this template"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-muted-foreground">HTML Template *</label>
              <span className="text-[10px] text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{'{{customerName}}'}</code> <code className="bg-muted px-1 rounded">{'{{address}}'}</code> <code className="bg-muted px-1 rounded">{'{{total}}'}</code> etc.
              </span>
            </div>
            <textarea
              value={form.htmlBody}
              onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))}
              rows={16}
              placeholder={'<!DOCTYPE html>\n<html>\n<body>\n  <h1>Estimate for {{customerName}}</h1>\n  <p>Address: {{address}}</p>\n  ...\n</body>\n</html>'}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
            Set as default template for {TYPE_LABELS[form.type]}
          </label>

          <div className="flex gap-2">
            <button onClick={() => { setTab('list'); setEditingId(null) }}
              className="flex-1 border border-border px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}
              className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {(createMutation.isPending || updateMutation.isPending)
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : editingId ? 'Update Template' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      {/* ── AI GENERATE TAB ──────────────────────────────────────── */}
      {tab === 'ai' && (
        <div className="max-w-2xl space-y-6">
          {/* Intro banner */}
          <div className="rounded-xl bg-gradient-to-r from-primary/10 via-purple-500/10 to-pink-500/10 border border-primary/20 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">AI Professional Template Generator</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tell AI your industry and document type — it will generate a polished, industry-standard template
                with all the right sections, styling, and <code className="bg-muted px-1 rounded">{'{{placeholder}}'}</code> variables pre-inserted.
              </p>
            </div>
          </div>

          {!aiGenerated ? (
            <div className="space-y-5">
              {/* Document type */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document Type</label>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {Object.entries(TYPE_LABELS).filter(([v]) => v !== 'custom').map(([value, label]) => (
                    <button key={value} onClick={() => setAiConfig(c => ({ ...c, type: value }))}
                      className={`py-2 px-2 rounded-lg border text-xs font-medium transition-colors text-center
                        ${aiConfig.type === value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 hover:bg-accent'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Industry */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Industry</label>
                <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {INDUSTRIES.map(ind => (
                    <button key={ind.value} onClick={() => setAiConfig(c => ({ ...c, industry: ind.value }))}
                      className={`py-2 px-2 rounded-lg border text-xs font-medium transition-colors text-center
                        ${aiConfig.industry === ind.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40 hover:bg-accent'}`}>
                      {ind.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Visual Style</label>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  {STYLES.map(s => (
                    <button key={s.value} onClick={() => setAiConfig(c => ({ ...c, style: s.value as any }))}
                      className={`rounded-xl border p-3 text-left transition-colors
                        ${aiConfig.style === s.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-accent'}`}>
                      <p className={`text-sm font-semibold ${aiConfig.style === s.value ? 'text-primary' : ''}`}>{s.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Will generate: </span>
                A <span className="text-primary font-medium">{aiConfig.style}</span> {TYPE_LABELS[aiConfig.type]?.toLowerCase()} template
                tailored for the <span className="text-primary font-medium">
                  {INDUSTRIES.find(i => i.value === aiConfig.industry)?.label}
                </span> industry
              </div>

              <div className="flex gap-2">
                <button onClick={() => setTab('list')}
                  className="flex-1 border border-border px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors">
                  Cancel
                </button>
                <button onClick={handleAiGenerate} disabled={aiGenerating}
                  className="flex-1 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {aiGenerating
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                    : <><Wand2 className="w-4 h-4" /> Generate Template</>}
                </button>
              </div>
            </div>
          ) : (
            /* Review & Save */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Template generated! Review, edit if needed, then save.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Template Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Document Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              {/* Preview toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">HTML Template</label>
                <button onClick={() => setAiPreview(p => !p)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline">
                  {aiPreview ? <><EyeOff className="w-3 h-3" /> Hide preview</> : <><Eye className="w-3 h-3" /> Live preview</>}
                </button>
              </div>

              {aiPreview ? (
                <div className="rounded-xl border border-border bg-white overflow-hidden">
                  <iframe
                    srcDoc={form.htmlBody}
                    className="w-full h-[480px] border-0"
                    sandbox="allow-same-origin"
                    title="Generated template preview"
                  />
                </div>
              ) : (
                <textarea
                  value={form.htmlBody}
                  onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))}
                  rows={14}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                Set as default template for {TYPE_LABELS[form.type]}
              </label>

              <div className="flex gap-2">
                <button onClick={() => { setAiGenerated(null); setAiPreview(false) }}
                  className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors">
                  Regenerate
                </button>
                <button onClick={() => { setTab('list'); setAiGenerated(null) }}
                  className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-accent transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={createMutation.isPending}
                  className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
