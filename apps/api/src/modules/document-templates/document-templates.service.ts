import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import * as Mustache from 'mustache'

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
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({ buffer: fileBuffer })
      rawText = result.value
    } else if (mimeType === 'application/pdf' || originalName.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default
      const data = await pdfParse(fileBuffer)
      rawText = data.text
    } else if (mimeType === 'text/html' || originalName.endsWith('.html')) {
      rawText = fileBuffer.toString('utf-8')
    } else {
      rawText = fileBuffer.toString('utf-8')
    }

    // Ask AI to convert the raw text/HTML into a Mustache template
    const systemPrompt = `You are a document template conversion assistant.
Convert the provided document into a reusable HTML template using Mustache syntax ({{fieldName}}).

Rules:
1. Replace ALL variable data (names, addresses, dates, amounts, line items) with {{placeholder}} variables
2. Use these standard field names where applicable:
   - {{customerName}}, {{address}}, {{phone}}, {{email}}
   - {{scopeOfWork}}, {{notes}}, {{total}}, {{dueDate}}
   - For line items use: {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{/lineItems}}
   - {{companyName}}, {{inspectorName}}, {{projectTitle}}
3. Keep all formatting, tables, and layout from the original
4. Add basic inline CSS if the document has no styling (professional, clean look)
5. Wrap in a complete HTML document with <html><head><style>...</style></head><body>...</body></html>
6. At the top of the <body>, add: <!-- TEMPLATE TYPE: estimate|inspection|sow|invoice|custom -->
7. Return ONLY the HTML, no explanation`

    const htmlBody = await this.ai.chat(systemPrompt, [
      { role: 'user', content: `Convert this document into a Mustache HTML template:\n\n${rawText.slice(0, 8000)}` },
    ])

    // Detect suggested type from AI comment
    const typeMatch = htmlBody.match(/TEMPLATE TYPE:\s*(estimate|inspection|sow|invoice|custom)/i)
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

  getPlaceholders() {
    return {
      common: ['customerName', 'address', 'phone', 'email', 'companyName', 'date'],
      estimate: ['scopeOfWork', 'lineItems', 'total', 'subtotal', 'taxRate', 'notes', 'validUntil', 'estimateNumber'],
      inspection: ['inspectorName', 'inspectionDate', 'overallCondition', 'summary', 'findings', 'recommendations', 'reportNumber'],
      sow: ['projectTitle', 'startDate', 'endDate', 'overview', 'deliverables', 'materials', 'terms', 'projectNumber'],
      invoice: ['dueDate', 'invoiceNumber', 'status', 'lineItems', 'subtotal', 'taxRate', 'total', 'paymentInstructions'],
      email: ['customerName', 'agentName', 'companyName', 'messageBody', 'ctaUrl', 'ctaLabel', 'subject'],
      custom: ['customerName', 'companyName', 'date', 'notes'],
    }
  }

  // ─── Design Systems ────────────────────────────────────────────────────────

  private readonly DESIGN_SYSTEMS: Record<string, string> = {
    modern: `
DESIGN SYSTEM (apply exactly):
- Font stack: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Page/outer bg: #f1f5f9   Document card bg: #ffffff   Card shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06)
- Header bg: ACCENT_COLOR   Header text: #ffffff   Header padding: 40px 48px
- Accent color: ACCENT_COLOR   Accent hover: darken 8%
- Body text: #1e293b   Muted text: #64748b   Label text: #475569
- Border color: #e2e8f0   Border radius: 10px   Input radius: 6px
- Section padding: 32px 48px   Section gap: 24px
- Table header bg: #f8fafc   Table stripe: #fafafa   Table border: 1px solid #e2e8f0
- Table header text: #475569 uppercase 10px letter-spacing .08em font-weight 600
- CTA button: bg ACCENT_COLOR text #fff padding 12px 28px border-radius 8px font-weight 600 font-size 14px letter-spacing .02em
- Font sizes: h1 28px/1.2 h2 18px/1.3 h3 14px/1.4 body 14px/1.6 small 12px/1.5
- Divider: 1px solid #e2e8f0
- Badge/pill: border-radius 999px padding 3px 10px font-size 11px font-weight 600`,

    classic: `
DESIGN SYSTEM (apply exactly):
- Font stack: Georgia, "Times New Roman", Times, serif   UI labels: Arial, Helvetica, sans-serif
- Page bg: #ffffff   Document max-width: 760px margin: 0 auto
- Header: centered layout, top/bottom double border rule (#1e3a5f 3px + #b8860b 1px), padding 32px 40px
- Accent / heading color: #1e3a5f   Gold accent: #b8860b
- Body text: #222222 14px/1.6   Muted text: #555555   Label: uppercase Arial 10px tracking .1em
- Border: 1px solid #aaaaaa   No border-radius (use 0)
- Section gap: 28px   Section divider: double border rule color #b8860b
- Table: full-width border-collapse border 1px solid #aaaaaa th bg #1e3a5f text white font Arial
- CTA button / stamp: border 2px solid #1e3a5f color #1e3a5f text padding 10px 24px font Arial uppercase tracking .08em
- Font sizes: h1 22px h2 16px h3 13px body 13px small 11px`,

    minimal: `
DESIGN SYSTEM (apply exactly):
- Font stack: "DM Sans", "Inter", system-ui, sans-serif   Fallback: -apple-system
- ALL backgrounds: #ffffff   Zero shadows
- Primary text: #111827   Secondary text: #6b7280   Tertiary: #9ca3af
- Accent: ACCENT_COLOR   Used ONLY for links, CTA, and one thin left-border highlight
- Borders: 1px solid #f3f4f6 only — NO colored borders   Border-radius: 4px
- Section gaps: 48px   No background fills on sections — separation by whitespace only
- Table: no outer border, only thin bottom border on rows #f3f4f6, th text #9ca3af uppercase 10px
- CTA button: bg ACCENT_COLOR text #fff minimal padding 10px 24px border-radius 4px
- Typography: h1 26px/1.15 font-weight 300   h2 15px/1.4 font-weight 600   body 14px/1.75
- No decorative elements — content first`,
  }

  // ─── Section Specs ─────────────────────────────────────────────────────────

  private readonly SECTION_SPECS: Record<string, string> = {
    estimate: `
REQUIRED SECTIONS (in this exact order):
1. Header band: left = logo area + {{companyName}} tagline; right = "ESTIMATE" badge + {{estimateNumber}}; below = thin colored bar
2. Meta row (3-col grid): "Prepared For" {{customerName}} {{address}} | "Estimate Date" {{date}} | "Valid Until" {{validUntil}}
3. Scope of Work: heading + {{scopeOfWork}} paragraph block
4. Line Items Table: columns = # | Description | Qty | Unit Price | Total; Mustache loop {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
5. Totals block (right-aligned): Subtotal {{subtotal}} | Tax ({{taxRate}}%) | GRAND TOTAL {{total}} (large, bold, accent color)
6. Notes/Conditions: {{notes}} in muted box
7. Signature block: two columns — "Authorized by (Company)" + "Accepted by (Customer)" each with blank line + Date
8. Footer bar: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyAddress}} | {{companyWebsite}}`,

    invoice: `
REQUIRED SECTIONS (in this exact order):
1. Header band: logo + {{companyName}}; right = "INVOICE" label + status badge ({{status}}) + {{invoiceNumber}}
2. Billing block (2-col): "From" {{companyName}} {{companyAddress}} | "Bill To" {{customerName}} {{address}} {{phone}} {{email}}
3. Invoice meta row: Invoice Date {{date}} | Due Date {{dueDate}} | Payment Terms {{paymentTerms}}
4. Line Items Table: # | Description | Qty | Unit Price | Amount; Mustache {{#lineItems}}...{{/lineItems}}
5. Totals: Subtotal | Discount {{discount}} | Tax {{taxRate}}% | TOTAL DUE {{total}} (prominent, accented)
6. Payment Instructions: {{paymentInstructions}} in a highlighted box
7. Thank-you note: short branded message
8. Footer: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyWebsite}}`,

    inspection: `
REQUIRED SECTIONS (in this exact order):
1. Header: logo + "INSPECTION REPORT" title + report # {{reportNumber}} + date {{inspectionDate}}
2. Property/Subject info: {{customerName}} | {{address}} | Inspector: {{inspectorName}}
3. Overall Condition badge: {{overallCondition}} — large colored pill (green/yellow/red based on value)
4. Executive Summary: {{summary}} paragraph
5. Findings Table: Area | Finding | Severity | Photo Ref; loop {{#findings}}...{{area}}...{{finding}}...{{severity}}...{{/findings}}
6. Recommendations: {{recommendations}} as a numbered action list
7. Next Steps / Follow-up box: highlighted call-to-action area
8. Signature & Certification block: Inspector signature + Date + License #{{licenseNumber}}
9. Footer: {{companyName}} contact details`,

    sow: `
REQUIRED SECTIONS (in this exact order):
1. Header: "STATEMENT OF WORK" + {{projectTitle}} + {{projectNumber}} + {{date}}
2. Parties block: Client = {{customerName}} {{address}} | Service Provider = {{companyName}} {{companyAddress}}
3. Project Overview: {{overview}} paragraph
4. Scope of Work: {{scopeOfWork}} — use sub-sections if long
5. Deliverables: {{deliverables}} as numbered list
6. Project Timeline: Start {{startDate}} → End {{endDate}} — milestone table if applicable
7. Materials & Resources: {{materials}}
8. Pricing & Payment: {{total}} — payment schedule table
9. Terms & Conditions: {{terms}}
10. Signatures: two-column sign-off block for both parties`,

    email: `
REQUIRED STRUCTURE (email-client-safe, table-based layout only):
1. Outer wrapper: 100% width table bg #f4f4f5
2. Container table: 600px max-width centered bg #ffffff border-radius 8px overflow hidden
3. Header band: full-width table-cell bg ACCENT_COLOR padding 32px 40px — {{companyName}} in white bold 20px
4. Body area: padding 32px 40px
   - Greeting: "Hi {{customerName}}," — 16px bold
   - Message: {{messageBody}} — 15px line-height 1.7 color #374151
   - Spacer: 28px
5. CTA button: centered table with link — bg ACCENT_COLOR text white padding 14px 32px border-radius 6px font-weight 600; href {{ctaUrl}} text {{ctaLabel}}
6. Spacer: 28px
7. Signature: "Best regards," + line break + {{agentName}} + {{companyName}} — 14px muted
8. Footer table: bg #f9fafb border-top 1px solid #e5e7eb padding 20px 40px — {{companyName}} | {{companyPhone}} | unsubscribe link — 12px color #9ca3af centered
IMPORTANT RULES FOR EMAIL:
- ONLY table-based layout (no div flexbox/grid — Outlook will break)
- ALL CSS inline (no <style> block — Gmail strips it)
- No external fonts or images
- Use cellpadding/cellspacing=0 on all tables`,

    custom: `
REQUIRED SECTIONS (general professional document):
1. Header: {{companyName}} logo area + document title
2. Recipient info: {{customerName}}, {{address}}, {{date}}
3. Main content area: {{notes}}
4. Footer: {{companyName}} contact information`,
  }

  /**
   * Ask AI to generate a best-practice professional HTML template for the given
   * document type and industry, with Mustache {{placeholders}} pre-inserted.
   */
  async generateProfessionalTemplate(
    type: string,
    industry: string,
    style: 'modern' | 'classic' | 'minimal' = 'modern',
    accentColor = '#4f46e5',
    tone: 'formal' | 'friendly' | 'urgent' = 'formal',
    outputFormat: 'print' | 'email' | 'web' = 'print',
    customInstructions = '',
  ): Promise<{ htmlBody: string; suggestedName: string }> {
    const industryLabel = industry.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)

    const isEmail = type === 'email' || outputFormat === 'email'

    const designSystem = (this.DESIGN_SYSTEMS[style] ?? this.DESIGN_SYSTEMS.modern)
      .replace(/ACCENT_COLOR/g, accentColor)

    const sectionSpec = this.SECTION_SPECS[type] ?? this.SECTION_SPECS.custom

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
3. Line item loops: {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
4. The accent color is exactly: ${accentColor} — use it consistently for header, CTA, highlights, and borders
5. Logo area: <div class="logo-area">{{companyName}}</div> (styled as if a logo/wordmark)
6. Every section heading, label, and field must be visually distinct — use the design system hierarchy exactly
7. NO placeholder lorem ipsum anywhere — only {{variables}}
8. Return ONLY the raw HTML — zero markdown, zero explanation, zero code fences${customInstructions ? `\n9. ADDITIONAL REQUIREMENTS: ${customInstructions}` : ''}`

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
