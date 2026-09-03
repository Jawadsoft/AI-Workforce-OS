'use client'

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { X, Loader2, RefreshCw, Save, Eye, ChevronDown, ChevronUp, Palette, Type, Image as ImageIcon, Phone, List, Wand2, Upload, Trash2, BringToFront, SendToBack, MousePointer2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Position stored as % of canvas size (0–100). */
interface LayerPos { x: number; y: number; w: number; h: number }

interface Bullet { title: string; subtitle?: string; visible: boolean; pos?: LayerPos }

interface SocialPostLayers {
  version: 1
  backgroundUrl: string
  accentColor: string
  /** When true the Puppeteer renderer uses absolute positioning from pos fields. */
  customLayout?: boolean
  logo: {
    url?: string
    visible: boolean
    x?: number   // % from left
    y?: number   // % from top
    width?: number  // % of canvas width
  }
  companyName: { text: string; visible: boolean; pos?: LayerPos }
  headline: { text: string; visible: boolean; fontSize?: number; pos?: LayerPos }
  subheading: { text: string; visible: boolean; pos?: LayerPos }
  bullets: Bullet[]
  cta: { text: string; visible: boolean; pos?: LayerPos }
  contact: { phone?: string; website?: string; visible: boolean; pos?: LayerPos }
}

interface Props {
  postId: string
  initialImageUrl: string
  onClose: () => void
  onSaved: (newImageUrl: string) => void
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon className="w-4 h-4 text-indigo-400" />
          {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-3 space-y-3">{children}</div>}
    </div>
  )
}

// ─── Field components ────────────────────────────────────────────────────────

function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-400 font-medium">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={2}
          className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 focus:border-indigo-500 focus:outline-none resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 focus:border-indigo-500 focus:outline-none"
        />
      )}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-indigo-500' : 'bg-white/20'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
      <span className="text-xs text-slate-300">{label}</span>
    </label>
  )
}

// ─── Full canvas layer editor ─────────────────────────────────────────────────

/**
 * Logical canvas size = Puppeteer render size so font sizes and positions are 1:1.
 * The Fabric canvas is displayed at DISPLAY_W × DISPLAY_H via setZoom(), which
 * means mouse events and object coordinates automatically stay in logical space.
 */
const CANVAS_W = 1536  // matches Puppeteer WIDTH
const CANVAS_H = 1024  // matches Puppeteer HEIGHT
const DISPLAY_W = 600  // CSS pixels shown on screen
const DISPLAY_H = 400  // CSS pixels shown on screen
const CANVAS_ZOOM = DISPLAY_W / CANVAS_W  // 0.390625 — passed to fc.setZoom()

/** Default positions for each layer (% of canvas). Mirrors renderCustomLayout DP. */
const DEFAULT_POS: Record<string, LayerPos> = {
  companyName: { x: 1,  y: 4,  w: 32, h: 4  },
  headline:    { x: 1,  y: 10, w: 42, h: 20 },
  subheading:  { x: 1,  y: 32, w: 38, h: 8  },
  bullet_0:    { x: 1,  y: 52, w: 43, h: 7  },
  bullet_1:    { x: 1,  y: 61, w: 43, h: 7  },
  bullet_2:    { x: 1,  y: 70, w: 43, h: 7  },
  cta:         { x: 1,  y: 87, w: 57, h: 8  },
  contact:     { x: 60, y: 87, w: 38, h: 8  },
  logo:        { x: 72, y: 4,  w: 14, h: 0  },
}

function pct(v: number, total: number) { return Math.round((v / total) * 1000) / 10 }
function px(p: number, total: number) { return (p / 100) * total }

interface CanvasLayerEditorProps {
  layers: SocialPostLayers
  onLayersChange: (patch: Partial<SocialPostLayers>) => void
}

const LABEL: Record<string, string> = {
  logo: 'Logo', companyName: 'Company Name', headline: 'Headline',
  subheading: 'Subheading', bullet_0: 'Bullet 1', bullet_1: 'Bullet 2',
  bullet_2: 'Bullet 3', cta: 'Call to Action', contact: 'Contact Info',
}

const CanvasLayerEditor = memo(function CanvasLayerEditor({ layers, onLayersChange }: CanvasLayerEditorProps) {
  const canvasEl = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<any>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const layersRef = useRef(layers)
  layersRef.current = layers

  useEffect(() => {
    let destroyed = false

    async function init() {
      const fabricModule = await import('fabric')
      const FCanvas = fabricModule.Canvas ?? (fabricModule as any).default?.Canvas
      const Textbox = fabricModule.Textbox ?? (fabricModule as any).default?.Textbox
      const FabricImage = fabricModule.FabricImage ?? fabricModule.Image ?? (fabricModule as any).default?.Image
      const Rect = fabricModule.Rect ?? (fabricModule as any).default?.Rect

      if (destroyed || !canvasEl.current || !FCanvas) return

      // Canvas is created at DISPLAY size but Fabric's zoom maps it to the full
      // CANVAS (Puppeteer) logical space, so every position and font size is 1:1.
      const fc = new FCanvas(canvasEl.current, {
        width: DISPLAY_W, height: DISPLAY_H,
        backgroundColor: 'rgba(0,0,0,0)',
        renderOnAddRemove: true,
      })
      fc.setZoom(CANVAS_ZOOM)
      fabricRef.current = fc

      // Force Fabric's .canvas-container wrapper to sit exactly at 0,0 over the background <img>
      const fabricWrapper = canvasEl.current?.parentElement as HTMLElement | null
      if (fabricWrapper) {
        fabricWrapper.style.position = 'absolute'
        fabricWrapper.style.top = '0'
        fabricWrapper.style.left = '0'
        fabricWrapper.style.pointerEvents = 'none'
        // Re-enable pointer events only on the upper-canvas (interactive layer)
        const upper = fabricWrapper.querySelector('.upper-canvas') as HTMLElement | null
        if (upper) upper.style.pointerEvents = 'auto'
      }

      // Corner size scaled up so handles are still visible at the zoomed-out display size
      const scaledCorner = Math.round(9 / CANVAS_ZOOM)
      const commonOpts = {
        lockRotation: true, borderColor: '#6366f1',
        cornerColor: '#6366f1', cornerSize: scaledCorner, transparentCorners: false,
        padding: Math.round(4 / CANVAS_ZOOM),
      }

      const addText = (id: string, text: string, pos: LayerPos, opts: any = {}) => {
        if (!Textbox) return
        // fontSize here is in LOGICAL pixels (same as Puppeteer) — zoom scales the display
        const obj = new Textbox(text, {
          left: px(pos.x, CANVAS_W), top: px(pos.y, CANVAS_H),
          width: px(pos.w, CANVAS_W),
          fontSize: opts.fontSize ?? 16, fill: '#ffffff',
          fontWeight: opts.bold ? 'bold' : 'normal',
          backgroundColor: 'rgba(0,0,0,0.45)',
          ...commonOpts,
          data: { id },
        })
        fc.add(obj)
        return obj
      }

      const l = layers
      const gp = (key: string, fallback: LayerPos) => {
        const k = key as keyof typeof DEFAULT_POS
        return DEFAULT_POS[k] ?? fallback
      }

      // Font sizes match Puppeteer's renderCustomLayout exactly (zoom scales them down visually)
      if (l.companyName.visible) addText('companyName', l.companyName.text, l.companyName.pos ?? gp('companyName', DEFAULT_POS.companyName), { bold: true, fontSize: 19 })
      if (l.headline.visible)    addText('headline',    l.headline.text,    l.headline.pos    ?? gp('headline',    DEFAULT_POS.headline),    { bold: true, fontSize: l.headline.fontSize ?? 50 })
      if (l.subheading.visible)  addText('subheading',  l.subheading.text,  l.subheading.pos  ?? gp('subheading',  DEFAULT_POS.subheading),  { fontSize: 20 })
      l.bullets.forEach((b, i) => {
        if (b.visible) addText(`bullet_${i}`, `✓ ${b.title}${b.subtitle ? ` — ${b.subtitle}` : ''}`, b.pos ?? DEFAULT_POS[`bullet_${i}`] ?? { x: 1, y: 52 + i * 9, w: 40, h: 7 }, { fontSize: 16 })
      })
      if (l.cta.visible) {
        const p = l.cta.pos ?? DEFAULT_POS.cta
        if (Rect) {
          const bar = new Rect({ left: px(p.x, CANVAS_W), top: px(p.y, CANVAS_H), width: px(p.w, CANVAS_W), height: px(p.h, CANVAS_H), fill: l.accentColor, rx: 6, ry: 6, ...commonOpts, data: { id: 'cta_bg' }, selectable: false, evented: false })
          fc.add(bar)
        }
        addText('cta', l.cta.text, p, { bold: true, fontSize: 20 })
      }
      if (l.contact.visible) {
        const txt = [l.contact.phone, l.contact.website].filter(Boolean).join('  |  ')
        if (txt) addText('contact', txt, l.contact.pos ?? DEFAULT_POS.contact, { fontSize: 16 })
      }

      // ── Logo ─────────────────────────────────────────────────────
      // Logo — load via an Image element first to get natural dimensions without CORS taint
      if (l.logo.visible && l.logo.url && FabricImage) {
        try {
          await new Promise<void>((resolve) => {
            const probe = new window.Image()
            probe.crossOrigin = 'anonymous'
            probe.onload = probe.onerror = async () => {
              if (destroyed) return resolve()
              try {
                const img = await FabricImage.fromURL(l.logo.url!, { crossOrigin: 'anonymous' })
                if (destroyed) return resolve()
                const lx = l.logo.x ?? DEFAULT_POS.logo.x
                const ly = l.logo.y ?? DEFAULT_POS.logo.y
                const lw = l.logo.width ?? DEFAULT_POS.logo.w
                const targetPxW = px(lw, CANVAS_W)
                const logoNatW = img.width ?? probe.naturalWidth ?? 100
                const logoScale = targetPxW / (logoNatW || 100)
                img.set({
                  scaleX: logoScale, scaleY: logoScale,
                  left: px(lx, CANVAS_W), top: px(ly, CANVAS_H),
                  originX: 'left', originY: 'top',
                  ...commonOpts, data: { id: 'logo' },
                })
                fc.add(img)
                fc.renderAll()
              } catch { /* ignore */ }
              resolve()
            }
            probe.src = l.logo.url!
          })
        } catch { /* ignore */ }
      }

      fc.renderAll()

      // ── Events ───────────────────────────────────────────────────
      fc.on('selection:created' as any, (e: any) => setSelectedId(e.selected?.[0]?.data?.id ?? null))
      fc.on('selection:updated' as any, (e: any) => setSelectedId(e.selected?.[0]?.data?.id ?? null))
      fc.on('selection:cleared' as any, () => setSelectedId(null))

      const persist = () => {
        const active = fc.getActiveObject() as any
        if (!active?.data?.id) return
        const id: string = active.data.id
        // active.left/top are LOGICAL coordinates (Fabric returns pre-zoom values)
        const left = active.left ?? 0
        const top = active.top ?? 0
        const scaleX = active.scaleX ?? 1
        const scaleY = active.scaleY ?? 1
        const objW = (active.width ?? 0) * scaleX
        const objH = (active.height ?? 0) * scaleY
        const pos: LayerPos = {
          x: pct(left, CANVAS_W), y: pct(top, CANVAS_H),
          w: pct(Math.max(objW, 10), CANVAS_W), h: pct(Math.max(objH, 2), CANVAS_H),
        }
        const cur = layersRef.current
        if (id === 'logo') {
          const pxW = (active.width ?? 1) * scaleX
          onLayersChange({ logo: { ...cur.logo, x: pos.x, y: pos.y, width: pct(pxW, CANVAS_W) }, customLayout: true })
        } else if (id === 'headline')    onLayersChange({ headline:    { ...cur.headline,    pos }, customLayout: true })
        else if (id === 'subheading')    onLayersChange({ subheading:  { ...cur.subheading,  pos }, customLayout: true })
        else if (id === 'companyName')   onLayersChange({ companyName: { ...cur.companyName, pos }, customLayout: true })
        else if (id === 'cta')           onLayersChange({ cta:         { ...cur.cta,         pos }, customLayout: true })
        else if (id === 'contact')       onLayersChange({ contact:     { ...cur.contact,     pos }, customLayout: true })
        else if (id.startsWith('bullet_')) {
          const idx = parseInt(id.split('_')[1])
          const bullets = cur.bullets.map((b, i) => i === idx ? { ...b, pos } : b)
          onLayersChange({ bullets, customLayout: true })
        }
      }

      // 'object:modified' fires after move, scale, or rotate (v6+ replaces object:moved/scaled)
      fc.on('object:modified' as any, persist)

      // Delete key
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        const active = fc.getActiveObject() as any
        if (!active?.data?.id) return
        const id: string = active.data.id
        fc.remove(active)
        fc.discardActiveObject()
        fc.renderAll()
        const cur = layersRef.current
        if (id === 'logo')           onLayersChange({ logo: { ...cur.logo, visible: false } })
        else if (id === 'headline')  onLayersChange({ headline: { ...cur.headline, visible: false } })
        else if (id === 'subheading') onLayersChange({ subheading: { ...cur.subheading, visible: false } })
        else if (id === 'companyName') onLayersChange({ companyName: { ...cur.companyName, visible: false } })
        else if (id === 'cta')       onLayersChange({ cta: { ...cur.cta, visible: false } })
        else if (id === 'contact')   onLayersChange({ contact: { ...cur.contact, visible: false } })
        else if (id.startsWith('bullet_')) {
          const idx = parseInt(id.split('_')[1])
          const bullets = cur.bullets.map((b, i) => i === idx ? { ...b, visible: false } : b)
          onLayersChange({ bullets })
        }
      }
      window.addEventListener('keydown', onKey)
      fabricRef.current._keyHandler = onKey
    }

    init()
    return () => {
      destroyed = true
      if (fabricRef.current?._keyHandler) window.removeEventListener('keydown', fabricRef.current._keyHandler)
      try { fabricRef.current?.dispose() } catch { /* ignore */ }
      fabricRef.current = null
    }
  // Re-init only when the background or logo URL changes (not every keystroke)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.backgroundUrl, layers.logo.url, layers.accentColor])

  const bringForward = () => { const o = fabricRef.current?.getActiveObject(); if (o) { fabricRef.current.bringObjectForward(o); fabricRef.current.renderAll() } }
  const sendBackward = () => { const o = fabricRef.current?.getActiveObject(); if (o) { fabricRef.current.sendObjectBackwards(o); fabricRef.current.renderAll() } }
  const deleteSelected = () => {
    const active = fabricRef.current?.getActiveObject() as any
    if (!active?.data?.id) return
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-white/10 min-h-[40px]">
        {selectedId ? (
          <>
            <MousePointer2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-slate-200 text-xs font-medium flex-1 truncate">{LABEL[selectedId] ?? selectedId}</span>
            <button onClick={bringForward} title="Bring forward" className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><BringToFront className="w-3.5 h-3.5" /></button>
            <button onClick={sendBackward} title="Send backward" className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><SendToBack className="w-3.5 h-3.5" /></button>
            <button onClick={deleteSelected} title="Delete layer" className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
          </>
        ) : (
          <span className="text-slate-500 text-xs">Click a layer to select it</span>
        )}
      </div>
      {/* Canvas — transparent Fabric canvas over CSS background image */}
      <div
        className="rounded-xl overflow-hidden border border-white/10 relative"
        style={{ width: DISPLAY_W, height: DISPLAY_H }}
      >
        {/* Background rendered via <img> to avoid CORS canvas taint */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={layers.backgroundUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />
        {/* Fabric wraps this in .canvas-container — do NOT use absolute/inset-0 here */}
        <canvas ref={canvasEl} />
      </div>
      <p className="text-slate-600 text-xs text-center">Drag to move · corner handles to resize · Delete key to remove</p>
    </div>
  )
})

// ─── Main editor ─────────────────────────────────────────────────────────────

export function PostImageEditor({ postId, initialImageUrl, onClose, onSaved }: Props) {
  const [layers, setLayers] = useState<SocialPostLayers | null>(null)
  const [previewUrl, setPreviewUrl] = useState(initialImageUrl)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [noLayers, setNoLayers] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const pendingRef = useRef<SocialPostLayers | null>(null)

  // Load layers on mount
  useEffect(() => {
    api.get(`/social/posts/${postId}/layers`)
      .then(res => {
        if (res.data) {
          setLayers(res.data)
          pendingRef.current = res.data
        } else {
          setNoLayers(true)
        }
      })
      .catch(() => setNoLayers(true))
      .finally(() => setLoading(false))
  }, [postId])

  const applyLayersToExisting = async () => {
    setRegenerating(true)
    try {
      const res = await api.post(`/social/posts/${postId}/init-layers`)
      setPreviewUrl(res.data.imageUrl)
      setLayers(res.data.layers)
      pendingRef.current = res.data.layers
      setNoLayers(false)
      toast.success('Branding layers applied to existing image')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to apply layers')
    } finally {
      setRegenerating(false)
    }
  }

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const res = await api.post(`/social/posts/${postId}/regenerate-image`, { imageStyle: 'branded' })
      setPreviewUrl(res.data.imageUrl)
      setNoLayers(false)
      setLoading(true)
      const layersRes = await api.get(`/social/posts/${postId}/layers`)
      if (layersRes.data) {
        setLayers(layersRes.data)
        pendingRef.current = layersRes.data
      }
      toast.success('Image regenerated with layer data')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Regeneration failed')
    } finally {
      setRegenerating(false)
      setLoading(false)
    }
  }

  const update = useCallback((patch: Partial<SocialPostLayers>) => {
    setLayers(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch } as SocialPostLayers
      pendingRef.current = next
      return next
    })
  }, [])

  const applyPreview = async () => {
    if (!layers) return
    setPreviewing(true)
    try {
      const res = await api.patch(`/social/posts/${postId}/layers`, layers)
      setPreviewUrl(res.data.imageUrl)
      setLayers(res.data.layers)
      toast.success('Preview updated')
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const save = async () => {
    if (!layers) return
    setSaving(true)
    try {
      const res = await api.patch(`/social/posts/${postId}/layers`, layers)
      onSaved(res.data.imageUrl)
      toast.success('Post image saved')
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const [logoUploading, setLogoUploading] = useState(false)

  const uploadLogo = async (file: File) => {
    setLogoUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/social/upload-logo', formData)
      const url: string = res.data.url
      update({ logo: { url, visible: true } })
      toast.success('Logo uploaded')
    } catch {
      toast.error('Logo upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  const updateBullet = (idx: number, patch: Partial<Bullet>) => {
    if (!layers) return
    const bullets = layers.bullets.map((b, i) => i === idx ? { ...b, ...patch } : b)
    update({ bullets })
  }

  const addBullet = () => {
    if (!layers || layers.bullets.length >= 3) return
    update({ bullets: [...layers.bullets, { title: 'New feature', subtitle: '', visible: true }] })
  }

  const removeBullet = (idx: number) => {
    if (!layers) return
    update({ bullets: layers.bullets.filter((_, i) => i !== idx) })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/80 backdrop-blur-sm">
      {/* Left: canvas editor + rendered preview */}
      <div className="flex-1 flex flex-col items-center justify-start bg-black/40 p-6 gap-5 overflow-y-auto">
        {layers && (
          <div className="w-full max-w-[620px]">
            <p className="text-slate-500 text-xs mb-2 text-center">Live canvas — drag &amp; resize layers</p>
            <CanvasLayerEditor layers={layers} onLayersChange={update} />
          </div>
        )}
        {/* Rendered preview (after hitting Preview) */}
        {previewUrl && (
          <div className="w-full max-w-[620px]">
            <p className="text-slate-500 text-xs mb-2 text-center">Rendered preview</p>
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Post preview"
                className="w-full rounded-2xl shadow-2xl object-contain"
              />
              {previewing && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}
        {!layers && previewUrl && (
          <div className="relative w-full max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Post preview" className="w-full rounded-2xl shadow-2xl object-contain" />
          </div>
        )}
      </div>

      {/* Right: editor panel */}
      <div className="w-96 flex flex-col bg-slate-900 border-l border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-white font-semibold text-base">Edit Post Image</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            </div>
          )}

          {noLayers && !loading && (
            <div className="text-center py-12 space-y-5 px-4">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto">
                <Wand2 className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <p className="text-slate-300 text-sm font-medium">No editable layer data</p>
                <p className="text-slate-500 text-xs mt-1">Choose how to unlock the editor for this post.</p>
              </div>
              <div className="space-y-3">
                {/* Option A — keep the existing photo, just add branding */}
                <button
                  onClick={applyLayersToExisting}
                  disabled={regenerating}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-700/60 hover:bg-slate-700 border border-slate-600 text-left transition-colors disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
                    {regenerating ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : <ImageIcon className="w-4 h-4 text-indigo-400" />}
                  </div>
                  <div>
                    <p className="text-slate-200 text-sm font-semibold">Add layers to existing image</p>
                    <p className="text-slate-500 text-xs">Keep the current photo — overlay logo, headline &amp; branding on top</p>
                  </div>
                </button>

                {/* Option B — generate a brand new AI image */}
                <button
                  onClick={regenerate}
                  disabled={regenerating}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-700/60 hover:bg-slate-700 border border-slate-600 text-left transition-colors disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-slate-200 text-sm font-semibold">Generate a new AI image</p>
                    <p className="text-slate-500 text-xs">Create a fresh AI background photo with branding overlay</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {layers && (
            <>
              {/* Accent color */}
              <Section title="Brand Color" icon={Palette}>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={layers.accentColor}
                    onChange={e => update({ accentColor: e.target.value })}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={layers.accentColor}
                    onChange={e => update({ accentColor: e.target.value })}
                    className="flex-1 bg-white/10 text-white text-sm rounded-lg px-3 py-2 border border-white/10 focus:border-indigo-500 focus:outline-none font-mono"
                  />
                </div>
              </Section>

              {/* Logo */}
              <Section title="Logo" icon={ImageIcon}>
                <Toggle label="Show logo" checked={layers.logo.visible} onChange={v => update({ logo: { ...layers.logo, visible: v } })} />
                {layers.logo.visible && (
                  <div className="space-y-3">
                    {/* Current logo preview + remove */}
                    {layers.logo.url ? (
                      <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-800 border border-slate-700">
                        <img src={layers.logo.url} alt="logo" className="w-12 h-12 object-contain rounded bg-white p-1 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-300 text-xs truncate">{layers.logo.url.split('/').pop()}</p>
                          <p className="text-slate-500 text-xs">Current logo</p>
                        </div>
                        <button
                          onClick={() => update({ logo: { ...layers.logo, url: undefined, x: undefined, y: undefined, width: undefined } })}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                          title="Remove logo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-slate-500 text-xs">No logo set — upload one below</p>
                    )}

                    {/* Upload button */}
                    <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-indigo-500 cursor-pointer transition-colors bg-slate-800/50 hover:bg-slate-800">
                      {logoUploading
                        ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        : <Upload className="w-4 h-4 text-slate-400" />}
                      <span className="text-slate-400 text-xs">{logoUploading ? 'Uploading...' : 'Upload new logo (PNG / SVG)'}</span>
                      <input
                        type="file"
                        accept="image/png,image/svg+xml,image/jpeg,image/webp"
                        className="hidden"
                        disabled={logoUploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }}
                      />
                    </label>

                    <p className="text-slate-500 text-xs">Position the logo by dragging it on the canvas to the left.</p>
                  </div>
                )}
              </Section>

              {/* Headline */}
              <Section title="Headline" icon={Type}>
                <Toggle label="Show headline" checked={layers.headline.visible} onChange={v => update({ headline: { ...layers.headline, visible: v } })} />
                {layers.headline.visible && (
                  <>
                    <TextField
                      label="Headline text"
                      value={layers.headline.text}
                      onChange={v => update({ headline: { ...layers.headline, text: v } })}
                    />
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400 font-medium">Font size: {layers.headline.fontSize ?? 50}px</label>
                      <input
                        type="range"
                        min={28}
                        max={72}
                        value={layers.headline.fontSize ?? 50}
                        onChange={e => update({ headline: { ...layers.headline, fontSize: Number(e.target.value) } })}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                    <TextField
                      label="Subheading"
                      value={layers.subheading.text}
                      onChange={v => update({ subheading: { ...layers.subheading, text: v } })}
                    />
                    <Toggle label="Show subheading" checked={layers.subheading.visible} onChange={v => update({ subheading: { ...layers.subheading, visible: v } })} />
                  </>
                )}
              </Section>

              {/* Bullets */}
              <Section title="Feature Bullets" icon={List}>
                {layers.bullets.map((b, i) => (
                  <div key={i} className="bg-white/5 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">Bullet {i + 1}</span>
                      <div className="flex items-center gap-2">
                        <Toggle label="Visible" checked={b.visible} onChange={v => updateBullet(i, { visible: v })} />
                        <button onClick={() => removeBullet(i)} className="text-slate-500 hover:text-red-400 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <TextField label="Title" value={b.title} onChange={v => updateBullet(i, { title: v })} />
                    <TextField label="Subtitle" value={b.subtitle ?? ''} onChange={v => updateBullet(i, { subtitle: v })} />
                  </div>
                ))}
                {layers.bullets.length < 3 && (
                  <button
                    onClick={addBullet}
                    className="w-full py-2 text-xs text-indigo-400 border border-dashed border-indigo-500/40 rounded-lg hover:bg-indigo-500/10 transition-colors"
                  >
                    + Add bullet
                  </button>
                )}
              </Section>

              {/* CTA */}
              <Section title="Call to Action" icon={Type}>
                <Toggle label="Show CTA bar" checked={layers.cta.visible} onChange={v => update({ cta: { ...layers.cta, visible: v } })} />
                {layers.cta.visible && (
                  <TextField label="CTA text" value={layers.cta.text} onChange={v => update({ cta: { ...layers.cta, text: v } })} />
                )}
              </Section>

              {/* Contact */}
              <Section title="Contact Info" icon={Phone}>
                <Toggle label="Show contact info" checked={layers.contact.visible} onChange={v => update({ contact: { ...layers.contact, visible: v } })} />
                {layers.contact.visible && (
                  <>
                    <TextField label="Phone" value={layers.contact.phone ?? ''} onChange={v => update({ contact: { ...layers.contact, phone: v } })} />
                    <TextField label="Website" value={layers.contact.website ?? ''} onChange={v => update({ contact: { ...layers.contact, website: v } })} />
                  </>
                )}
              </Section>

              {/* Company name */}
              <Section title="Company Name" icon={Type}>
                <Toggle label="Show company name" checked={layers.companyName.visible} onChange={v => update({ companyName: { ...layers.companyName, visible: v } })} />
                {layers.companyName.visible && (
                  <TextField label="Company name" value={layers.companyName.text} onChange={v => update({ companyName: { ...layers.companyName, text: v } })} />
                )}
              </Section>
            </>
          )}
        </div>

        {/* Footer actions */}
        {layers && (
          <div className="px-4 py-4 border-t border-white/10 flex gap-3">
            <button
              onClick={applyPreview}
              disabled={previewing}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-500/50 text-indigo-300 text-sm font-medium hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
            >
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              Preview
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
