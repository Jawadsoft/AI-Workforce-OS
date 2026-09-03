import { Injectable, Logger } from '@nestjs/common'
import { escapeHtml } from '../documents/document-render.helpers'

export interface FlyerBullet {
  title: string
  subtitle?: string
}

export interface FlyerCopy {
  headline: string
  subheading?: string
  bullets: FlyerBullet[]
  cta: string
}

export interface FlyerBrand {
  companyName: string
  logoUrl?: string
  phone?: string
  website?: string
  accentColor: string
}

/**
 * Structured layer data for a social post.
 * Stored in SocialPost.layers — read/written by AI tools and the visual editor.
 */
interface LayerPos { x: number; y: number; w: number; h: number }

export interface SocialPostLayers {
  version: 1
  backgroundUrl: string
  accentColor: string
  /** When true, all layers are rendered at their stored pos coordinates (absolute layout). */
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
  bullets: Array<{ title: string; subtitle?: string; visible: boolean; pos?: LayerPos }>
  cta: { text: string; visible: boolean; pos?: LayerPos }
  contact: { phone?: string; website?: string; visible: boolean; pos?: LayerPos }
}

// Single reusable check-circle icon — simple/reliable to render in headless
// Chromium (no emoji/webfont dependency), colored per-tenant via `accentColor`.
const CHECK_ICON = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 12.5l4 4L18 8" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/**
 * Renders a branded marketing-flyer PNG by screenshotting an HTML/CSS layout
 * (logo, headline, feature bullets, CTA bar) composited over an AI-generated
 * background photo — using the same Puppeteer/Chromium install already used
 * for PDF document generation (see documents.service.ts renderPDF).
 */
@Injectable()
export class SocialFlyerService {
  private readonly logger = new Logger(SocialFlyerService.name)
  private static readonly WIDTH = 1536
  private static readonly HEIGHT = 1024

  /** Re-render a post image directly from a SocialPostLayers object. */
  async renderFromLayers(layers: SocialPostLayers): Promise<Buffer> {
    // If user moved/resized layers in the canvas editor, use the custom absolute layout
    if (layers.customLayout) {
      return this.renderCustomLayout(layers)
    }
    const copy: FlyerCopy = {
      headline: layers.headline.visible ? layers.headline.text : '',
      subheading: layers.subheading.visible ? layers.subheading.text : undefined,
      bullets: layers.bullets.filter(b => b.visible).map(b => ({ title: b.title, subtitle: b.subtitle })),
      cta: layers.cta.visible ? layers.cta.text : '',
    }
    const brand: FlyerBrand = {
      companyName: layers.companyName.visible ? layers.companyName.text : '',
      logoUrl: layers.logo.visible ? layers.logo.url : undefined,
      phone: layers.contact.visible ? layers.contact.phone : undefined,
      website: layers.contact.visible ? layers.contact.website : undefined,
      accentColor: layers.accentColor,
    }
    const logoPos = (layers.logo.visible && layers.logo.url && layers.logo.x != null && layers.logo.y != null && layers.logo.width != null)
      ? { x: layers.logo.x, y: layers.logo.y, width: layers.logo.width }
      : undefined
    return this.renderWithLogoPos(layers.backgroundUrl, copy, brand, logoPos)
  }

  /** Render every layer at its stored pos (% coordinates) — used after canvas drag/resize. */
  private async renderCustomLayout(layers: SocialPostLayers): Promise<Buffer> {
    const W = SocialFlyerService.WIDTH
    const H = SocialFlyerService.HEIGHT
    const accent = /^#[0-9a-f]{3,8}$/i.test(layers.accentColor) ? layers.accentColor : '#1e3a5f'
    const pct = (p: number, total: number) => `${(p / 100) * total}px`

    const abs = (pos: LayerPos, extra = '') =>
      `position:absolute;left:${pct(pos.x,W)};top:${pct(pos.y,H)};width:${pct(pos.w,W)};${extra}`

    // Default positions (mirrors canvas defaults)
    const DP: Record<string, LayerPos> = {
      companyName: { x:1,  y:4,  w:32, h:4  },
      headline:    { x:1,  y:10, w:42, h:20 },
      subheading:  { x:1,  y:32, w:38, h:8  },
      bullet_0:    { x:1,  y:52, w:43, h:7  },
      bullet_1:    { x:1,  y:61, w:43, h:7  },
      bullet_2:    { x:1,  y:70, w:43, h:7  },
      cta:         { x:1,  y:87, w:57, h:8  },
      contact:     { x:60, y:87, w:38, h:8  },
    }

    const elements: string[] = []

    if (layers.logo.visible && layers.logo.url) {
      const lx = layers.logo.x ?? 72, ly = layers.logo.y ?? 4, lw = layers.logo.width ?? 14
      elements.push(`<img src="${escapeHtml(layers.logo.url)}" style="position:absolute;left:${pct(lx,W)};top:${pct(ly,H)};width:${pct(lw,W)};object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4));" />`)
    }
    if (layers.companyName.visible) {
      const p = layers.companyName.pos ?? DP.companyName
      elements.push(`<div style="${abs(p)}font-size:19px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(layers.companyName.text)}</div>`)
    }
    if (layers.headline.visible) {
      const p = layers.headline.pos ?? DP.headline
      const fs = layers.headline.fontSize ?? 50
      elements.push(`<div style="${abs(p)}font-size:${fs}px;font-weight:800;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.7);line-height:1.15;overflow:hidden;">${escapeHtml(layers.headline.text)}</div>`)
    }
    if (layers.subheading.visible && layers.subheading.text) {
      const p = layers.subheading.pos ?? DP.subheading
      elements.push(`<div style="${abs(p)}font-size:20px;color:rgba(255,255,255,.9);text-shadow:0 1px 4px rgba(0,0,0,.6);line-height:1.4;overflow:hidden;">${escapeHtml(layers.subheading.text)}</div>`)
    }
    layers.bullets.forEach((b, i) => {
      if (!b.visible) return
      const p = b.pos ?? DP[`bullet_${i}`] ?? { x:3, y:52+i*9, w:40, h:7 }
      elements.push(`<div style="${abs(p,'display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.45);border-radius:10px;padding:8px 14px;')}">
        <div style="width:26px;height:26px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 12.5l4 4L18 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div>
          <div style="font-size:16px;font-weight:700;color:#fff;">${escapeHtml(b.title)}</div>
          ${b.subtitle ? `<div style="font-size:13px;color:rgba(255,255,255,.75);">${escapeHtml(b.subtitle)}</div>` : ''}
        </div>
      </div>`)
    })
    if (layers.cta.visible) {
      const p = layers.cta.pos ?? DP.cta
      elements.push(`<div style="${abs(p, `height:${pct(p.h, H)};`)}background:${accent};border-radius:12px;display:flex;align-items:center;padding:0 28px;font-size:20px;font-weight:700;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(layers.cta.text)}</div>`)
    }
    if (layers.contact.visible) {
      const txt = [layers.contact.phone, layers.contact.website].filter(Boolean).join('  |  ')
      if (txt) {
        const p = layers.contact.pos ?? DP.contact
        elements.push(`<div style="${abs(p)}display:flex;align-items:center;background:rgba(255,255,255,.9);border-radius:12px;padding:0 22px;font-size:16px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;">${escapeHtml(txt)}</div>`)
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;}</style>
</head><body>
<div style="position:relative;width:${W}px;height:${H}px;background-image:url('${escapeHtml(layers.backgroundUrl)}');background-size:cover;background-position:center;">
  ${elements.join('\n')}
</div>
</body></html>`

    const puppeteer = await import('puppeteer').then((m) => m.default ?? m)
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 })
      await new Promise((r) => setTimeout(r, 350))
      return (await page.screenshot({ type: 'png' })) as Buffer
    } finally {
      await browser.close()
    }
  }

  async render(backgroundUrl: string, copy: FlyerCopy, brand: FlyerBrand): Promise<Buffer> {
    return this.renderWithLogoPos(backgroundUrl, copy, brand, undefined)
  }

  private async renderWithLogoPos(backgroundUrl: string, copy: FlyerCopy, brand: FlyerBrand, logoPos?: { x: number; y: number; width: number }): Promise<Buffer> {
    const html = this.buildHtml(backgroundUrl, copy, brand, logoPos)
    const puppeteer = await import('puppeteer').then((m) => m.default ?? m)
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({
        width: SocialFlyerService.WIDTH,
        height: SocialFlyerService.HEIGHT,
        deviceScaleFactor: 1,
      })
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 })
      // Give the background photo + logo (remote images) a moment to fully paint
      await new Promise((r) => setTimeout(r, 350))
      const buffer = await page.screenshot({ type: 'png' })
      return buffer as Buffer
    } finally {
      await browser.close()
    }
  }

  private buildHtml(backgroundUrl: string, copy: FlyerCopy, brand: FlyerBrand, logoPos?: { x: number; y: number; width: number }): string {
    const accent = /^#[0-9a-f]{3,8}$/i.test(brand.accentColor) ? brand.accentColor : '#1e3a5f'

    // When the user has manually positioned the logo, render it as an absolute overlay
    // and show only the company name initial badge in the brand-row
    const hasCustomPos = logoPos && brand.logoUrl
    const logoBlock = hasCustomPos
      ? `<div class="logo-badge">${escapeHtml(brand.companyName.charAt(0).toUpperCase())}</div>`
      : brand.logoUrl
        ? `<img class="logo-img" src="${escapeHtml(brand.logoUrl)}" alt="" />`
        : `<div class="logo-badge">${escapeHtml(brand.companyName.charAt(0).toUpperCase())}</div>`

    const absoluteLogoHtml = hasCustomPos
      ? `<img class="logo-absolute" src="${escapeHtml(brand.logoUrl!)}" alt=""
           style="left:${logoPos.x}%;top:${logoPos.y}%;width:${logoPos.width}%;" />`
      : ''

    const bulletsHtml = copy.bullets.slice(0, 3).map((b) => `
      <div class="bullet">
        <div class="bullet-icon">${CHECK_ICON}</div>
        <div>
          <div class="bullet-title">${escapeHtml(b.title)}</div>
          ${b.subtitle ? `<div class="bullet-subtitle">${escapeHtml(b.subtitle)}</div>` : ''}
        </div>
      </div>`).join('\n')

    const contactItems = [
      brand.phone ? `<div class="cta-item">${escapeHtml(brand.phone)}</div>` : '',
      brand.website ? `<div class="cta-item">${escapeHtml(brand.website)}</div>` : '',
    ].filter(Boolean).join('<div class="cta-divider"></div>')

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${SocialFlyerService.WIDTH}px; height:${SocialFlyerService.HEIGHT}px; overflow:hidden;
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .canvas {
    position:relative; width:${SocialFlyerService.WIDTH}px; height:${SocialFlyerService.HEIGHT}px;
    background-image:url('${escapeHtml(backgroundUrl)}'); background-size:cover; background-position:center;
  }
  .left-col {
    position:absolute; top:0; left:0; width:660px; height:100%;
    background:linear-gradient(105deg, rgba(255,255,255,.94) 60%, rgba(255,255,255,0) 100%);
    display:flex; flex-direction:column; padding:44px 40px 150px 48px; gap:30px;
  }
  .brand-row { display:flex; align-items:center; gap:14px; }
  .logo-img { height:52px; max-width:200px; object-fit:contain; }
  .logo-badge {
    width:52px; height:52px; border-radius:13px; background:${accent}; color:#fff;
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:24px; flex-shrink:0;
  }
  .brand-name { font-size:19px; font-weight:700; color:#0f172a; }
  .headline {
    font-size:50px; line-height:1.14; font-weight:800; color:#0f172a; max-width:540px;
    display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;
  }
  .subheading {
    font-size:20px; line-height:1.5; color:#334155; max-width:480px; font-weight:500; margin-top:-10px;
    display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;
  }
  .bullets-col { display:flex; flex-direction:column; gap:14px; margin-top:auto; }
  .bullet { display:flex; align-items:center; gap:16px; background:rgba(255,255,255,.94); padding:12px 18px;
    border-radius:14px; box-shadow:0 4px 14px rgba(0,0,0,.08); }
  .bullet-icon { width:40px; height:40px; border-radius:50%; background:${accent}; display:flex;
    align-items:center; justify-content:center; flex-shrink:0; }
  .bullet-title { font-size:18px; font-weight:700; color:#0f172a; line-height:1.2; }
  .bullet-subtitle { font-size:14px; color:#475569; margin-top:2px; line-height:1.3;
    display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
  .cta-bar {
    position:absolute; bottom:40px; left:48px; right:48px; display:flex; align-items:stretch; height:78px;
    border-radius:16px; overflow:hidden; box-shadow:0 8px 26px rgba(0,0,0,.28);
  }
  .cta-left { background:${accent}; color:#fff; display:flex; align-items:center; padding:0 30px;
    font-size:21px; font-weight:700; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cta-right { background:rgba(255,255,255,.97); display:flex; align-items:center; gap:20px; padding:0 30px; }
  .cta-item { font-size:17px; font-weight:700; color:#0f172a; white-space:nowrap; }
  .cta-divider { width:1px; height:24px; background:#cbd5e1; }
  .logo-absolute {
    position:absolute; object-fit:contain; pointer-events:none;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,.35));
  }
</style>
</head>
<body>
  <div class="canvas">
    ${absoluteLogoHtml}
    <div class="left-col">
      <div class="brand-row">${logoBlock}<span class="brand-name">${escapeHtml(brand.companyName)}</span></div>
      <div>
        <div class="headline">${escapeHtml(copy.headline)}</div>
        ${copy.subheading ? `<div class="subheading">${escapeHtml(copy.subheading)}</div>` : ''}
      </div>
      <div class="bullets-col">${bulletsHtml}</div>
    </div>
    <div class="cta-bar">
      <div class="cta-left">${escapeHtml(copy.cta)}</div>
      ${contactItems ? `<div class="cta-right">${contactItems}</div>` : ''}
    </div>
  </div>
</body>
</html>`
  }
}
