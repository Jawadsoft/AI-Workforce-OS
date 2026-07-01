import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import * as Mustache from 'mustache'
import { getDocumentTemplateConfig } from './configs'

@Injectable()
export class DocumentTemplatesService {
  private readonly logger = new Logger(DocumentTemplatesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  findAll(tenantId: string) {
    return this.prisma.documentTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.documentTemplate.findFirst({ where: { id, tenantId } })
  }

  async findDefault(tenantId: string, type: string) {
    return this.prisma.documentTemplate.findFirst({
      where: { tenantId, type, isDefault: true },
    })
  }

  async create(tenantId: string, data: {
    name: string
    type: string
    description?: string
    htmlBody: string
    isDefault?: boolean
  }) {
    if (data.isDefault) {
      await this.prisma.documentTemplate.updateMany({
        where: { tenantId, type: data.type, isDefault: true },
        data: { isDefault: false },
      })
    }
    return this.prisma.documentTemplate.create({
      data: { tenantId, ...data },
    })
  }

  async update(tenantId: string, id: string, data: {
    name?: string
    description?: string
    htmlBody?: string
    isDefault?: boolean
  }) {
    const tmpl = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } })
    if (!tmpl) throw new NotFoundException('Template not found')
    if (data.isDefault) {
      await this.prisma.documentTemplate.updateMany({
        where: { tenantId, type: tmpl.type, isDefault: true },
        data: { isDefault: false },
      })
    }
    return this.prisma.documentTemplate.update({ where: { id }, data })
  }

  async remove(tenantId: string, id: string) {
    const tmpl = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } })
    if (!tmpl) throw new NotFoundException('Template not found')
    return this.prisma.documentTemplate.delete({ where: { id } })
  }

  async setDefault(tenantId: string, id: string) {
    const tmpl = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } })
    if (!tmpl) throw new NotFoundException('Template not found')
    await this.prisma.documentTemplate.updateMany({
      where: { tenantId, type: tmpl.type, isDefault: true },
      data: { isDefault: false },
    })
    return this.prisma.documentTemplate.update({ where: { id }, data: { isDefault: true } })
  }

  /**
   * Convert uploaded file buffer to HTML template with {{placeholders}}
   * Supports: .docx, .pdf, .html, .txt
   */
  async convertFileToTemplate(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    tenantId: string,
  ): Promise<{ htmlBody: string; suggestedName: string; suggestedType: string }> {
    let rawText = ''

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || originalName.endsWith('.docx')) {
      try {
        const mod = await import('mammoth')
        const mammoth = (mod as any).default ?? mod
        const result = await mammoth.convertToHtml({ buffer: fileBuffer })
        rawText = result.value
      } catch (err: any) {
        this.logger.warn(`mammoth convertToHtml failed: ${err.message}`)
        rawText = fileBuffer.toString('utf-8')
      }
    } else if (mimeType === 'application/pdf' || originalName.endsWith('.pdf')) {
      try {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer, opts?: any) => Promise<{ text: string }>
        const data = await pdfParse(fileBuffer, { max: 0 })
        rawText = data?.text?.trim() ?? ''
      } catch (err: any) {
        this.logger.warn(`pdf-parse failed in convertFileToTemplate: ${err.message}`)
        // fallback: extract raw strings from PDF binary
        const raw = fileBuffer.toString('latin1')
        const matches = raw.match(/\(([^)]{3,})\)/g) ?? []
        rawText = matches.map((m: string) => m.slice(1, -1)).join(' ')
      }
    } else if (mimeType === 'text/html' || originalName.endsWith('.html')) {
      rawText = fileBuffer.toString('utf-8')
    } else {
      rawText = fileBuffer.toString('utf-8')
    }

    const hasContent = rawText.trim().length > 0

    if (!hasContent) {
      this.logger.warn(`[TemplateConvert] No text extracted from "${originalName}" — falling back to filename-based generation`)
    }

    // Ask AI to convert the raw text/HTML into a Mustache template
    const systemPrompt = `You are a document template conversion engine. You ONLY output complete HTML documents. You never ask for clarification or respond conversationally.

TASK: Convert the document content provided by the user into a reusable HTML template using Mustache {{placeholder}} syntax.

CONVERSION RULES:
1. Replace ALL variable data (names, addresses, dates, amounts, line items) with {{placeholder}} variables
2. Use these standard field names:
   - {{customerName}}, {{address}}, {{phone}}, {{email}}, {{companyName}}, {{date}}
   - {{scopeOfWork}}, {{notes}}, {{total}}, {{subtotal}}, {{taxRate}}, {{dueDate}}
   - Line items loop: {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
   - {{inspectorName}}, {{projectTitle}}, {{estimateNumber}}, {{invoiceNumber}}
3. Keep all formatting, tables, and layout from the original document
4. Add clean professional inline CSS if no styling exists
5. Output a COMPLETE HTML document: <!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>
6. First line inside <body>: <!-- TEMPLATE TYPE: estimate|inspection|sow|invoice|supplement|custom -->
7. Default body text color must be #000000
8. Return ONLY raw HTML — no explanation, no markdown, no code fences`

    const userContent = hasContent
      ? `Convert this document into a Mustache HTML template. Output only HTML:\n\n${rawText.slice(0, 8000)}`
      : `The file "${originalName}" could not be parsed (likely a scanned/image PDF). Based on the filename alone, generate a complete, professional Mustache HTML template for this document type. Output only HTML.`

    const rawHtml = await this.ai.chat(systemPrompt, [
      { role: 'user', content: userContent },
    ])

    const htmlBody = rawHtml
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    // Detect suggested type from AI comment
    const typeMatch = htmlBody.match(/TEMPLATE TYPE:\s*(estimate|inspection|sow|invoice|supplement|custom)/i)
    const suggestedType = typeMatch?.[1]?.toLowerCase() ?? 'custom'

    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '')
    const suggestedName = nameWithoutExt.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

    return { htmlBody, suggestedName, suggestedType }
  }

  /**
   * Render a saved template with data using Mustache
   */
  renderTemplate(htmlBody: string, data: Record<string, any>): string {
    try {
      return Mustache.render(htmlBody, data)
    } catch (err: any) {
      this.logger.warn(`Mustache render failed: ${err.message}`)
      return htmlBody
    }
  }

  async getPlaceholders(tenantId?: string) {
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true, settings: true } })
      : null
    const industry = (tenant?.settings as any)?.brain?.industry ?? tenant?.industry ?? undefined
    return getDocumentTemplateConfig(industry).placeholders
  }

  /**
   * Ask AI to generate a best-practice professional HTML template for the given
   * document type and industry, with Mustache {{placeholders}} pre-inserted.
   */
  async generateProfessionalTemplate(
    type: string,
    industry: string,
    style: 'modern' | 'classic' | 'minimal' = 'modern',
    accentColor = '#1e3a5f',
    tone: 'formal' | 'friendly' | 'urgent' = 'formal',
    outputFormat: 'print' | 'email' | 'web' = 'print',
    customInstructions = '',
  ): Promise<{ htmlBody: string; suggestedName: string }> {
    const industryLabel = industry.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)

    const isEmail = type === 'email' || outputFormat === 'email'
    const templateConfig = getDocumentTemplateConfig(industry)

    const designSystem = (templateConfig.designSystems[style] ?? templateConfig.designSystems.modern)
      .replace(/ACCENT_COLOR/g, accentColor)

    const sectionSpec = templateConfig.sectionSpecs[type] ?? templateConfig.sectionSpecs.custom

    const toneGuide = {
      formal: 'Tone: formal and authoritative — precise language, no contractions, professional distance',
      friendly: 'Tone: warm and approachable — conversational but professional, light personal touch',
      urgent: 'Tone: direct and action-oriented — clear urgency, strong verbs, prominent CTAs',
    }[tone]

    const formatGuide = isEmail
      ? 'Output: email HTML — table-based layout only, ALL CSS inline, no external resources, 600px max-width'
      : outputFormat === 'web'
        ? 'Output: web view — responsive with media queries, rem units, flexbox/grid allowed, viewport-aware'
        : 'Output: print-ready — max-width 800px, pt/px units, @media print rule to hide screen-only elements, good page-break handling'

    const systemPrompt = `You are a senior document designer and HTML/CSS expert. Your specialty is pixel-perfect, production-ready business document templates.

${designSystem}

${sectionSpec}

${toneGuide}
${formatGuide}
Industry: ${industryLabel} — use industry-correct terminology, field names, and section structure throughout.

HARD RULES:
1. Return a COMPLETE, valid HTML document — <!DOCTYPE html> through </html>
2. Every variable data point MUST use Mustache syntax: {{fieldName}} — never use placeholder text like "John Smith" or "123 Main St"
3. Follow the document-type section spec exactly. Use every required Mustache loop named there (lineItems, findings, deliverables, materials, approvedScope, missingItems, underpaidItems, documentationNeeded, recommendedLineItems, actionPlan).
4. Standard line item loops, when used: {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
5. The accent color is exactly: ${accentColor} — use it consistently for header, CTA, highlights, and borders
6. Logo area: <div class="logo-area">{{companyName}}</div> (styled as if a logo/wordmark)
7. Default body text color MUST be black (#000000). Apply color: #000000 to body and main content text.
8. Every section heading, label, and field must be visually distinct — use the design system hierarchy exactly
9. NO placeholder lorem ipsum anywhere — only {{variables}}
10. Return ONLY the raw HTML — zero markdown, zero explanation, zero code fences${customInstructions ? `\n11. ADDITIONAL REQUIREMENTS: ${customInstructions}` : ''}`

    const userMsg = `Generate a complete, production-ready ${typeLabel} template for a ${industryLabel} company.
This template will be used by real clients — it must look like it came from a top-tier ${industryLabel} firm.
Every section from the spec must be present. All fields must use {{Mustache}} variables. Accent color: ${accentColor}.`

    const htmlBody = await this.ai.chat(systemPrompt, [
      { role: 'user', content: userMsg },
    ], undefined, { temperature: 0.2, maxTokens: 4096 })

    const clean = htmlBody
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const toneSuffix = tone !== 'formal' ? ` (${tone.charAt(0).toUpperCase() + tone.slice(1)})` : ''
    const suggestedName = `${industryLabel} ${typeLabel} — ${style.charAt(0).toUpperCase() + style.slice(1)}${toneSuffix}`
    return { htmlBody: clean, suggestedName }
  }
}
