'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useFeatures, FEATURES } from '@/hooks/use-features'
import {
  Sparkles, Image, Send, Clock, CheckCircle, XCircle,
  Loader2, Plus, Trash2, Edit2, Calendar, RefreshCw,
  Facebook, Linkedin, Twitter, Instagram, LayoutGrid, List
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

export function SocialPage() {
  const qc = useQueryClient()
  const { isEnabled } = useFeatures()
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<'posts' | 'generate' | 'accounts'>('posts')
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list')
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

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/social/posts/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-posts'] }); toast.success('Post approved') },
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
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Social Media</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate, schedule, and publish AI-crafted posts</p>
        </div>
        <button
          onClick={() => setTab('generate')}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Generate Post
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        {([['posts', 'Posts'], ['generate', 'Generate'], ['accounts', 'Connected Accounts']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Posts Tab */}
      {tab === 'posts' && (
        <div className="space-y-4">
          {/* Filters + view toggle */}
          <div className="flex gap-3 flex-wrap items-center">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-sm border border-border bg-background rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Statuses</option>
              {['draft', 'pending_approval', 'scheduled', 'published', 'failed'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="text-sm border border-border bg-background rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Platforms</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-1 border border-border rounded-lg p-0.5">
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
            <div className="grid grid-cols-2 gap-4">
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
              className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
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

      {/* Accounts Tab */}
      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold mb-1">Connected Social Accounts</h3>
            <p className="text-sm text-muted-foreground mb-4">Platform OAuth connections will appear here once configured.</p>

            {accounts.length === 0 ? (
              <div className="space-y-3">
                {PLATFORMS.map((p) => (
                  <div key={p} className="flex items-center justify-between p-3 border border-border rounded-lg">
                    <div className="flex items-center gap-2">
                      {PLATFORM_ICONS[p]}
                      <span className="text-sm font-medium capitalize">{p}</span>
                    </div>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Coming soon — requires OAuth setup</span>
                  </div>
                ))}
              </div>
            ) : (
              accounts.map((acc: any) => (
                <div key={acc.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex items-center gap-2">
                    {PLATFORM_ICONS[acc.platform]}
                    <div>
                      <p className="text-sm font-medium">{acc.accountName}</p>
                      <p className="text-xs text-muted-foreground">{acc.platform}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { if (confirm('Disconnect this account?')) api.delete(`/social/accounts/${acc.id}`).then(() => qc.invalidateQueries({ queryKey: ['social-accounts'] })) }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ))
            )}
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

function PostCard({ post, onApprove, onDelete, onEdit }: {
  post: any
  onApprove: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex gap-4">
      {post.imageUrl && (
        <img src={post.imageUrl} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" />
      )}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {PLATFORM_ICONS[post.platform]}
          <span className="text-xs capitalize text-muted-foreground">{post.platform}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[post.status] ?? ''}`}>
            {post.status.replace('_', ' ')}
          </span>
          <span className="text-xs text-muted-foreground capitalize bg-muted px-2 py-0.5 rounded-full">
            {post.contentType}
          </span>
        </div>
        <p className="text-sm line-clamp-2">{post.content}</p>
        {post.scheduledAt && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(post.scheduledAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {post.status === 'pending_approval' && (
          <button onClick={onApprove} className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-400 transition-colors" title="Approve">
            <CheckCircle className="w-4 h-4" />
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

function GalleryCard({ post, onApprove, onDelete, onEdit }: {
  post: any
  onApprove: () => void
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
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          Send to Approval Queue
        </button>
      </div>
    </div>
  )
}
