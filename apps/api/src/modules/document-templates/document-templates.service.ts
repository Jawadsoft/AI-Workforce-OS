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
      estimate: ['scopeOfWork', 'lineItems', 'total', 'notes', 'validUntil'],
      inspection: ['inspectorName', 'inspectionDate', 'overallCondition', 'summary', 'findings', 'recommendations'],
      sow: ['projectTitle', 'startDate', 'endDate', 'overview', 'deliverables', 'materials', 'terms'],
      invoice: ['dueDate', 'status', 'lineItems', 'total', 'paymentInstructions'],
    }
  }

  /**
   * Ask AI to generate a best-practice professional HTML template for the given
   * document type and industry, with Mustache {{placeholders}} pre-inserted.
   */
  async generateProfessionalTemplate(
    type: string,
    industry: string,
    style: 'modern' | 'classic' | 'minimal' = 'modern',
  ): Promise<{ htmlBody: string; suggestedName: string }> {
    const industryLabel = industry.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)

    const systemPrompt = `You are an expert document designer specializing in professional business documents.
Your task is to create a complete, pixel-perfect HTML template for the ${industryLabel} industry.

RULES:
1. Create a FULL HTML document (<!DOCTYPE html><html>...) with embedded CSS
2. Style: ${style === 'modern' ? 'modern, clean, professional with a bold header accent color' : style === 'classic' ? 'traditional, formal, corporate with serif fonts' : 'minimal, whitespace-focused, typography-driven'}
3. Use Mustache syntax for ALL variable fields: {{customerName}}, {{address}}, {{phone}}, etc.
4. For line item tables use: {{#lineItems}}...{{description}}...{{qty}}...{{unitPrice}}...{{lineTotal}}...{{/lineItems}}
5. Include ALL sections typical for a professional ${typeLabel} in the ${industryLabel} industry
6. Add a company logo placeholder area at the top: <div class="logo-area"><strong>{{companyName}}</strong></div>
7. Include footer with: {{companyName}} | {{companyPhone}} | {{companyEmail}} | {{companyAddress}}
8. Make it print-ready: max-width 800px, good margins, clean typography
9. Industry-specific: tailor sections, terminology, and fields to ${industryLabel}
10. Return ONLY the complete HTML — no markdown, no explanation, no code fences`

    const userMsg = `Generate a professional ${typeLabel} template for the ${industryLabel} industry. 
It should look like something a top ${industryLabel} company would send to clients.
Include all industry-standard sections and fields with proper {{placeholder}} variables.`

    const htmlBody = await this.ai.chat(systemPrompt, [
      { role: 'user', content: userMsg },
    ])

    const clean = htmlBody
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const suggestedName = `${industryLabel} ${typeLabel} — ${style.charAt(0).toUpperCase() + style.slice(1)}`
    return { htmlBody: clean, suggestedName }
  }
}
