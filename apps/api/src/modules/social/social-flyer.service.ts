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

  async render(backgroundUrl: string, copy: FlyerCopy, brand: FlyerBrand): Promise<Buffer> {
    const html = this.buildHtml(backgroundUrl, copy, brand)
    const puppeteer = await import('puppeteer').then((m) => m.default ?? m)
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
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

  private buildHtml(backgroundUrl: string, copy: FlyerCopy, brand: FlyerBrand): string {
    const accent = /^#[0-9a-f]{3,8}$/i.test(brand.accentColor) ? brand.accentColor : '#1e3a5f'
    const logoBlock = brand.logoUrl
      ? `<img class="logo-img" src="${escapeHtml(brand.logoUrl)}" alt="" />`
      : `<div class="logo-badge">${escapeHtml(brand.companyName.charAt(0).toUpperCase())}</div>`

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
</style>
</head>
<body>
  <div class="canvas">
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
