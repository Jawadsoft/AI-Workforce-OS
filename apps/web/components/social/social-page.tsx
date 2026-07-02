'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useFeatures, FEATURES } from '@/hooks/use-features'
import { useAuthStore } from '@/stores/auth.store'
import {
  Sparkles, Image, Send, Clock, CheckCircle, XCircle,
  Loader2, Plus, Trash2, Edit2, Calendar, RefreshCw,
  Facebook, Linkedin, Twitter, Instagram, LayoutGrid, List,
  BarChart2, Star, Link2, Unlink
} from 'lucide-react'

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  facebook:  <Facebook className="w-4 h-4 text-blue-500" />,
  instagram: <Instagram className="w-4 h-4 text-pink-500" />,
  linkedin:  <Linkedin className="w-4 h-4 text-blue-400" />,
  x:         <Twitter className="w-4 h-4 text-gray-300" />,
}

const STATUS_STYLES: Record<string, string> = {
  draft:            'bg-gray-500/20 text-gray-400',
  pending_approval: 'bg-yellow-500/20 text-yellow-400',
  scheduled:        'bg-blue-500/20 text-blue-400',
  published:        'bg-green-500/20 text-green-400',
  failed:           'bg-red-500/20 text-red-400',
}

const CONTENT_TYPES = ['educational', 'promotional', 'story', 'team', 'general']
const PLATFORMS     = ['facebook', 'instagram', 'linkedin', 'x']

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

const PLATFORM_LABELS: Record<string, string> = {
  facebook:  'Facebook + Instagram',
  linkedin:  'LinkedIn',
  x:         'X (Twitter)',
}

export function SocialPage() {
  const qc = useQueryClient()
  const { isEnabled } = useFeatures()
  const { user } = useAuthStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<'posts' | 'generate' | 'calendar' | 'analytics' | 'accounts'>('posts')
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list')

  // Handle OAuth redirect params
  useEffect(() => {
    const connected = searchParams?.get('connected')
    const error = searchParams?.get('error')
    if (connected) {
      toast.success(`${connected} account connected successfully!`)
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      setTab('accounts')
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (error) {
      toast.error(`OAuth error: ${error}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [searchParams, qc])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [editingPost, setEditingPost] = useState<any>(null)

  // Generate form
  const [brief, setBrief] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'instagram'])
  const [contentType, setContentType] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [drafts, setDrafts] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['social-posts', filterStatus, filterPlatform],
    queryFn: () =>
      api.get('/social/posts', { params: { status: filterStatus || undefined, platform: filterPlatform || undefined } })
        .then((r) => r.data),
    enabled: isEnabled(FEATURES.SOCIAL_MEDIA),
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['social-accounts'],
    queryFn: () => api.get('/social/accounts').then((r) => r.data),
    enabled: isEnabled(FEATURES.SOCIAL_MEDIA),
  })

  const { data: analytics } = useQuery({
    queryKey: ['social-analytics'],
    queryFn: () => api.get('/social/analytics').then((r) => r.data),
    enabled: tab === 'analytics' && isEnabled(FEATURES.SOCIAL_MEDIA),
  })

  // Calendar state
  const [calDays, setCalDays] = useState(30)
  const [calPlatforms, setCalPlatforms] = useState<string[]>(['facebook', 'instagram'])
  const [calItems, setCalItems] = useState<any[]>([])
  const [generatingCal, setGeneratingCal] = useState(false)

  async function handleGenerateCalendar() {
    setGeneratingCal(true)
    try {
      const res = await api.post('/social/calendar', { days: calDays, platforms: calPlatforms })
      setCalItems(Array.isArray(res.data) ? res.data : [])
    } catch { toast.error('Failed to generate calendar') }
    finally { setGeneratingCal(false) }
  }

  // Review-to-post state
  const [reviewText, setReviewText] = useState('')
  const [reviewerName, setReviewerName] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewPlatforms, setReviewPlatforms] = useState<string[]>(['facebook'])
  const [generatingReview, setGeneratingReview] = useState(false)

  async function handleReviewToPost() {
    if (!reviewText.trim()) return
    setGeneratingReview(true)
    try {
      await api.post('/social/review-to-post', { reviewText, reviewerName: reviewerName || undefined, rating: reviewRating, platforms: reviewPlatforms })
      qc.invalidateQueries({ queryKey: ['social-posts'] })
      toast.success('Review posts queued for approval!')
      setReviewText(''); setReviewerName('')
    } catch { toast.error('Failed to create review posts') }
    finally { setGeneratingReview(false) }
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/social/posts/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-posts'] }); toast.success('Post approved & publishing…') },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Approval failed'),
  })

  const publishNowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/social/posts/${id}/publish`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-posts'] }); toast.success('Post published!') },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Publish failed — check account connection'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/social/posts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-posts'] }); toast.success('Post deleted') },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/social/posts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-posts'] })
      setEditingPost(null)
      toast.success('Post updated')
    },
  })

  const saveDraftMutation = useMutation({
    mutationFn: (data: any) => api.post('/social/posts', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-posts'] })
      toast.success('Post saved to queue')
    },
  })

  async function handleGenerate() {
    if (!brief.trim() || platforms.length === 0) return
    setGenerating(true)
    setDrafts([])
    try {
      let res
      if (imageFile) {
        // Use FormData only when uploading an image
        const formData = new FormData()
        formData.append('brief', brief)
        // Send platforms as a single comma-separated string — reliable across all parsers
        formData.append('platforms', platforms.join(','))
        if (contentType) formData.append('contentType', contentType)
        formData.append('image', imageFile)
        res = await api.post('/social/generate', formData)
      } else {
        // Send as JSON when no image — avoids FormData array parsing issues
        res = await api.post('/social/generate', { brief, platforms, contentType: contentType || undefined })
      }
      setDrafts(res.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to generate posts')
    } finally {
      setGenerating(false)
    }
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])
  }

  if (!isEnabled(FEATURES.SOCIAL_MEDIA)) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto">
          <Sparkles className="w-8 h-8 text-purple-400" />
        </div>
        <h2 className="text-xl font-bold">Social Media</h2>
        <p className="text-muted-foreground">This feature is not enabled for your account. Contact your administrator.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Social Media</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Generate, schedule, and publish AI posts</p>
        </div>
        <button
          onClick={() => setTab('generate')}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Generate Post</span>
          <span className="sm:hidden">Generate</span>
        </button>
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-0 border-b border-border overflow-x-auto scrollbar-hide">
        {([['posts', 'Posts'], ['generate', 'Generate'], ['calendar', 'Calendar'], ['analytics', 'Analytics'], ['accounts', 'Accounts']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 sm:px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0 ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Posts Tab */}
      {tab === 'posts' && (
        <div className="space-y-4">
          {/* Filters + view toggle */}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-border bg-background rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring flex-1 sm:flex-none min-w-0"
            >
              <option value="">All Statuses</option>
              {['draft', 'pending_approval', 'scheduled', 'published', 'failed'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="text-sm border border-border bg-background rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring flex-1 sm:flex-none min-w-0"
            >
              <option value="">All Platforms</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-1 border border-border rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('gallery')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Gallery view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className={viewMode === 'gallery' ? 'grid grid-cols-2 md:grid-cols-3 gap-4' : 'space-y-3'}>
              {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>No posts yet. Generate your first post above.</p>
            </div>
          ) : viewMode === 'gallery' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {posts.map((post: any) => (
                <GalleryCard
                  key={post.id}
                  post={post}
                  onApprove={() => approveMutation.mutate(post.id)}
                  onPublishNow={() => publishNowMutation.mutate(post.id)}
                  onDelete={() => { if (confirm('Delete this post?')) deleteMutation.mutate(post.id) }}
                  onEdit={() => setEditingPost({ ...post })}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post: any) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onApprove={() => approveMutation.mutate(post.id)}
                  onPublishNow={() => publishNowMutation.mutate(post.id)}
                  onDelete={() => { if (confirm('Delete this post?')) deleteMutation.mutate(post.id) }}
                  onEdit={() => setEditingPost({ ...post })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Tab */}
      {tab === 'generate' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold">Generate AI Posts</h3>

            {/* Brief */}
            <div>
              <label className="text-sm font-medium">What should the post be about?</label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. We just completed a 3,000 sq ft roof replacement for the Johnson family in Dallas — they left us a 5-star review"
                rows={3}
                className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {/* Platforms */}
            <div>
              <label className="text-sm font-medium">Platforms</label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${platforms.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'}`}
                  >
                    {PLATFORM_ICONS[p]} {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Type + Image */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Content Type (optional)</label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className="w-full mt-1 text-sm border border-border bg-background rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Auto-select (balanced mix)</option>
                  {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Image (optional)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
                  >
                    <Image className="w-4 h-4" />
                    {imageFile ? imageFile.name : 'Upload photo'}
                  </button>
                  {imageFile && (
                    <button onClick={() => setImageFile(null)} className="text-muted-foreground hover:text-foreground">
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">If not provided, AI generates an image</p>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !brief.trim() || platforms.length === 0}
              className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors w-full sm:w-auto"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Generating...' : 'Generate Posts'}
            </button>
          </div>

          {/* Drafts */}
          {drafts.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Generated Drafts</h3>
              {drafts.map((draft, i) => (
                <DraftCard
                  key={i}
                  draft={draft}
                  onSave={(data) => saveDraftMutation.mutate({ ...data, requireApproval: true })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Calendar Tab */}
      {tab === 'calendar' && (
        <div className="space-y-6">
          {/* Review-to-Post */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold">Review → Social Post</h3>
            <p className="text-sm text-muted-foreground">Turn a customer review into ready-to-approve social posts.</p>
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Paste the customer review here..."
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="Customer name (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={reviewRating}
                onChange={(e) => setReviewRating(Number(e.target.value))}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[5,4,3,2,1].map((r) => <option key={r} value={r}>{r} stars</option>)}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map((p) => (
                <button key={p} onClick={() => setReviewPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${reviewPlatforms.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'}`}>
                  {PLATFORM_ICONS[p]} {p}
                </button>
              ))}
            </div>
            <button onClick={handleReviewToPost} disabled={generatingReview || !reviewText.trim() || reviewPlatforms.length === 0}
              className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors w-full sm:w-auto">
              {generatingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generatingReview ? 'Creating posts...' : 'Create Posts from Review'}
            </button>
          </div>

          {/* Content Calendar Generator */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold">Content Calendar</h3>
            <p className="text-sm text-muted-foreground">Generate a content plan with topic ideas for the coming days.</p>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:flex-wrap">
              <select value={calDays} onChange={(e) => setCalDays(Number(e.target.value))}
                className="text-sm border border-border bg-background rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring w-full sm:w-auto">
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map((p) => (
                  <button key={p} onClick={() => setCalPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${calPlatforms.includes(p) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                    {PLATFORM_ICONS[p]} {p}
                  </button>
                ))}
              </div>
              <button onClick={handleGenerateCalendar} disabled={generatingCal || calPlatforms.length === 0}
                className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors sm:ml-auto w-full sm:w-auto">
                {generatingCal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                {generatingCal ? 'Generating...' : 'Generate Calendar'}
              </button>
            </div>
            {calItems.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {calItems.map((item: any, i: number) => (
                  <div key={i} className="flex gap-3 p-3 rounded-lg border border-border bg-background">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {item.day}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {PLATFORM_ICONS[item.platform]}
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-full capitalize">{item.contentType}</span>
                        <span className="text-xs text-muted-foreground">{item.bestTime}</span>
                      </div>
                      <p className="text-sm font-medium mt-0.5">{item.topic}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.brief}</p>
                    </div>
                    <button
                      onClick={() => { setBrief(item.brief); setPlatforms([item.platform]); setContentType(item.contentType); setTab('generate') }}
                      className="text-xs text-primary hover:underline shrink-0"
                    >
                      Generate →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {tab === 'analytics' && (
        <div className="space-y-4">
          {!analytics ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1,2,3,4].map((i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Posts', value: analytics.total ?? 0 },
                  { label: 'Published This Week', value: analytics.thisWeek ?? 0 },
                  { label: 'Pending Approval', value: analytics.pending ?? 0 },
                  { label: 'Platforms Active', value: Object.keys(analytics.byPlatform ?? {}).length },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold mb-3">Posts by Platform</h4>
                  <div className="space-y-2">
                    {Object.entries(analytics.byPlatform ?? {}).map(([p, count]: any) => (
                      <div key={p} className="flex items-center gap-2">
                        {PLATFORM_ICONS[p]}
                        <span className="text-sm capitalize flex-1">{p}</span>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                    ))}
                    {Object.keys(analytics.byPlatform ?? {}).length === 0 && <p className="text-xs text-muted-foreground">No posts yet</p>}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold mb-3">Posts by Status</h4>
                  <div className="space-y-2">
                    {Object.entries(analytics.byStatus ?? {}).map(([s, count]: any) => (
                      <div key={s} className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[s]?.includes('green') ? 'bg-green-500' : STATUS_STYLES[s]?.includes('blue') ? 'bg-blue-500' : STATUS_STYLES[s]?.includes('yellow') ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                        <span className="text-sm capitalize flex-1">{s.replace('_', ' ')}</span>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {(analytics.recentPosts ?? []).length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h4 className="text-sm font-semibold mb-3">Recently Published</h4>
                  <div className="space-y-2">
                    {analytics.recentPosts.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {PLATFORM_ICONS[p.platform]}
                        <span className="flex-1 truncate text-muted-foreground">{p.content.slice(0, 60)}…</span>
                        <span className="text-muted-foreground shrink-0" suppressHydrationWarning>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Accounts Tab */}
      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-1">Connected Social Accounts</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Connect your business accounts so agents can publish directly to your social platforms.
            </p>

            {/* OAuth connect buttons — shown per platform group */}
            {(['facebook', 'linkedin', 'x'] as const).map((platform) => {
              const connected = accounts.find((a: any) => a.platform === platform || (platform === 'facebook' && a.platform === 'instagram'))
              const facebookAcc = accounts.find((a: any) => a.platform === 'facebook')
              const instagramAcc = accounts.find((a: any) => a.platform === 'instagram')

              if (platform === 'facebook') {
                return (
                  <div key="facebook" className="border border-border rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Facebook className="w-5 h-5 text-blue-500" />
                        <span className="font-medium text-sm">Facebook + Instagram</span>
                      </div>
                      {!facebookAcc ? (
                        <a
                          href={`${API_URL}/social/oauth/facebook/connect?tenantId=${user?.tenantId}`}
                          className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Link2 className="w-3.5 h-3.5" /> Connect
                        </a>
                      ) : (
                        <button
                          onClick={() => { if (confirm('Disconnect Facebook?')) api.delete(`/social/accounts/${facebookAcc.id}`).then(() => qc.invalidateQueries({ queryKey: ['social-accounts'] })) }}
                          className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          <Unlink className="w-3.5 h-3.5" /> Disconnect
                        </button>
                      )}
                    </div>
                    {facebookAcc && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                        <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-green-400 font-medium">{facebookAcc.accountName}</span>
                        {instagramAcc && <span>· Instagram: <span className="text-green-400 font-medium">{instagramAcc.accountName}</span></span>}
                      </div>
                    )}
                  </div>
                )
              }

              const acc = accounts.find((a: any) => a.platform === platform)
              const label = PLATFORM_LABELS[platform]
              const icon = platform === 'linkedin'
                ? <Linkedin className="w-5 h-5 text-blue-400" />
                : <Twitter className="w-5 h-5 text-gray-300" />
              const connectColor = platform === 'linkedin' ? 'bg-blue-700 hover:bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'

              return (
                <div key={platform} className="border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {icon}
                      <span className="font-medium text-sm">{label}</span>
                    </div>
                    {!acc ? (
                      <a
                        href={`${API_URL}/social/oauth/${platform}/connect?tenantId=${user?.tenantId}`}
                        className={`flex items-center gap-1.5 text-xs ${connectColor} text-white px-3 py-1.5 rounded-lg transition-colors`}
                      >
                        <Link2 className="w-3.5 h-3.5" /> Connect
                      </a>
                    ) : (
                      <button
                        onClick={() => { if (confirm(`Disconnect ${label}?`)) api.delete(`/social/accounts/${acc.id}`).then(() => qc.invalidateQueries({ queryKey: ['social-accounts'] })) }}
                        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        <Unlink className="w-3.5 h-3.5" /> Disconnect
                      </button>
                    )}
                  </div>
                  {acc && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pl-1">
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-green-400 font-medium">{acc.accountName}</span>
                      {acc.expiresAt && <span suppressHydrationWarning>· Expires {new Date(acc.expiresAt).toLocaleDateString()}</span>}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="mt-4 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Setup required before connecting</p>
              <p>1. Create developer apps at developers.facebook.com, linkedin.com/developers, developer.twitter.com</p>
              <p>2. Add your redirect URIs and copy the App ID / Client ID into your <code className="font-mono bg-muted px-1 rounded">.env</code></p>
              <p>3. Set <code className="font-mono bg-muted px-1 rounded">SOCIAL_OAUTH_REDIRECT_BASE</code> to your API domain</p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Post Modal */}
      {editingPost && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Edit Post</h3>
            <div className="flex items-center gap-2">
              {PLATFORM_ICONS[editingPost.platform]}
              <span className="text-sm capitalize text-muted-foreground">{editingPost.platform}</span>
            </div>
            <textarea
              value={editingPost.content}
              onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
              rows={5}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            {editingPost.imageUrl && (
              <img src={editingPost.imageUrl} alt="post" className="w-full rounded-lg object-cover max-h-48" />
            )}
            <div className="flex gap-3">
              <button
                onClick={() => updateMutation.mutate({ id: editingPost.id, data: { content: editingPost.content } })}
                disabled={updateMutation.isPending}
                className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditingPost(null)}
                className="flex-1 border border-border py-2 rounded-lg text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PostCard({ post, onApprove, onPublishNow, onDelete, onEdit }: {
  post: any
  onApprove: () => void
  onPublishNow: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex gap-3">
      {post.imageUrl && (
        <img src={post.imageUrl} alt="" className="w-24 h-24 sm:w-32 sm:h-32 rounded-lg object-cover shrink-0 self-start" />
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PLATFORM_ICONS[post.platform]}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[post.status] ?? ''}`}>
            {post.status.replace('_', ' ')}
          </span>
          <span className="text-xs text-muted-foreground capitalize bg-muted px-2 py-0.5 rounded-full hidden sm:inline">
            {post.contentType}
          </span>
        </div>
        <p className="text-sm line-clamp-2">{post.content}</p>
        {post.scheduledAt && (
          <p className="text-xs text-muted-foreground flex items-center gap-1" suppressHydrationWarning>
            <Clock className="w-3 h-3" />
            {new Date(post.scheduledAt).toLocaleString()}
          </p>
        )}
        {post.errorMessage && (
          <p className="text-xs text-red-400">{post.errorMessage}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {post.status === 'pending_approval' && (
          <button onClick={onApprove} className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors" title="Approve & Publish">
            <CheckCircle className="w-4 h-4" />
          </button>
        )}
        {(post.status === 'draft' || post.status === 'failed') && (
          <button onClick={onPublishNow} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors" title="Publish Now">
            <Send className="w-4 h-4" />
          </button>
        )}
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors" title="Edit">
          <Edit2 className="w-4 h-4" />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors" title="Delete">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function GalleryCard({ post, onApprove, onPublishNow, onDelete, onEdit }: {
  post: any
  onApprove: () => void
  onPublishNow: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden group relative">
      {post.imageUrl ? (
        <img src={post.imageUrl} alt="" className="w-full aspect-square object-cover" />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <Image className="w-8 h-8 text-muted-foreground/30" />
        </div>
      )}
      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
        <div className="flex items-center gap-1.5">
          {PLATFORM_ICONS[post.platform]}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[post.status] ?? ''}`}>
            {post.status.replace('_', ' ')}
          </span>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-white line-clamp-3">{post.content}</p>
          <div className="flex gap-1.5">
            {post.status === 'pending_approval' && (
              <button onClick={onApprove} className="flex-1 py-1 rounded-lg bg-green-500/80 hover:bg-green-500 text-white text-xs transition-colors">
                Approve
              </button>
            )}
            {(post.status === 'draft' || post.status === 'failed') && (
              <button onClick={onPublishNow} className="flex-1 py-1 rounded-lg bg-blue-500/80 hover:bg-blue-500 text-white text-xs transition-colors">
                Publish Now
              </button>
            )}
            <button onClick={onEdit} className="flex-1 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs transition-colors">
              Edit
            </button>
            <button onClick={onDelete} className="py-1 px-2 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-xs transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
      {/* Bottom info bar */}
      <div className="p-2 flex items-center gap-2">
        {PLATFORM_ICONS[post.platform]}
        <span className="text-xs text-muted-foreground truncate flex-1">{post.content.slice(0, 40)}…</span>
      </div>
    </div>
  )
}

function DraftCard({ draft, onSave }: { draft: any; onSave: (data: any) => void }) {
  const [content, setContent] = useState(draft.content)
  const [showAlts, setShowAlts] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        {PLATFORM_ICONS[draft.platform]}
        <span className="text-sm font-medium capitalize">{draft.platform}</span>
        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ml-auto">{draft.contentType}</span>
      </div>

      {draft.imageUrl && (
        <img src={draft.imageUrl} alt="generated" className="w-full max-h-48 rounded-lg object-cover" />
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />

      {draft.alternatives?.length > 0 && (
        <div>
          <button
            onClick={() => setShowAlts(!showAlts)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            {showAlts ? 'Hide' : 'Show'} {draft.alternatives.length} alternative{draft.alternatives.length > 1 ? 's' : ''}
          </button>
          {showAlts && (
            <div className="mt-2 space-y-2">
              {draft.alternatives.map((alt: string, i: number) => (
                <div key={i} className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Alternative {i + 1}</p>
                  <p className="text-sm">{alt}</p>
                  <button
                    onClick={() => setContent(alt)}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Use this version
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onSave({ platform: draft.platform, content, imageUrl: draft.imageUrl, contentType: draft.contentType })}
          className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors w-full sm:w-auto"
        >
          <Send className="w-3.5 h-3.5" />
          Send to Approval Queue
        </button>
      </div>
    </div>
  )
}
