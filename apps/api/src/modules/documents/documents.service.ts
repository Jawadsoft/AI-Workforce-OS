import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'
import { DocumentTemplatesService } from '../document-templates/document-templates.service'
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service'
import {
  BUILTIN_TEMPLATES,
  brandFooterLine,
  currencySymbol,
  detectCompanyNameFromText,
  detectCurrencyFromText,
  fmtMoney,
  normalizeDocData,
  resolveBrandKit,
  resolveCurrencyCode,
  wrapHTML,
  type BrandKit,
} from './document-render.helpers'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name)
  private readonly outputDir = process.env.GENERATED_DOCS_DIR || path.join(process.cwd(), 'generated-docs')

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly docTemplates: DocumentTemplatesService,
    private readonly cloudinary: CloudinaryService,
  ) {
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true })
  }

  findAll(tenantId: string) {
    return this.prisma.generatedDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.generatedDocument.findFirst({ where: { id, tenantId } })
  }

  /** Latest generated document for a tenant (optionally scoped to an agent). */
  async findLatest(tenantId: string, agentId?: string) {
    return this.prisma.generatedDocument.findFirst({
      where: {
        tenantId,
        ...(agentId ? { agentId } : {}),
        fileUrl: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Download a generated document as an email attachment buffer.
   * Supports Cloudinary/remote URLs and legacy local paths.
   */
  async getEmailAttachment(tenantId: string, id: string): Promise<{
    filename: string
    content: Buffer
    contentType: string
    title: string
  } | null> {
    const doc = await this.findOne(tenantId, id)
    if (!doc?.fileUrl) return null

    const isPdf = doc.format?.toUpperCase() === 'PDF' || doc.fileUrl.toLowerCase().endsWith('.pdf')
    const ext = isPdf ? '.pdf' : (path.extname(doc.fileUrl.split('?')[0]) || '.html')
    const contentType = isPdf ? 'application/pdf' : (ext === '.html' ? 'text/html' : 'application/octet-stream')
    const safeTitle = (doc.title || 'document').replace(/[^a-z0-9._ -]/gi, '_').trim() || 'document'
    const filename = safeTitle.toLowerCase().endsWith(ext) ? safeTitle : `${safeTitle}${ext}`

    let content: Buffer
    if (doc.fileUrl.startsWith('http://') || doc.fileUrl.startsWith('https://')) {
      const res = await fetch(doc.fileUrl)
      if (!res.ok) {
        throw new Error(`Failed to download document file (${res.status})`)
      }
      content = Buffer.from(await res.arrayBuffer())
    } else {
      const filePath = this.resolveStoredFile(doc.fileUrl)
      if (!fs.existsSync(filePath)) {
        throw new Error('Document file not found on disk')
      }
      content = fs.readFileSync(filePath)
    }

    return { filename, content, contentType, title: doc.title }
  }

  async generate(tenantId: string, agentId: string | undefined, input: {
    type: string   // 'estimate' | 'inspection' | 'sow' | 'invoice' | 'supplement' | 'custom'
    title: string
    data?: Record<string, any>
    prompt?: string  // if set, use AI to fill the template data
  }) {
    // Resolve brand kit + agent label
    const [tenant, agent] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, settings: true, industry: true } }),
      agentId ? this.prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, role: true } }) : Promise.resolve(null),
    ])
    let brand = resolveBrandKit(tenant)
    const defaultCompany = brand.companyName
    const agentLabel = agent ? `${agent.name} — ${agent.role}` : defaultCompany

    let docData = input.data ?? {}

    // If a freeform prompt is provided, use AI to generate the document data
    if (input.prompt && (!input.data || Object.keys(input.data).length === 0)) {
      const companyNameField =
        `"companyName": "string — YOUR company / letterhead name shown in the document HEADER. Set this when the user asks to change the header/company name (e.g. 'change company name to Acme Ltd'). Do NOT put the customer name here. Default: \\"${defaultCompany}\\""`

      const SCHEMA_HINTS: Record<string, string> = {
        estimate: `{
  "customerName": "string",
  "address": "string",
  "phone": "string (optional)",
  "email": "string (optional)",
  ${companyNameField},
  "scopeOfWork": "string describing the work",
  "lineItems": [{ "description": "string", "qty": number, "unitPrice": number }],
  "notes": "string (optional, e.g. validity period)",
  "taxRate": number (optional percent, default 0),
  "discount": number (optional discount amount, default 0),
  "currency": "ISO currency code — REQUIRED. Use GBP for pounds/£, EUR for euros/€, USD for dollars/$, CAD, AUD, etc. Infer from the user's request (e.g. 'pounds' → GBP). Default USD only if no currency is mentioned.",
  "subtotal": number (sum of line items before tax),
  "total": number (subtotal + tax - discount)
}`,
        inspection: `{
  "customerName": "string",
  "address": "string",
  ${companyNameField},
  "inspector": "string",
  "inspectionDate": "string (date)",
  "overallCondition": "string e.g. Good / Fair / Poor",
  "summary": "string",
  "findings": [{ "area": "string", "condition": "string", "severity": "High|Low", "notes": "string" }],
  "recommendations": "string",
  "photos": "string (optional)"
}`,
        sow: `{
  "projectTitle": "string",
  "customerName": "string",
  ${companyNameField},
  "startDate": "string",
  "endDate": "string",
  "overview": "string",
  "deliverables": ["string", "string"],
  "materials": [{ "name": "string", "quantity": number, "unit": "string", "supplier": "string (optional)" }],
  "terms": "string (optional)"
}`,
        invoice: `{
  "customerName": "string",
  "address": "string",
  ${companyNameField},
  "dueDate": "string e.g. 30 days",
  "status": "Unpaid|Paid",
  "lineItems": [{ "description": "string", "qty": number, "rate": number }],
  "taxRate": number (optional percent, default 0),
  "currency": "ISO currency code — REQUIRED. Use GBP for pounds/£, EUR for euros/€, USD for dollars/$. Infer from the user's request. Default USD only if no currency is mentioned.",
  "subtotal": number,
  "total": number,
  "paymentInstructions": "string (optional)"
}`,
        supplement: `{
  "preparedBy": "string — look for 'Prepared By' label, agent name, or specialist name",
  "customerName": "string — look for 'Insured', 'Customer', or homeowner name",
  ${companyNameField},
  "propertyAddress": "string — look for 'Property Address'",
  "carrier": "string — look for 'Carrier' or insurance company name (e.g. USAA, State Farm, Allstate, Safeco)",
  "carrierAddress": "string — carrier mailing address if present",
  "policyNumber": "string — look for 'Policy Number' or 'Policy #'",
  "claimNumber": "string — look for 'Claim Number', 'Claim #', or 'Claim:'",
  "dateOfLoss": "string — look for 'Date of Loss' or 'DOL'",
  "causeOfLoss": "string — look for 'Cause of Loss', 'Peril', wind/hail/water/fire",
  "deductible": number — policy deductible amount,
  "currency": "ISO currency code — GBP/EUR/USD/etc. Infer from request; default USD",
  "adjuster": "string — full name of adjuster/claim rep",
  "adjusterTitle": "string — e.g. 'Claim Rep/Estimator'",
  "adjusterPhone": "string — adjuster phone number",
  "adjusterEmail": "string — adjuster email address",
  "carrierEstimateDate": "string — date of the carrier's original estimate",
  "claimStatus": "string — look for claim payment status",
  "storiesHeightFactor": "string — e.g. '2-story (1.12x height factor)' or '1-story'",
  "carrierApprovedTotal": number — total RCV from carrier estimate,
  "opIncluded": "string — 'Yes' or 'No' — was O&P included in the carrier estimate",
  "depreciationHeld": number — depreciation amount held by carrier,
  "acvPaid": number — ACV amount already paid,
  "contractorEmail": "string — contractor contact email for the closing paragraph",
  "claimSummary": "string — 1-2 sentence summary of the claim. Write from the available details if not explicitly stated.",
  "approvedScope": [{ "description": "string", "xactimateCode": "string", "qty": "string", "unit": "string", "amount": number }],
  "missingItems": [{ "description": "string", "xactimateCode": "string", "reason": "string — IRC section, manufacturer requirement, or observed condition", "estimatedQty": "string", "confidence": "High|Medium|Low" }],
  "underpaidItems": [{ "description": "string", "xactimateCode": "string", "approvedQty": "string", "approvedAmount": number, "recommendedQty": "string", "recommendedAmount": number, "gap": number, "reason": "string" }],
  "documentationNeeded": ["string — specific photo or document needed"],
  "recommendedLineItems": [{ "xactimateCode": "string — e.g. RFG STEP", "description": "string", "qty": "string", "unit": "string — LF, SQ, EA, etc.", "unitPrice": number, "heightFactor": "string — 1.0x, 1.12x, or 1.24x", "opApplied": "Yes|No", "estimatedValue": number — final RCV after height factor and O&P, "justification": "string — IRC section, manufacturer requirement, or observed condition" }],
  "actionPlan": ["string — each numbered action step"],
  "supplementTotal": number — sum of all recommendedLineItems estimatedValue values,
  "revisedRcvTotal": number — carrierApprovedTotal + supplementTotal,
  "revisedAcv": number — revisedRcvTotal minus depreciationHeld,
  "netAdditionalPaymentDue": number — revisedAcv minus acvPaid,
  "opApplicable": "string — 'Yes — 2+ trades involved' or 'No'",
  "confidenceLevel": "High|Medium|Low",
  "reinspectionRecommended": "Yes|No",
  "opportunityScore": number — extract the numeric score (e.g. 34 from '34/100'), default 0 if not found,
  "opportunityScoreLabel": "string — e.g. 'Minor Opportunity', 'Solid Opportunity', 'Strong Opportunity', 'Major Re-Write', 'Bare Bones'",
  "opportunityScoreBreakdown": "string — the score breakdown explanation line"
}`,
      }

      const schemaHint = SCHEMA_HINTS[input.type] ?? '{}'

      const supplementExtra = input.type === 'supplement' ? `
SUPPLEMENT EXTRACTION RULES — READ CAREFULLY:
- "preparedBy" — look for "Prepared By:", "Kevin", or any "— Insurance Specialist" pattern.
- "carrier" — full company name e.g. "Safeco Insurance Company" or "USAA" or "State Farm".
- "carrierAddress" — mailing address of the insurance carrier if present (PO Box, city, state, zip).
- "adjuster" — full name. Look for "ATTN:", "Claim Rep", "Adjuster Name", or a person's name following carrier details.
- "adjusterTitle" — e.g. "Claim Rep/Estimator". Look next to the adjuster name.
- "adjusterPhone" — phone number associated with the adjuster or claims office.
- "adjusterEmail" — email address associated with the adjuster or claims office.
- "carrierEstimateDate" — date of the carrier's original estimate/loss report.
- "deductible" — policy deductible dollar amount. Look for "DEDUCTIBLE:", "Deductible:", "Less Deductible", or "$X,XXX deductible". Extract as a number. NEVER output the string "N/A" when a number exists.
- "policyNumber" — may appear as "Policy Number:", "Policy #:", or in parentheses after the carrier name.
- "dateOfLoss" — may appear as "Date of Loss:", "DOL:", or a date following "loss on". Extract exactly as written.
- "causeOfLoss" — may appear as "Cause of Loss:", "Peril:", "Loss Type:", or words like "wind", "hail", "storm".
- "claimSummary" — write a 1-2 sentence summary of the claim from all available details. Never leave blank.
- "storiesHeightFactor" — extract from "Stories", "Height Factor", "2-story", "1-story" mentions. Default to "1-story (1.0x)" if not stated.
- "carrierApprovedTotal" — the grand total RCV from the original carrier estimate. Look for "Carrier Approved Total" or "Original Carrier Estimate (RCV)". Extract as a number.
- "opIncluded" — look for "O&P Included: Yes/No" or "Overhead & Profit". Default to "No" if not found.
- "depreciationHeld" — look for "Depreciation Held", "Less Depreciation". Extract as a number.
- "acvPaid" — look for "ACV Paid", "ACV Amount". Extract as a number.
- "approvedScope" — extract EVERY line item from Section 2 (Approved Scope) across ALL trades with description, xactimateCode, qty (as string), unit, and amount. Repair corrupted text (e.g. "Tear o" → "Tear off"). NEVER use "N/A" for xactimateCode — infer a standard code (RFG TEAR, RFG IWS, RFG STRT, RFG DRIP, etc.) when the source omitted it.
- "missingItems" — extract ONLY items genuinely absent from approved scope. Skip anything already listed in approvedScope (Ice & Water, starter, drip edge, etc.). Each row needs real xactimateCode + estimatedQty (concrete measurement preferred). Never use N/A placeholders.
- "underpaidItems" — extract ONLY rows with a positive dollar gap. If the analysis says "No underpaid items" or gaps are $0.00 / N/A, return [].
- "documentationNeeded" — extract ALL items from Section 5 (Documentation Needed) as an array of strings.
- "recommendedLineItems" — extract ALL items from Section 6 (Recommended Additional Line Items). Each MUST include: xactimateCode, description, qty (as string), unit, unitPrice, heightFactor, opApplied, estimatedValue (final RCV dollar amount), justification. Never use N/A codes.
- NEVER set estimatedValue to 0. If unit price and qty are known: estimatedValue = qty × unitPrice × heightFactor × (1.20 if O&P applied).
- "actionPlan" — extract ALL numbered steps from Section 7 (Contractor Action Plan) as an array of strings.
- "supplementTotal" — look for "TOTAL SUPPLEMENT REQUEST" dollar amount. Must equal sum of all recommendedLineItems estimatedValue values.
- "revisedRcvTotal" — look for "Revised Total RCV" or calculate: carrierApprovedTotal + supplementTotal.
- "revisedAcv" — look for "Revised ACV" or calculate: revisedRcvTotal - depreciationHeld.
- "netAdditionalPaymentDue" — look for "Net Additional Payment Due" or calculate: revisedAcv - acvPaid - deductible.
- "opApplicable" — look for "O&P Applicable:" line. "Yes — 2+ trades involved" if multiple trades; "No" otherwise.
- "reinspectionRecommended" — look for "Reinspection Recommended:" line. "Yes" or "No".
- "opportunityScore" — extract the INTEGER from the score line e.g. "34/100" → 34. Default 0 if not present.
- "opportunityScoreLabel" — extract the label e.g. "Minor Opportunity", "Solid Opportunity", "Strong Opportunity", "Major Re-Write", "Bare Bones".
- "opportunityScoreBreakdown" — extract the full score breakdown explanation line.
- Never leave a field as empty string or 0 if the information is present anywhere in the text.
- Clean all description strings: no null bytes, no "Tear o" corruption.` : ''

      const systemPrompt = `You are a document data extraction assistant for ${defaultCompany}.
Extract structured data from the provided text and return ONLY valid JSON matching this exact schema:
${schemaHint}
${supplementExtra}
GENERAL RULES:
- Use ONLY the field names shown above — do not add or rename fields
- Calculate "total" as the sum of all line items (qty * unitPrice or qty * rate)
- CURRENCY IS CRITICAL: set "currency" to the ISO code the user asked for.
  Examples: "pounds" / "£" / "GBP" → "GBP"; "euros" / "€" → "EUR"; "dollars" / "$" → "USD".
  Never force USD when the user requested another currency.
- HEADER COMPANY NAME: if the user asks to change/set/use a different company name in the header/letterhead,
  put that exact name in "companyName". Never confuse this with "customerName".
  Default company name is "${defaultCompany}".
- If a value is not mentioned, use a sensible default or empty string — never null
- Respond with ONLY the JSON object, no explanation, no markdown, no code fences`

      try {
        const raw = await this.ai.chat(systemPrompt, [{ role: 'user', content: input.prompt }])
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (jsonMatch) docData = JSON.parse(jsonMatch[0])
        this.logger.log(`AI doc data generated for type=${input.type}: ${JSON.stringify(docData).slice(0, 200)}`)
      } catch (err: any) {
        this.logger.warn(`AI doc generation failed: ${err.message}`)
      }

      // Hard fallback: if the user asked for pounds/euros/etc but AI omitted or forced USD
      const promptedCurrency = detectCurrencyFromText(input.prompt)
      if (promptedCurrency) {
        docData.currency = promptedCurrency
      }
    }

    // Tenant default currency (used when neither prompt nor AI specifies one)
    const tenantCurrency =
      detectCurrencyFromText((tenant?.settings as any)?.currency) ||
      detectCurrencyFromText((tenant?.settings as any)?.brain?.currency) ||
      null
    if (!docData.currency && tenantCurrency) {
      docData.currency = tenantCurrency
    }

    // Always ensure preparedBy is set for supplement documents
    if (input.type === 'supplement' && !docData.preparedBy) {
      docData.preparedBy = agentLabel
    }

    // Recompute totals / coerce arrays — never trust AI math alone
    docData = normalizeDocData(input.type, docData)
    this.logger.log(`Document currency resolved to ${docData.currency} for type=${input.type}`)

    // Allow chat/prompt overrides of the letterhead company name (brand kit is only the default)
    const promptedCompany = detectCompanyNameFromText(input.prompt)
    const aiCompany =
      (typeof docData.companyName === 'string' && docData.companyName.trim()) ||
      (typeof docData.headerCompanyName === 'string' && docData.headerCompanyName.trim()) ||
      ''
    const overrideCompany = promptedCompany || (
      aiCompany && aiCompany.toLowerCase() !== defaultCompany.toLowerCase() ? aiCompany : null
    )
    if (overrideCompany) {
      brand = { ...brand, companyName: overrideCompany }
      docData.companyName = overrideCompany
      this.logger.log(`Document header company overridden to "${overrideCompany}" (default was "${defaultCompany}")`)
    } else if (!docData.companyName) {
      docData.companyName = brand.companyName
    }

    // Prefer print-grade built-ins. Use a tenant template only if it was manually saved
    // (skip legacy "Auto-generated …" defaults so everyone gets the upgraded design).
    let html: string
    const resolvedTemplate = await this.docTemplates.findDefault(tenantId, input.type)
    const isManualTemplate = !!resolvedTemplate && !String(resolvedTemplate.description ?? '').startsWith('Auto-generated')
    const currency = resolveCurrencyCode(docData.currency)
    const brandTemplateData = {
      ...docData,
      currency,
      currencySymbol: currencySymbol(currency),
      // Pre-format common money fields so Mustache templates show the right symbol
      totalFormatted: fmtMoney(docData.total, currency),
      subtotalFormatted: fmtMoney(docData.subtotal ?? docData.total, currency),
      taxFormatted: fmtMoney(docData.tax, currency),
      discountFormatted: fmtMoney(docData.discount, currency),
      companyName: brand.companyName,
      companyPhone: brand.phone ?? '',
      companyEmail: brand.email ?? '',
      companyAddress: brand.address ?? '',
      companyWebsite: brand.website ?? '',
      tagline: brand.tagline ?? '',
      logoUrl: brand.logoUrl ?? '',
      accentColor: brand.accentColor,
      licenseNumber: brand.licenseNumber ?? '',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      lineItems: Array.isArray(docData.lineItems)
        ? docData.lineItems.map((li: any) => ({
            ...li,
            unitPriceFormatted: fmtMoney(li.unitPrice ?? li.rate, currency),
            rateFormatted: fmtMoney(li.rate ?? li.unitPrice, currency),
            lineTotalFormatted: fmtMoney(li.lineTotal ?? (li.qty ?? 1) * (li.unitPrice ?? li.rate ?? 0), currency),
          }))
        : docData.lineItems,
    }

    if (isManualTemplate && resolvedTemplate) {
      this.logger.log(`Using template "${resolvedTemplate.name}" for type=${input.type}`)
      html = this.docTemplates.renderTemplate(resolvedTemplate.htmlBody, brandTemplateData)
    } else {
      const templateFn = BUILTIN_TEMPLATES[input.type]
      html = templateFn
        ? templateFn(docData, brand)
        : wrapHTML(input.title, `<p>${JSON.stringify(docData, null, 2)}</p>`, brand)
    }

    // Convert HTML to PDF using puppeteer (if available), else save HTML
    let fileUrl: string
    let format = 'HTML'
    try {
      fileUrl = await this.renderPDF(html, input.title, tenantId, brand)
      format = 'PDF'
    } catch (err: any) {
      const message = err?.message ?? String(err)
      const hint = /could not find (chrome|chromium|expected browser)/i.test(message)
        ? ' — Chromium is not installed for Puppeteer. Run "npx puppeteer browsers install chrome" inside apps/api to fix this.'
        : ''
      this.logger.error(`PDF render failed, falling back to HTML: ${message}${hint}`, err?.stack)
      const filename = `${crypto.randomUUID()}.html`
      const buffer = Buffer.from(html, 'utf8')
      fileUrl = await this.cloudinary.upload(tenantId, 'generated-docs', filename, buffer, 'text/html', 'raw')
    }

    return this.prisma.generatedDocument.create({
      data: {
        tenantId,
        agentId,
        title: input.title,
        type: input.type,
        format,
        fileUrl,
        content: docData as any,
        status: 'ready',
      },
    })
  }

  private async renderPDF(html: string, title: string, tenantId: string, brand: BrandKit): Promise<string> {
    const puppeteer = await import('puppeteer').then(m => m.default ?? m)
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    })
    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 })
      // Give webfonts a moment to settle
      await new Promise(r => setTimeout(r, 400))

      const filename = `${crypto.randomUUID()}.pdf`
      const tmpPath = path.join(this.outputDir, filename)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const footerLeft = esc(brandFooterLine(brand))
      const safeTitle = esc(String(title ?? 'Document'))
      const safeCompany = esc(brand.companyName)

      await page.pdf({
        path: tmpPath,
        format: 'Letter',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width:100%;font-size:8px;color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif;">
            <span>${safeTitle}</span>
            <span>${safeCompany}</span>
          </div>`,
        footerTemplate: `
          <div style="width:100%;font-size:8px;color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif;">
            <span>${footerLeft}</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
        margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
      })

      const buffer = fs.readFileSync(tmpPath)
      const fileUrl = await this.cloudinary.upload(tenantId, 'generated-docs', filename, buffer, 'application/pdf', 'raw')
      fs.unlinkSync(tmpPath)
      return fileUrl
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  async remove(tenantId: string, id: string) {
    const doc = await this.prisma.generatedDocument.findFirst({ where: { id, tenantId } })
    if (!doc) throw new NotFoundException('Document not found')
    if (doc.fileUrl) await this.cloudinary.delete(doc.fileUrl)
    return this.prisma.generatedDocument.delete({ where: { id } })
  }

  resolveStoredFile(fileUrl: string) {
    // Legacy local path support
    if (fileUrl.startsWith('/')) {
      const filename = path.basename(fileUrl)
      return path.join(this.outputDir, filename)
    }
    return fileUrl
  }

  getTemplateTypes() {
    return [
      { id: 'estimate', label: 'Estimate / Proposal', description: 'Pricing estimate with line items for a job', fields: ['customerName', 'address', 'lineItems', 'notes'] },
      { id: 'inspection', label: 'Inspection Report', description: 'Detailed property inspection findings', fields: ['customerName', 'address', 'findings', 'recommendations'] },
      { id: 'sow', label: 'Statement of Work', description: 'Project scope, deliverables, and materials list', fields: ['projectTitle', 'customerName', 'deliverables', 'materials'] },
      { id: 'invoice', label: 'Invoice', description: 'Payment invoice for completed work', fields: ['customerName', 'lineItems', 'dueDate', 'total'] },
      { id: 'supplement', label: 'Supplement Request', description: 'Insurance supplement request with priced line items', fields: ['carrier', 'claimNumber', 'recommendedLineItems', 'supplementTotal'] },
    ]
  }
}
