'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpen, Search, ChevronRight, ExternalLink, Lightbulb, ListOrdered, HelpCircle,
  Volume2, Square, ImageIcon, PencilLine, X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  canSeeArticle,
  searchArticles,
  mergeHelpArticles,
  type HelpArticle,
  type HelpArticleOverrideData,
  type HelpArticleImage,
} from '@/lib/help-content'
import { ROLE_LABELS } from '@/lib/roles'
import { useArticleNarrator, type NarratorChunk } from '@/hooks/use-article-narrator'

function buildNarrationChunks(article: HelpArticle): NarratorChunk[] {
  const chunks: NarratorChunk[] = [
    { key: 'intro', text: `${article.title}. ${article.summary}` },
  ]
  article.steps?.forEach((step, i) => {
    chunks.push({ key: `step-${i}`, text: `Step ${i + 1}. ${step}` })
  })
  article.tips?.forEach((tip, i) => {
    chunks.push({ key: `tip-${i}`, text: `Tip. ${tip}` })
  })
  return chunks
}

interface EditForm {
  title: string
  category: string
  audience: 'all' | 'member' | 'manager' | 'admin'
  summary: string
  stepsText: string
  tipsText: string
}

const emptyEditForm: EditForm = {
  title: '', category: 'Getting Started', audience: 'all', summary: '', stepsText: '', tipsText: '',
}

export function HelpPage() {
  const { user, fetchMe, isAuthenticated } = useAuthStore()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string>('welcome')
  const [lightboxImage, setLightboxImage] = useState<HelpArticleImage | null>(null)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  // Super-admin editing state
  const [editing, setEditing] = useState(false)
  const [editingIsNew, setEditingIsNew] = useState(false)
  const [editArticleId, setEditArticleId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm)
  const [savingEdit, setSavingEdit] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [newImageCaption, setNewImageCaption] = useState('')

  useEffect(() => {
    if (!isAuthenticated) fetchMe()
  }, [isAuthenticated, fetchMe])

  const { data: helpContent } = useQuery({
    queryKey: ['help-content'],
    queryFn: async () => {
      const res = await api.get<{
        overrides: Record<string, HelpArticleOverrideData>
        images: Record<string, HelpArticleImage[]>
      }>('/help/content')
      return res.data
    },
    staleTime: 60_000,
  })

  const refreshHelpContent = () => queryClient.invalidateQueries({ queryKey: ['help-content'] })

  const allArticles = useMemo(
    () => mergeHelpArticles(helpContent?.overrides, helpContent?.images),
    [helpContent],
  )

  // Deep-link support from the header quick-search (?article=id or ?q=term)
  useEffect(() => {
    const articleId = searchParams.get('article')
    const q = searchParams.get('q')
    if (articleId) {
      setActiveId(articleId)
    } else if (q) {
      setQuery(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const visible = useMemo(() => {
    const forRole = allArticles.filter((a) => canSeeArticle(user?.role, a))
    return searchArticles(query, forRole)
  }, [allArticles, user?.role, query])

  const grouped = useMemo(() => {
    const map = new Map<string, HelpArticle[]>()
    for (const cat of HELP_CATEGORIES) map.set(cat, [])
    for (const a of visible) {
      const list = map.get(a.category) ?? []
      list.push(a)
      map.set(a.category, list)
    }
    return [...map.entries()].filter(([, items]) => items.length > 0)
  }, [visible])

  const active =
    visible.find((a) => a.id === activeId) ??
    visible[0] ??
    allArticles.find((a) => a.id === 'welcome') ??
    HELP_ARTICLES.find((a) => a.id === 'welcome')!

  useEffect(() => {
    if (visible.length && !visible.some((a) => a.id === activeId)) {
      setActiveId(visible[0].id)
    }
  }, [visible, activeId])

  const narrator = useArticleNarrator()

  // Stop narration whenever the visible article changes (switching topics, searching, etc.)
  useEffect(() => {
    narrator.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id])

  const handleToggleNarration = () => {
    if (narrator.isSpeaking) {
      narrator.stop()
      return
    }
    narrator.play(buildNarrationChunks(active)).catch(() => {
      toast.error('Voice narration is unavailable right now. Check ElevenLabs setup with an Admin.')
    })
  }

  const isStaticArticle = (id: string) => HELP_ARTICLES.some((a) => a.id === id)

  function openEditExisting() {
    setEditingIsNew(false)
    setEditArticleId(active.id)
    setEditForm({
      title: active.title,
      category: active.category,
      audience: active.audience,
      summary: active.summary,
      stepsText: (active.steps ?? []).join('\n'),
      tipsText: (active.tips ?? []).join('\n'),
    })
    setEditing(true)
  }

  function openNewTopic() {
    setEditingIsNew(true)
    setEditArticleId(`custom-${Date.now()}`)
    setEditForm({ ...emptyEditForm, category: active?.category ?? 'Getting Started' })
    setEditing(true)
  }

  async function saveEdit() {
    if (!editArticleId || !editForm.title.trim() || !editForm.summary.trim()) {
      toast.error('Title and summary are required.')
      return
    }
    setSavingEdit(true)
    try {
      await api.post(`/super-admin/help/articles/${editArticleId}`, {
        title: editForm.title.trim(),
        category: editForm.category.trim() || 'Getting Started',
        audience: editForm.audience,
        summary: editForm.summary.trim(),
        steps: editForm.stepsText.split('\n').map((s) => s.trim()).filter(Boolean),
        tips: editForm.tipsText.split('\n').map((s) => s.trim()).filter(Boolean),
        isCustom: editingIsNew || !isStaticArticle(editArticleId),
      })
      await refreshHelpContent()
      setActiveId(editArticleId)
      setEditing(false)
      toast.success(editingIsNew ? 'Topic created' : 'Topic updated')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save topic')
    } finally {
      setSavingEdit(false)
    }
  }

  async function revertOrDeleteArticle() {
    if (!editArticleId) return
    const isCustom = !isStaticArticle(editArticleId)
    if (!confirm(isCustom ? 'Delete this custom topic and its images?' : 'Revert this topic back to its default text? (Images are kept.)')) return
    try {
      await api.delete(`/super-admin/help/articles/${editArticleId}`)
      await refreshHelpContent()
      setEditing(false)
      if (isCustom) setActiveId('welcome')
      toast.success(isCustom ? 'Topic deleted' : 'Reverted to default')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update topic')
    }
  }

  async function handleImageUpload(file: File) {
    if (!editArticleId) return
    setUploadingImage(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (newImageCaption.trim()) fd.append('caption', newImageCaption.trim())
      await api.post(`/super-admin/help/articles/${editArticleId}/images`, fd)
      setNewImageCaption('')
      await refreshHelpContent()
      toast.success('Image added')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to upload image')
    } finally {
      setUploadingImage(false)
    }
  }

  async function handleImageDelete(imageId: string) {
    try {
      await api.delete(`/super-admin/help/images/${imageId}`)
      await refreshHelpContent()
    } catch {
      toast.error('Failed to remove image')
    }
  }

  const editingArticleImages = editArticleId ? (helpContent?.images?.[editArticleId] ?? []) : []
  const editingHasOverride = !!(editArticleId && helpContent?.overrides?.[editArticleId])
  const canRevertOrDelete = !editingIsNew && editArticleId
    ? (isStaticArticle(editArticleId) ? editingHasOverride : true)
    : false

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" />
            Help Guide
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step-by-step guides to use AI Workforce OS easily
            {user?.role ? (
              <>
                {' '}
                · showing tips for <span className="text-foreground font-medium">{ROLE_LABELS[user.role] ?? user.role}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help (quote, invite, CRM…)"
            className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr] min-h-[60vh]">
        {/* Topic list */}
        <aside className="rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[70vh]">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
            <BookOpen className="w-4 h-4" />
            Topics
            <span className="ml-auto text-xs text-muted-foreground">{visible.length}</span>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={openNewTopic}
                title="Add a new Help Guide topic"
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                +
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-3">
            {grouped.length === 0 && (
              <p className="text-sm text-muted-foreground p-3">No topics match your search.</p>
            )}
            {grouped.map(([category, items]) => (
              <div key={category}>
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                <div className="space-y-0.5">
                  {items.map((article) => (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => setActiveId(article.id)}
                      className={cn(
                        'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                        active.id === article.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent text-foreground',
                      )}
                    >
                      {article.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Article */}
        <article className="rounded-xl border border-border bg-card p-5 sm:p-7 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
                  {active.category}
                </p>
                {active.isEdited && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 mb-1">
                    Edited
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">{active.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{active.summary}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={openEditExisting}
                  title="Edit this topic (superadmin)"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <PencilLine className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleToggleNarration}
                title={narrator.isSpeaking ? 'Stop reading' : 'Listen to this article'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors border',
                  narrator.isSpeaking
                    ? 'border-primary/40 bg-primary/15 text-primary animate-pulse'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {narrator.isSpeaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{narrator.isSpeaking ? 'Stop' : 'Listen'}</span>
              </button>
            </div>
          </div>

          {active.steps && active.steps.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ListOrdered className="w-4 h-4" />
                Steps
              </h3>
              <ol className="space-y-2.5">
                {active.steps.map((step, i) => (
                  <li
                    key={i}
                    className={cn(
                      'flex gap-3 text-sm leading-relaxed rounded-lg -mx-2 px-2 py-1 transition-colors',
                      narrator.activeChunkKey === `step-${i}` && 'bg-primary/10',
                    )}
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {active.tips && active.tips.length > 0 && (
            <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                Tips
              </h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {active.tips.map((tip, i) => (
                  <li
                    key={i}
                    className={cn(
                      'flex gap-2 rounded-lg -mx-2 px-2 py-1 transition-colors',
                      narrator.activeChunkKey === `tip-${i}` && 'bg-primary/15',
                    )}
                  >
                    <ChevronRight className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {active.images && active.images.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Screenshots
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {active.images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightboxImage(img)}
                    className="group text-left rounded-lg border border-border overflow-hidden hover:ring-2 hover:ring-primary/40 transition-all"
                  >
                    <div className="relative w-full aspect-video bg-muted">
                      <Image src={img.url} alt={img.caption ?? active.title} fill unoptimized className="object-cover" />
                    </div>
                    {img.caption && (
                      <p className="text-xs text-muted-foreground px-2 py-1.5 leading-snug">{img.caption}</p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {active.hrefs && active.hrefs.length > 0 && (
            <section className="flex flex-wrap gap-2 pt-1">
              {active.hrefs.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:brightness-110 transition"
                >
                  {link.label}
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              ))}
            </section>
          )}
        </article>
      </div>

      {/* Image lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6"
          onClick={() => setLightboxImage(null)}
        >
          <div className="max-w-4xl w-full space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="relative w-full max-h-[80vh] rounded-lg overflow-hidden bg-black flex items-center justify-center">
              <img src={lightboxImage.url} alt={lightboxImage.caption ?? ''} className="max-h-[80vh] w-auto object-contain" />
            </div>
            <div className="flex items-center justify-between">
              {lightboxImage.caption ? (
                <p className="text-sm text-white/80">{lightboxImage.caption}</p>
              ) : <span />}
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" /> Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Super-admin: create/edit topic modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditing(false)}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{editingIsNew ? 'New Help Guide topic' : 'Edit topic'}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Visible to every user once saved — only super admins can edit.</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Title *</label>
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Category</label>
                <input
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  list="help-categories"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="help-categories">
                  {HELP_CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Visible to</label>
              <select
                value={editForm.audience}
                onChange={(e) => setEditForm((f) => ({ ...f, audience: e.target.value as EditForm['audience'] }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">Everyone</option>
                <option value="member">Member and above</option>
                <option value="manager">Manager and above</option>
                <option value="admin">Admin and above</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Summary *</label>
              <textarea
                value={editForm.summary}
                onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Steps (one per line)</label>
              <textarea
                value={editForm.stepsText}
                onChange={(e) => setEditForm((f) => ({ ...f, stepsText: e.target.value }))}
                rows={5}
                placeholder="Go to CRM → Connections.&#10;Click Connect and choose your provider."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tips (one per line)</label>
              <textarea
                value={editForm.tipsText}
                onChange={(e) => setEditForm((f) => ({ ...f, tipsText: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Images */}
            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground mb-1">Screenshots (e.g. CRM UI for this topic)</label>
              {!editingIsNew ? (
                <>
                  {editingArticleImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {editingArticleImages.map((img) => (
                        <div key={img.id} className="relative group rounded-lg border border-border overflow-hidden">
                          <div className="relative w-full aspect-video bg-muted">
                            <Image src={img.url} alt={img.caption ?? ''} fill unoptimized className="object-cover" />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleImageDelete(img.id)}
                            title="Remove image"
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          {img.caption && (
                            <p className="text-[10px] text-muted-foreground px-1.5 py-1 truncate">{img.caption}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={newImageCaption}
                      onChange={(e) => setNewImageCaption(e.target.value)}
                      placeholder="Caption (optional)"
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <label className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium cursor-pointer hover:bg-accent transition-colors shrink-0',
                      uploadingImage && 'opacity-50 pointer-events-none',
                    )}>
                      <ImageIcon className="w-3.5 h-3.5" />
                      {uploadingImage ? 'Uploading…' : 'Add image'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingImage}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleImageUpload(file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">Save this topic first, then reopen Edit to attach screenshots.</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
              {canRevertOrDelete ? (
                <button
                  type="button"
                  onClick={revertOrDeleteArticle}
                  className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
                >
                  {isStaticArticle(editArticleId ?? '') ? 'Revert to default' : 'Delete topic'}
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:brightness-110 transition disabled:opacity-50"
                >
                  {savingEdit ? 'Saving…' : 'Save topic'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
