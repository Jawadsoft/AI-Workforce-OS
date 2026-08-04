import { Injectable, Logger } from '@nestjs/common'
import puppeteer from 'puppeteer'

export interface DamageMarker {
  x: number          // X coordinate (0-100, percentage of image width)
  y: number          // Y coordinate (0-100, percentage of image height)
  type: 'hail' | 'wind' | 'missing' | 'structural' | 'general'
  label?: string     // Optional label text (e.g., "Impact #1")
  size?: 'small' | 'medium' | 'large'  // Circle size
}

export interface AnnotateImageOptions {
  imageUrl: string
  markers: DamageMarker[]
  imageWidth?: number   // Optional: known image dimensions
  imageHeight?: number
}

@Injectable()
export class ImageAnnotationService {
  private readonly logger = new Logger(ImageAnnotationService.name)

  /**
   * Annotate an image with damage markers (circles, labels).
   * Returns a PNG buffer of the annotated image.
   */
  async annotate(options: AnnotateImageOptions): Promise<Buffer> {
    const { imageUrl, markers } = options

    this.logger.log(`[annotate] Marking ${markers.length} damage spots on image`)

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const page = await browser.newPage()

      // Build HTML with image and SVG overlay for markers
      const html = this.buildHtml(imageUrl, markers)

      // Set viewport to a reasonable size (will be adjusted by the image's natural size)
      await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'networkidle0' })

      // Wait for image to load and get its natural dimensions
      const dimensions = await page.evaluate(() => {
        const img = document.querySelector('img') as HTMLImageElement
        return { width: img.naturalWidth, height: img.naturalHeight }
      })

      // Resize viewport to match image dimensions
      await page.setViewport({
        width: dimensions.width,
        height: dimensions.height,
        deviceScaleFactor: 1,
      })

      // Screenshot the entire page (image + annotations)
      const screenshot = await page.screenshot({
        type: 'png',
        omitBackground: false,
        fullPage: true,
      })

      this.logger.log(`[annotate] Generated annotated image: ${dimensions.width}x${dimensions.height}px`)
      return screenshot as Buffer
    } finally {
      await browser.close()
    }
  }

  /**
   * Build HTML with image and SVG overlay for damage markers
   */
  private buildHtml(imageUrl: string, markers: DamageMarker[]): string {
    const markerColors = {
      hail: '#ef4444',        // red
      wind: '#f59e0b',        // amber
      missing: '#8b5cf6',     // purple
      structural: '#dc2626',  // dark red
      general: '#3b82f6',     // blue
    }

    const markerSizes = {
      small: 30,
      medium: 45,
      large: 60,
    }

    // Generate SVG circles for each marker
    const svgMarkers = markers.map((m, i) => {
      const color = markerColors[m.type] || markerColors.general
      const size = markerSizes[m.size || 'medium']
      const strokeWidth = 3

      return `
        <!-- Marker ${i + 1}: ${m.type} at (${m.x}%, ${m.y}%) -->
        <circle
          cx="${m.x}%"
          cy="${m.y}%"
          r="${size}"
          fill="none"
          stroke="${color}"
          stroke-width="${strokeWidth}"
          opacity="0.9"
        />
        ${m.label ? `
        <text
          x="${m.x}%"
          y="${m.y - size - 10}%"
          fill="${color}"
          font-size="16"
          font-weight="bold"
          text-anchor="middle"
          stroke="white"
          stroke-width="3"
          paint-order="stroke"
        >${m.label}</text>
        ` : ''}
      `
    }).join('\n')

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .container {
      position: relative;
      width: 100%;
      height: 100%;
      display: inline-block;
    }
    img {
      display: block;
      width: 100%;
      height: auto;
    }
    svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${imageUrl}" alt="Inspection Image" crossorigin="anonymous" />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      ${svgMarkers}
    </svg>
  </div>
</body>
</html>
    `.trim()
  }
}
