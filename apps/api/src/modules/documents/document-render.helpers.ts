import { cleanExtractedText, filterFalseMissingItems, inferXactimateCode, isPlaceholderValue } from '../../common/utils/text-sanitize.util'
import * as crypto from 'crypto'

// ── Brand kit ─────────────────────────────────────────────────────

export interface BrandKit {
  companyName: string
  tagline?: string
  phone?: string
  email?: string
  address?: string
  website?: string
  logoUrl?: string
  accentColor: string
  licenseNumber?: string
}

export function resolveBrandKit(tenant: { name: string; settings?: any } | null): BrandKit {
  const settings = (tenant?.settings as any) ?? {}
  const brain = settings.brain ?? {}
  const widget = settings.widget ?? {}
  const accent =
    brain.primaryColor ||
    widget.primaryColor ||
    settings.primaryColor ||
    '#1e3a5f'

  return {
    companyName: brain.companyName || tenant?.name || 'Your Company',
    tagline: brain.tagline || undefined,
    phone: brain.phone || settings.phone || undefined,
    email: brain.email || settings.email || undefined,
    address: brain.address || settings.address || undefined,
    website: brain.websiteUrl || settings.websiteUrl || undefined,
    logoUrl: brain.logoUrl || settings.logoUrl || widget.logoUrl || undefined,
    accentColor: String(accent).startsWith('#') ? String(accent) : '#1e3a5f',
    licenseNumber: brain.licenseNumber || settings.licenseNumber || undefined,
  }
}

export function money(n: any): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

/** ISO currency codes we recognize from AI data, prompts, or tenant settings. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  CAD: 'C$',
  AUD: 'A$',
  NZD: 'NZ$',
  INR: '₹',
  PKR: 'Rs',
  JPY: '¥',
  CHF: 'CHF ',
  AED: 'AED ',
  SAR: 'SAR ',
}

/** Map free-text / symbols → ISO code. */
export function resolveCurrencyCode(input?: string | null, fallback = 'USD'): string {
  if (!input || typeof input !== 'string') return fallback
  const raw = input.trim()
  const upper = raw.toUpperCase()
  if (CURRENCY_SYMBOLS[upper]) return upper

  const lower = raw.toLowerCase()
  if (raw.includes('£') || /\b(gbp|pound|pounds|sterling|british\s*pound)\b/.test(lower)) return 'GBP'
  if (raw.includes('€') || /\b(eur|euro|euros)\b/.test(lower)) return 'EUR'
  if (/\b(cad|canadian\s*dollar|canadian\s*dollars)\b/.test(lower)) return 'CAD'
  if (/\b(aud|australian\s*dollar|australian\s*dollars)\b/.test(lower)) return 'AUD'
  if (/\b(nzd|new\s*zealand\s*dollar)\b/.test(lower)) return 'NZD'
  if (raw.includes('₹') || /\b(inr|rupee|rupees|indian\s*rupee)\b/.test(lower)) return 'INR'
  if (/\b(pkr|pakistani\s*rupee)\b/.test(lower)) return 'PKR'
  if (raw.includes('¥') || /\b(jpy|yen|japanese\s*yen)\b/.test(lower)) return 'JPY'
  if (/\b(chf|swiss\s*franc)\b/.test(lower)) return 'CHF'
  if (/\b(aed|dirham)\b/.test(lower)) return 'AED'
  if (/\b(sar|riyal)\b/.test(lower)) return 'SAR'
  if (raw.includes('$') || /\b(usd|us\s*dollar|dollars?|\$)\b/.test(lower)) return 'USD'
  return fallback
}

export function currencySymbol(code?: string | null): string {
  const c = resolveCurrencyCode(code)
  return CURRENCY_SYMBOLS[c] ?? `${c} `
}

/** Format an amount with the correct currency symbol (e.g. £1,234.56). */
export function fmtMoney(n: any, currency?: string | null): string {
  const v = Number(n)
  const amount = Number.isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00'
  return `${currencySymbol(currency)}${amount}`
}

/**
 * Detect an explicit request to change the document header / letterhead company name.
 * Only matches clear override phrases so we don't confuse customer names with issuer names.
 */
export function detectCompanyNameFromText(text?: string | null): string | null {
  if (!text) return null
  const patterns = [
    /(?:header\s+)?company\s*name\s*(?:to|as|:|=)\s*["']?([^"'\n]+?)["']?(?=\s*(?:\.|,|;|!|\n|$|\band\b|\bwith\b|\bin\b|\bfor\b|\bcurrency\b))/i,
    /(?:change|set|use|update|replace|put)\s+(?:the\s+)?(?:header\s+)?(?:company|business|letterhead)\s*name\s+(?:to|as|:|=)\s*["']?([^"'\n]+)/i,
    /(?:letterhead|header)\s*(?:company\s*)?(?:to|as|:|=|should\s+(?:say|be|read)|named?)\s*["']?([^"'\n]+)/i,
    /(?:with|under|using)\s+(?:the\s+)?(?:letterhead|header)\s+["']?([^"'\n]+)/i,
    /companyName\s*[:=]\s*["']?([^"'\n]+)/i,
    /(?:issued\s+by|on\s+behalf\s+of\s+company)\s*["']?([^"'\n]+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      // Stop at common trailing clauses (currency, customer, etc.)
      let name = m[1]
        .replace(/\s+\b(?:and|with|in|for|currency|customer|address|phone|email|scope)\b[\s\S]*$/i, '')
        .trim()
        .replace(/^["'\s]+|["'\s.,;:!]+$/g, '')
      if (name.length >= 2 && name.length <= 120) return name
    }
  }
  return null
}

/** Infer currency from freeform prompt text when AI omits it. */
export function detectCurrencyFromText(text?: string | null): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  if (text.includes('£') || /\b(gbp|pound|pounds|sterling|british\s*pound)\b/.test(lower)) return 'GBP'
  if (text.includes('€') || /\b(eur|euro|euros)\b/.test(lower)) return 'EUR'
  if (/\b(cad|canadian\s*dollars?)\b/.test(lower)) return 'CAD'
  if (/\b(aud|australian\s*dollars?)\b/.test(lower)) return 'AUD'
  if (/\b(nzd|new\s*zealand\s*dollars?)\b/.test(lower)) return 'NZD'
  if (text.includes('₹') || /\b(inr|rupees?|indian\s*rupees?)\b/.test(lower)) return 'INR'
  if (/\b(pkr|pakistani\s*rupees?)\b/.test(lower)) return 'PKR'
  if (text.includes('¥') || /\b(jpy|yen|japanese\s*yen)\b/.test(lower)) return 'JPY'
  if (/\b(chf|swiss\s*francs?)\b/.test(lower)) return 'CHF'
  if (/\b(aed|dirhams?)\b/.test(lower)) return 'AED'
  if (/\b(sar|riyals?)\b/.test(lower)) return 'SAR'
  if (/\b(usd|us\s*dollars?|in\s+dollars?|american\s*dollars?)\b/.test(lower)) return 'USD'
  return null
}

export function escapeHtml(s: any): string {
  return cleanExtractedText(String(s ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const asArray = (value: any) => (Array.isArray(value) ? value : value ? [value] : [])

function brandContactLine(brand: BrandKit): string {
  return [brand.phone, brand.email, brand.website].filter(Boolean).join(' · ')
}

export function brandFooterLine(brand: BrandKit): string {
  const parts = [
    brand.companyName,
    brand.address,
    brand.phone,
    brand.email,
    brand.licenseNumber ? `Lic. ${brand.licenseNumber}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Normalize AI-extracted data: coerce numbers, recompute line totals & grand totals. */
export function normalizeDocData(type: string, data: Record<string, any>): Record<string, any> {
  const out = { ...data }
  out.currency = resolveCurrencyCode(out.currency ?? out.currencyCode ?? out.currencySymbol)

  const normalizeLineItems = (items: any[], priceKey: 'unitPrice' | 'rate' = 'unitPrice') =>
    asArray(items).map((li: any, idx: number) => {
      const qty = Number(li.qty ?? 1) || 0
      const unitPrice = Number(li[priceKey] ?? li.unitPrice ?? li.rate ?? 0) || 0
      const lineTotal = Number(li.lineTotal ?? qty * unitPrice) || qty * unitPrice
      return {
        ...li,
        description: li.description ?? `Item ${idx + 1}`,
        qty,
        unitPrice,
        rate: unitPrice,
        lineTotal: Math.round(lineTotal * 100) / 100,
      }
    })

  if (type === 'estimate' || type === 'invoice') {
    const priceKey = type === 'invoice' ? 'rate' : 'unitPrice'
    const lineItems = normalizeLineItems(out.lineItems, priceKey as 'unitPrice' | 'rate')
    const subtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0)
    const taxRate = Number(out.taxRate ?? 0) || 0
    const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100
    const discount = Number(out.discount ?? 0) || 0
    const total = Math.round((subtotal + tax - discount) * 100) / 100
    out.lineItems = lineItems
    out.subtotal = Math.round(subtotal * 100) / 100
    out.tax = tax
    out.total = total
    if (!out.validUntil && type === 'estimate') {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      out.validUntil = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    }
    if (!out.estimateNumber && type === 'estimate') {
      out.estimateNumber = `EST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    }
    if (!out.invoiceNumber && type === 'invoice') {
      out.invoiceNumber = `INV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    }
  }

  if (type === 'supplement') {
    const cleanStr = (v: any) => cleanExtractedText(String(v ?? ''))

    // Sanitize all approved-scope rows + fill missing Xactimate codes when possible
    out.approvedScope = asArray(out.approvedScope)
      .map((item: any) => {
        const description = cleanStr(item.description)
        if (!description) return null
        let code = cleanStr(item.xactimateCode)
        if (isPlaceholderValue(code)) code = inferXactimateCode(description)
        return {
          ...item,
          description,
          xactimateCode: code || undefined,
          qty: isPlaceholderValue(item.qty) ? undefined : cleanStr(item.qty),
          unit: isPlaceholderValue(item.unit) ? undefined : cleanStr(item.unit),
          amount: Number(item.amount ?? 0) || 0,
        }
      })
      .filter(Boolean)

    // Drop false "missing" items already present in approved scope
    out.missingItems = filterFalseMissingItems(asArray(out.missingItems), out.approvedScope)
      .map((item: any) => {
        const description = cleanStr(item.description)
        if (!description) return null
        let code = cleanStr(item.xactimateCode)
        if (isPlaceholderValue(code)) code = inferXactimateCode(description)
        const estimatedQty = isPlaceholderValue(item.estimatedQty) ? undefined : cleanStr(item.estimatedQty)
        return {
          ...item,
          description,
          xactimateCode: code || undefined,
          reason: cleanStr(item.reason),
          estimatedQty,
          confidence: cleanStr(item.confidence) || 'Medium',
        }
      })
      .filter(Boolean)

    // Keep only underpaid rows with a real positive dollar gap — no empty N/A tables
    out.underpaidItems = asArray(out.underpaidItems)
      .map((item: any) => {
        const description = cleanStr(item.description)
        if (!description || isPlaceholderValue(description)) return null
        const approvedAmount = Number(item.approvedAmount ?? 0) || 0
        const recommendedAmount = Number(item.recommendedAmount ?? 0) || 0
        const gap = Number(item.gap ?? recommendedAmount - approvedAmount) || 0
        if (gap <= 0) return null
        let code = cleanStr(item.xactimateCode)
        if (isPlaceholderValue(code)) code = inferXactimateCode(description)
        return {
          ...item,
          description,
          xactimateCode: code || undefined,
          approvedQty: isPlaceholderValue(item.approvedQty) ? undefined : cleanStr(item.approvedQty),
          recommendedQty: isPlaceholderValue(item.recommendedQty) ? undefined : cleanStr(item.recommendedQty),
          approvedAmount,
          recommendedAmount,
          gap: Math.round(gap * 100) / 100,
          reason: cleanStr(item.reason),
        }
      })
      .filter(Boolean)

    const items = asArray(out.recommendedLineItems).map((item: any) => {
      const description = cleanStr(item.description)
      let code = cleanStr(item.xactimateCode)
      if (isPlaceholderValue(code)) code = inferXactimateCode(description)
      const qty = parseFloat(String(item.qty ?? '0').replace(/[^0-9.]/g, '')) || 0
      const unitPrice = Number(item.unitPrice ?? 0) || 0
      const hfMatch = String(item.heightFactor ?? '1').match(/([\d.]+)/)
      const heightFactor = hfMatch ? parseFloat(hfMatch[1]) : 1
      const opMult = String(item.opApplied ?? '').toLowerCase().startsWith('y') ? 1.2 : 1
      let estimatedValue = Number(item.estimatedValue ?? 0)
      if (!estimatedValue && qty && unitPrice) {
        estimatedValue = qty * unitPrice * heightFactor * opMult
      }
      // O&P lump-sum lines often pass estimatedValue without unitPrice
      if (!estimatedValue && code === 'O&P' && Number(item.estimatedValue)) {
        estimatedValue = Number(item.estimatedValue)
      }
      return {
        ...item,
        description,
        xactimateCode: code || undefined,
        qty: isPlaceholderValue(item.qty) ? undefined : cleanStr(item.qty),
        unit: isPlaceholderValue(item.unit) ? undefined : cleanStr(item.unit),
        justification: cleanStr(item.justification),
        estimatedValue: Math.round(estimatedValue * 100) / 100,
      }
    }).filter((item: any) => item.description && (item.estimatedValue > 0 || item.xactimateCode === 'O&P'))

    out.recommendedLineItems = items
    const supplementTotal = items.reduce((s: number, i: any) => s + (Number(i.estimatedValue) || 0), 0)
    out.supplementTotal = Math.round(supplementTotal * 100) / 100
    const carrierApproved = Number(out.carrierApprovedTotal ?? 0) || 0
    out.revisedRcvTotal = Math.round((carrierApproved + out.supplementTotal) * 100) / 100
    const depreciation = Number(out.depreciationHeld ?? 0) || 0
    out.revisedAcv = Math.round((out.revisedRcvTotal - depreciation) * 100) / 100
    const acvPaid = Number(out.acvPaid ?? 0) || 0
    const deductible = Number(out.deductible ?? 0) || 0
    out.netAdditionalPaymentDue = Math.round((out.revisedAcv - acvPaid - deductible) * 100) / 100

    // Clean scalar string fields used on cover page
    for (const key of [
      'carrier', 'claimNumber', 'policyNumber', 'customerName', 'propertyAddress', 'address',
      'dateOfLoss', 'causeOfLoss', 'adjuster', 'adjusterTitle', 'claimSummary', 'storiesHeightFactor',
      'preparedBy', 'opIncluded', 'opApplicable', 'confidenceLevel', 'reinspectionRecommended',
      'opportunityScoreLabel', 'opportunityScoreBreakdown',
    ]) {
      if (out[key] !== undefined && out[key] !== null) out[key] = cleanStr(out[key])
    }
    if (isPlaceholderValue(out.deductible) || out.deductible === 'N/A') {
      // keep numeric 0 only if truly unknown; prefer leaving number if already parsed
      if (typeof out.deductible === 'string') out.deductible = 0
    }
  }

  for (const key of [
    'findings',
    'deliverables',
    'materials',
    'approvedScope',
    'missingItems',
    'underpaidItems',
    'documentationNeeded',
    'actionPlan',
  ]) {
    if (out[key] !== undefined) out[key] = asArray(out[key])
  }

  return out
}

// ── Print-grade HTML shell ────────────────────────────────────────

export function wrapHTML(title: string, body: string, brand: BrandKit, docNumber?: string): string {
  const accent = brand.accentColor
  const docNum = docNumber || crypto.randomBytes(3).toString('hex').toUpperCase()
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const logoBlock = brand.logoUrl
    ? `<img class="logo" src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" />`
    : `<div class="company-mark">${escapeHtml(brand.companyName.charAt(0))}</div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Source+Serif+4:wght@600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Source Sans 3', 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      font-size: 12.5px;
      line-height: 1.65;
      padding: 28px 36px 36px;
    }
    .letterhead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 18px;
      margin-bottom: 8px;
      border-bottom: 3px solid ${accent};
    }
    .brand-left { display: flex; align-items: center; gap: 14px; }
    .logo { max-height: 52px; max-width: 160px; object-fit: contain; }
    .company-mark {
      width: 48px; height: 48px; border-radius: 8px;
      background: ${accent}; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Source Serif 4', Georgia, serif;
      font-size: 22px; font-weight: 700;
    }
    .company-name {
      font-family: 'Source Serif 4', Georgia, serif;
      font-size: 20px; font-weight: 700; color: ${accent}; letter-spacing: 0.01em;
    }
    .company-tagline { font-size: 11px; color: #64748b; margin-top: 2px; }
    .company-contact { font-size: 10.5px; color: #64748b; margin-top: 4px; }
    .doc-meta { text-align: right; min-width: 160px; }
    .doc-badge {
      display: inline-block;
      background: ${accent}; color: #fff;
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; padding: 5px 12px; border-radius: 4px;
      margin-bottom: 8px;
    }
    .doc-meta-line { font-size: 11px; color: #64748b; }
    .accent-bar { height: 4px; background: linear-gradient(90deg, ${accent}, ${accent}55); margin-bottom: 22px; border-radius: 2px; }
    h2 {
      font-size: 11px; font-weight: 700; color: ${accent};
      text-transform: uppercase; letter-spacing: 0.08em;
      margin: 22px 0 10px; padding-bottom: 4px;
      border-bottom: 1.5px solid ${accent}33;
    }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; page-break-inside: avoid; }
    th {
      background: ${accent}; color: #fff;
      padding: 8px 10px; text-align: left;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .total-row td { font-weight: 700; background: ${accent}12; border-top: 2px solid ${accent}; }
    .totals-box {
      width: 280px; margin-left: auto; margin-top: 8px;
      border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;
      page-break-inside: avoid;
    }
    .totals-box .row { display: flex; justify-content: space-between; padding: 7px 12px; font-size: 12px; }
    .totals-box .row.muted { color: #64748b; background: #f8fafc; }
    .totals-box .row.grand { background: ${accent}; color: #fff; font-weight: 700; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
    .badge-blue { background: #dbeafe; color: #1d4ed8; }
    .badge-green { background: #dcfce7; color: #15803d; }
    .badge-amber { background: #fef3c7; color: #b45309; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 16px; }
    .info-block {
      padding: 12px 14px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 6px;
      border-left: 3px solid ${accent};
      page-break-inside: avoid;
    }
    .info-label { font-size: 9.5px; text-transform: uppercase; color: #94a3b8; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 3px; }
    .info-value { font-size: 12.5px; color: #0f172a; font-weight: 600; }
    .notes-box {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 12px 14px; margin-top: 8px; color: #334155; font-size: 12px;
    }
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 36px; page-break-inside: avoid; }
    .sig-block { padding-top: 36px; border-top: 1px solid #0f172a; font-size: 11px; color: #64748b; }
    .sig-block strong { display: block; color: #0f172a; margin-bottom: 4px; font-size: 12px; }
    .doc-footer {
      margin-top: 40px; padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px; color: #94a3b8; text-align: center;
    }
    p { margin: 6px 0; }
    ul { margin: 6px 0 6px 18px; }
    li { margin: 3px 0; }
    @media print {
      body { padding: 0; }
      .info-block, table, .totals-box, .sig-grid { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="letterhead">
    <div class="brand-left">
      ${logoBlock}
      <div>
        <div class="company-name">${escapeHtml(brand.companyName)}</div>
        ${brand.tagline ? `<div class="company-tagline">${escapeHtml(brand.tagline)}</div>` : ''}
        ${brandContactLine(brand) ? `<div class="company-contact">${escapeHtml(brandContactLine(brand))}</div>` : ''}
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-badge">${escapeHtml(title)}</div>
      <div class="doc-meta-line">Date: ${dateStr}</div>
      <div class="doc-meta-line">Doc #: ${docNum}</div>
      ${brand.licenseNumber ? `<div class="doc-meta-line">Lic. ${escapeHtml(brand.licenseNumber)}</div>` : ''}
    </div>
  </div>
  <div class="accent-bar"></div>
  ${body}
  <div class="doc-footer">${escapeHtml(brandFooterLine(brand))}</div>
</body>
</html>`
}

export function buildEstimateHtml(data: any, brand: BrandKit): string {
  const currency = resolveCurrencyCode(data.currency)
  const m = (n: any) => fmtMoney(n, currency)
  return wrapHTML('Estimate / Proposal', `
    <div class="info-grid">
      <div class="info-block"><div class="info-label">Prepared For</div><div class="info-value">${escapeHtml(data.customerName ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Property Address</div><div class="info-value">${escapeHtml(data.address ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Phone</div><div class="info-value">${escapeHtml(data.phone ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Email</div><div class="info-value">${escapeHtml(data.email ?? 'N/A')}</div></div>
    </div>
    ${data.validUntil ? `<p style="font-size:11px;color:#64748b">Valid until <strong>${escapeHtml(data.validUntil)}</strong>${data.estimateNumber ? ` · Ref ${escapeHtml(data.estimateNumber)}` : ''} · ${escapeHtml(currency)}</p>` : `<p style="font-size:11px;color:#64748b">Currency: <strong>${escapeHtml(currency)}</strong></p>`}
    <h2>Scope of Work</h2>
    <p>${escapeHtml(data.scopeOfWork ?? 'To be determined during site inspection.')}</p>
    <h2>Line Items</h2>
    <table>
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
      <tbody>
      ${(data.lineItems ?? []).map((li: any, i: number) => `<tr><td>${i + 1}</td><td>${escapeHtml(li.description)}</td><td>${li.qty ?? 1}</td><td>${m(li.unitPrice)}</td><td>${m(li.lineTotal ?? (li.qty ?? 1) * (li.unitPrice ?? 0))}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="totals-box">
      <div class="row muted"><span>Subtotal</span><span>${m(data.subtotal ?? data.total)}</span></div>
      ${Number(data.taxRate) ? `<div class="row muted"><span>Tax (${escapeHtml(data.taxRate)}%)</span><span>${m(data.tax)}</span></div>` : ''}
      ${Number(data.discount) ? `<div class="row muted"><span>Discount</span><span>−${m(data.discount)}</span></div>` : ''}
      <div class="row grand"><span>Grand Total (${escapeHtml(currency)})</span><span>${m(data.total)}</span></div>
    </div>
    <h2>Notes & Conditions</h2>
    <div class="notes-box">${escapeHtml(data.notes ?? 'This estimate is valid for 30 days from the date above. Pricing may adjust after final site measurements.')}</div>
    <div class="sig-grid">
      <div class="sig-block"><strong>Authorized by</strong>${escapeHtml(brand.companyName)}<br>Date: _______________</div>
      <div class="sig-block"><strong>Accepted by</strong>Customer signature<br>Date: _______________</div>
    </div>
  `, brand, data.estimateNumber)
}

export function buildInspectionHtml(data: any, brand: BrandKit): string {
  return wrapHTML('Inspection Report', `
    <div class="info-grid">
      <div class="info-block"><div class="info-label">Property Address</div><div class="info-value">${escapeHtml(data.address ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Customer</div><div class="info-value">${escapeHtml(data.customerName ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Inspector</div><div class="info-value">${escapeHtml(data.inspector ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Date Inspected</div><div class="info-value">${escapeHtml(data.inspectionDate ?? new Date().toLocaleDateString())}</div></div>
    </div>
    <h2>Overall Condition</h2>
    <p><span class="badge badge-blue">${escapeHtml(data.overallCondition ?? 'Requires Assessment')}</span></p>
    <p style="margin-top:8px">${escapeHtml(data.summary ?? '')}</p>
    <h2>Findings</h2>
    <table>
      <thead><tr><th>Area</th><th>Condition</th><th>Severity</th><th>Notes</th></tr></thead>
      <tbody>
      ${(data.findings ?? []).map((f: any) => `<tr><td>${escapeHtml(f.area)}</td><td>${escapeHtml(f.condition)}</td><td><span class="badge ${f.severity === 'High' ? 'badge-amber' : 'badge-green'}">${escapeHtml(f.severity)}</span></td><td>${escapeHtml(f.notes ?? '')}</td></tr>`).join('')}
      </tbody>
    </table>
    <h2>Recommended Actions</h2>
    <div class="notes-box">${escapeHtml(data.recommendations ?? 'Full replacement recommended within 6 months.')}</div>
    <h2>Photos / Evidence</h2>
    <p>${escapeHtml(data.photos ?? 'Photos taken and available upon request.')}</p>
    <div class="sig-grid">
      <div class="sig-block"><strong>Inspected by</strong>${escapeHtml(data.inspector ?? brand.companyName)}<br>Date: _______________</div>
      <div class="sig-block"><strong>Reviewed by</strong>${escapeHtml(brand.companyName)}<br>Date: _______________</div>
    </div>
  `, brand)
}

export function buildSowHtml(data: any, brand: BrandKit): string {
  return wrapHTML('Statement of Work', `
    <div class="info-grid">
      <div class="info-block"><div class="info-label">Project</div><div class="info-value">${escapeHtml(data.projectTitle ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Customer</div><div class="info-value">${escapeHtml(data.customerName ?? 'N/A')}</div></div>
      <div class="info-block"><div class="info-label">Start Date</div><div class="info-value">${escapeHtml(data.startDate ?? 'TBD')}</div></div>
      <div class="info-block"><div class="info-label">Completion</div><div class="info-value">${escapeHtml(data.endDate ?? 'TBD')}</div></div>
    </div>
    <h2>Project Overview</h2>
    <p>${escapeHtml(data.overview ?? '')}</p>
    <h2>Deliverables</h2>
    <ul>${(data.deliverables ?? []).map((d: string) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
    <h2>Materials</h2>
    <table>
      <thead><tr><th>Material</th><th>Quantity</th><th>Supplier</th></tr></thead>
      <tbody>
      ${(data.materials ?? []).map((m: any) => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.quantity)} ${escapeHtml(m.unit ?? '')}</td><td>${escapeHtml(m.supplier ?? 'TBD')}</td></tr>`).join('')}
      </tbody>
    </table>
    <h2>Terms & Conditions</h2>
    <div class="notes-box">${escapeHtml(data.terms ?? 'Payment due upon project completion. Warranty: 1 year on workmanship.')}</div>
    <div class="sig-grid">
      <div class="sig-block"><strong>Authorized by</strong>${escapeHtml(brand.companyName)}<br>Date: _______________</div>
      <div class="sig-block"><strong>Accepted by</strong>Customer signature<br>Date: _______________</div>
    </div>
  `, brand)
}

export function buildInvoiceHtml(data: any, brand: BrandKit): string {
  const currency = resolveCurrencyCode(data.currency)
  const m = (n: any) => fmtMoney(n, currency)
  return wrapHTML('Invoice', `
    <div class="info-grid">
      <div class="info-block"><div class="info-label">Bill To</div><div class="info-value">${escapeHtml(data.customerName ?? 'N/A')}<br><span style="font-weight:400;color:#64748b">${escapeHtml(data.address ?? '')}</span></div></div>
      <div class="info-block"><div class="info-label">Invoice Details</div><div class="info-value">Due: ${escapeHtml(data.dueDate ?? '30 days')}<br>Status: <span class="badge badge-blue">${escapeHtml(data.status ?? 'Unpaid')}</span>${data.invoiceNumber ? `<br>Ref: ${escapeHtml(data.invoiceNumber)}` : ''}<br>Currency: ${escapeHtml(currency)}</div></div>
    </div>
    <h2>Services Rendered</h2>
    <table>
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>
      ${(data.lineItems ?? []).map((li: any, i: number) => `<tr><td>${i + 1}</td><td>${escapeHtml(li.description)}</td><td>${li.qty ?? 1}</td><td>${m(li.rate ?? li.unitPrice)}</td><td>${m(li.lineTotal ?? (li.qty ?? 1) * (li.rate ?? li.unitPrice ?? 0))}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="totals-box">
      <div class="row muted"><span>Subtotal</span><span>${m(data.subtotal ?? data.total)}</span></div>
      ${Number(data.taxRate) ? `<div class="row muted"><span>Tax (${escapeHtml(data.taxRate)}%)</span><span>${m(data.tax)}</span></div>` : ''}
      <div class="row grand"><span>Total Due (${escapeHtml(currency)})</span><span>${m(data.total)}</span></div>
    </div>
    <h2>Payment Instructions</h2>
    <div class="notes-box">${escapeHtml(data.paymentInstructions ?? `Please make payment via bank transfer or check. Include invoice number as reference.${brand.email ? ` Questions: ${brand.email}` : ''}`)}</div>
  `, brand, data.invoiceNumber)
}

export function buildSupplementHtml(data: any, brand: BrandKit): string {
  const company = brand.companyName
  const accent = brand.accentColor
  const currency = resolveCurrencyCode(data.currency)
  const m = (n: any) => fmtMoney(n, currency)
  const allItems = asArray(data.recommendedLineItems)
  const sectionOrder = [
    { key: 'underlayment', label: 'UNDERLAYMENT AND VALLEY / EAVE PROTECTION', keywords: ['iws', 'ice', 'felt', 'synthetic', 'underlayment', 'valley', 'eave'] },
    { key: 'flashing', label: 'FLASHING AND WATERPROOFING', keywords: ['step', 'flash', 'chim', 'counter', 'valley', 'pipe', 'jack', 'flwall'] },
    { key: 'ventilation', label: 'VENTILATION SYSTEM', keywords: ['vent', 'ridge', 'rdg', 'soffit', 'intake', 'turb', 'attic'] },
    { key: 'labor', label: 'ADDITIONAL LABOR AND SITE REQUIREMENTS', keywords: ['start', 'permit', 'dump', 'osha', 'siding', 'fascia', 'soffit', 'deck', 'osb', 'satellite', 'gutter', 'paint', 'light', 'holiday', 'height', 'op', 'overhead', 'misc'] },
  ]
  const assigned = new Set<number>()
  const sections = sectionOrder.map(sec => {
    const items = allItems.filter((item: any, idx: number) => {
      if (assigned.has(idx)) return false
      const combined = `${(item.xactimateCode ?? '') + (item.description ?? '') + (item.justification ?? '')}`.toLowerCase()
      if (sec.keywords.some(kw => combined.includes(kw))) {
        assigned.add(idx)
        return true
      }
      return false
    })
    return { ...sec, items }
  })
  const remaining = allItems.filter((_: any, idx: number) => !assigned.has(idx))
  if (remaining.length) sections.push({ key: 'other', label: 'ADDITIONAL ITEMS', keywords: [] as string[], items: remaining })

  let itemCounter = 0
  const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
  const narrativeSections = sections
    .filter(s => s.items.length > 0)
    .map((sec, sIdx) => `
      <div class="supp-section">
        <div class="supp-section-title">${romanNumerals[sIdx] ?? sIdx + 1}. ${sec.label}</div>
        ${sec.items
          .map((item: any) => {
            itemCounter++
            return `
          <div class="supp-item">
            <div class="supp-item-num">${itemCounter}. ${escapeHtml(item.description ?? item.item ?? 'Item')}</div>
            <p><span class="supp-field">• Item:</span> ${item.xactimateCode ? `Add <strong>${escapeHtml(item.xactimateCode)}</strong> — ` : ''}${escapeHtml(item.description ?? '')}</p>
            <p><span class="supp-field">• Justification:</span> ${escapeHtml(item.justification ?? 'Required for code-compliant, warrantable installation.')}</p>
            ${item.qty ? `<p><span class="supp-field">• Quantities (estimated):</span> ${escapeHtml(item.qty)} ${escapeHtml(item.unit ?? '')}${item.heightFactor && item.heightFactor !== '1.0x' ? ` — Height factor: ${escapeHtml(item.heightFactor)}` : ''} (to be verified by field measurements)</p>` : ''}
            ${item.photosRequired ? `<p><span class="supp-field">• Documentation required:</span> ${escapeHtml(item.photosRequired)}</p>` : ''}
          </div>`
          })
          .join('')}
      </div>`)
    .join('')

  const approvedScopeItems = asArray(data.approvedScope)
  const approvedScopeSection = approvedScopeItems.length
    ? `
      <div class="supp-section">
        <div class="supp-section-title">CARRIER APPROVED SCOPE</div>
        <table class="pricing-table">
          <tr><th>#</th><th>Description</th><th>Code</th><th>Qty</th><th>Unit</th><th>RCV Amount</th></tr>
          ${approvedScopeItems.map((item: any, idx: number) => `<tr><td>${idx + 1}</td><td>${escapeHtml(item.description ?? '')}</td><td>${escapeHtml(item.xactimateCode ?? '—')}</td><td>${escapeHtml(item.qty ?? '—')}</td><td>${escapeHtml(item.unit ?? '—')}</td><td>${item.amount ? `${m(item.amount)}` : '—'}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="5"><strong>Carrier Approved Total (RCV)</strong></td><td><strong>${m(data.carrierApprovedTotal)}</strong></td></tr>
        </table>
        <p style="font-size:11px;color:#64748b;margin-top:4px">O&amp;P Included: ${escapeHtml(data.opIncluded ?? 'Unknown')} &nbsp;|&nbsp; Depreciation Held: ${m(data.depreciationHeld)} &nbsp;|&nbsp; ACV Paid: ${m(data.acvPaid)}</p>
      </div>`
    : ''

  const missingItems = asArray(data.missingItems)
  const confidenceColor = (c: string) => c === 'High' ? '#15803d' : c === 'Low' ? '#b45309' : '#1d4ed8'
  const confidenceExplain = (c: string) => c === 'High' ? 'Supported by code, manufacturer spec, or both' : c === 'Medium' ? 'Requires field verification or local AHJ confirmation' : 'Insufficient evidence — inspection or documentation needed'
  const missingSection = missingItems.length
    ? `
      <div class="supp-section">
        <div class="supp-section-title">MISSING SCOPE — NOT IN CARRIER ESTIMATE</div>
        ${missingItems.map((item: any, idx: number) => `
          <div class="supp-item" style="border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:12px">
            <div class="supp-item-num" style="font-size:13px;font-weight:700;margin-bottom:6px">${idx + 1}. ${escapeHtml(item.description ?? '')} &nbsp;<span style="font-size:10px;font-weight:600;background:${confidenceColor(item.confidence ?? '')};color:#fff;padding:2px 7px;border-radius:10px">${escapeHtml(item.confidence ?? '—')}</span></div>
            <p><span class="supp-field">• Carrier included:</span> Not present in approved scope</p>
            <p><span class="supp-field">• Why required:</span> ${escapeHtml(item.reason ?? 'See code and manufacturer requirements')}</p>
            ${item.estimatedQty ? `<p><span class="supp-field">• Quantity:</span> ${escapeHtml(item.estimatedQty)}${/^\d/.test(String(item.estimatedQty).trim()) ? '' : ' <span style="color:#94a3b8;font-size:10px">(verify with field measurement)</span>'}</p>` : ''}
            ${item.xactimateCode ? `<p><span class="supp-field">• Xactimate code:</span> <strong>${escapeHtml(item.xactimateCode)}</strong></p>` : ''}
            <p><span class="supp-field">• Confidence basis:</span> <em style="color:${confidenceColor(item.confidence ?? '')}">${confidenceExplain(item.confidence ?? '')}</em></p>
          </div>`).join('')}
      </div>`
    : `<div class="supp-section"><div class="supp-section-title">MISSING SCOPE</div><p>No missing items identified — approved scope appears complete.</p></div>`

  const underpaidItems = asArray(data.underpaidItems)
  const underpaidSection = underpaidItems.length
    ? `
      <div class="supp-section">
        <div class="supp-section-title">UNDERPAID / UNDER-SCOPED ITEMS — SIDE-BY-SIDE COMPARISON</div>
        <table class="pricing-table" style="margin-bottom:0">
          <tr>
            <th style="width:22%">Item</th>
            <th style="width:22%;background:#64748b">Carrier Scope</th>
            <th style="width:22%;background:#1d4ed8">Required Scope</th>
            <th style="width:16%;background:#15803d">Gap</th>
            <th style="width:18%">Reason / Code Basis</th>
          </tr>
          ${underpaidItems.map((item: any) => {
            const gap = Number(item.gap ?? Number(item.recommendedAmount ?? 0) - Number(item.approvedAmount ?? 0))
            return `<tr>
              <td><strong>${escapeHtml(item.xactimateCode ?? '—')}</strong><br><span style="font-size:10px">${escapeHtml(item.description ?? '')}</span></td>
              <td style="background:#fafafa">${escapeHtml(item.approvedQty ?? '—')}<br><span style="color:#64748b">${m(item.approvedAmount)}</span></td>
              <td style="background:#eff6ff">${escapeHtml(item.recommendedQty ?? '—')}<br><span style="color:#1d4ed8">${m(item.recommendedAmount)}</span></td>
              <td style="background:#f0fdf4;font-weight:700;color:#15803d">+ ${m(gap)}</td>
              <td style="font-size:10px">${escapeHtml(item.reason ?? '')}</td>
            </tr>`
          }).join('')}
          <tr class="total-row">
            <td colspan="3"><strong>Total Underpaid Gap</strong></td>
            <td><strong>${m(underpaidItems.reduce((s: number, i: any) => s + Number(i.gap ?? Number(i.recommendedAmount ?? 0) - Number(i.approvedAmount ?? 0)), 0))}</strong></td>
            <td></td>
          </tr>
        </table>
      </div>`
    : `<div class="supp-section"><div class="supp-section-title">UNDERPAID / UNDER-SCOPED ITEMS</div><p>No underpaid items identified with a positive dollar gap — pricing appears consistent with the approved scope, or gaps require field verification before inclusion.</p></div>`

  const actionPlanSteps = asArray(data.actionPlan)
  const actionPlanSection = actionPlanSteps.length
    ? `
      <div class="supp-section">
        <div class="supp-section-title">CONTRACTOR ACTION PLAN</div>
        ${actionPlanSteps.map((step: string, idx: number) => `<p style="margin:4px 0"><strong>${idx + 1}.</strong> ${escapeHtml(step)}</p>`).join('')}
      </div>`
    : ''

  const scoreNum = Number(data.opportunityScore ?? 0)
  const scoreColor = scoreNum >= 80 ? '#dc2626' : scoreNum >= 60 ? '#ea580c' : scoreNum >= 40 ? '#2563eb' : scoreNum >= 20 ? '#15803d' : '#64748b'
  const scoreSection = `
      <div class="supp-section" style="border:2px solid ${scoreColor};border-radius:8px;padding:16px;margin-top:24px">
        <div class="supp-section-title" style="color:${scoreColor};border-color:${scoreColor}">SUPPLEMENT OPPORTUNITY SCORE</div>
        <p style="font-size:28px;font-weight:700;color:${scoreColor};margin:8px 0 4px">${scoreNum}/100 &nbsp;<span style="font-size:14px;font-weight:600">${escapeHtml(data.opportunityScoreLabel ?? '')}</span></p>
        ${data.opportunityScoreBreakdown ? `<p style="font-size:11px;color:#64748b;margin-top:4px">${escapeHtml(data.opportunityScoreBreakdown)}</p>` : ''}
        <p style="font-size:12px;margin-top:8px">
          <strong>Confidence Level:</strong> ${escapeHtml(data.confidenceLevel ?? '—')} &nbsp;|&nbsp;
          <strong>O&amp;P Applicable:</strong> ${escapeHtml(data.opApplicable ?? '—')} &nbsp;|&nbsp;
          <strong>Reinspection Recommended:</strong> ${escapeHtml(data.reinspectionRecommended ?? '—')}
        </p>
      </div>`

  const revisedRcv = Number(data.revisedRcvTotal ?? Number(data.carrierApprovedTotal ?? 0) + Number(data.supplementTotal ?? 0))
  const contactEmail = data.contractorEmail || brand.email || `support@${company.toLowerCase().replace(/\s+/g, '')}.co`
  const logoBlock = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" style="max-height:44px;max-width:140px;object-fit:contain;margin-bottom:6px;display:block" />`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Source+Serif+4:wght@600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', 'Segoe UI', Arial, sans-serif; color: #0f172a; background: #fff; font-size: 12.5px; line-height: 1.7; padding: 28px 36px; }
    .letterhead { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${accent}; padding-bottom: 16px; margin-bottom: 24px; }
    .company-name { font-family: 'Source Serif 4', Georgia, serif; font-size: 20px; font-weight: 700; color: ${accent}; letter-spacing: 0.02em; }
    .company-contact { font-size: 10.5px; color: #64748b; margin-top: 4px; }
    .doc-type { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
    .doc-date { font-size: 12px; color: #64748b; text-align: right; }
    .to-block { margin: 20px 0 8px; }
    .to-block p { margin: 2px 0; }
    .to-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .claim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #cbd5e1; margin: 20px 0; page-break-inside: avoid; }
    .claim-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; padding: 6px 12px; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; }
    .claim-value { font-size: 12px; padding: 6px 12px; border-bottom: 1px solid #cbd5e1; }
    .intent-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ${accent}; text-align: center; margin: 28px 0 16px; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; padding: 10px 0; }
    .opening-para { margin: 16px 0; text-align: justify; }
    .supp-section { margin: 24px 0 0; page-break-inside: avoid; }
    .supp-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: ${accent}; letter-spacing: 0.06em; border-bottom: 2px solid ${accent}; padding-bottom: 4px; margin-bottom: 14px; }
    .supp-item { margin: 0 0 18px 0; }
    .supp-item-num { font-weight: 700; font-size: 13px; margin-bottom: 4px; color: #0f172a; }
    .supp-field { font-weight: 600; color: ${accent}; }
    .supp-item p { margin: 3px 0 3px 16px; }
    .pricing-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; page-break-inside: avoid; }
    .pricing-table th { background: ${accent}; color: #fff; padding: 7px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .pricing-table td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
    .pricing-table tr:nth-child(even) td { background: #f8fafc; }
    .pricing-table .total-row td { font-weight: 700; background: ${accent}12; border-top: 2px solid ${accent}; }
    .summary-table { width: 60%; margin: 12px 0 12px auto; border-collapse: collapse; font-size: 13px; page-break-inside: avoid; }
    .summary-table td { padding: 6px 12px; border-bottom: 1px solid #e2e8f0; }
    .summary-table .highlight { font-weight: 700; background: ${accent}12; }
    .summary-table .grand-total { font-weight: 700; font-size: 14px; background: ${accent}; color: #fff; }
    .closing { margin-top: 32px; padding-top: 20px; border-top: 1px solid #cbd5e1; text-align: justify; }
    .signature { margin-top: 32px; }
    .sig-line { border-top: 1px solid #0f172a; width: 260px; margin-top: 40px; padding-top: 4px; font-size: 11px; color: #475569; }
    .page-divider { margin: 32px 0; border: none; border-top: 1px dashed #cbd5e1; }
    h3 { font-size: 12px; font-weight: 700; color: ${accent}; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    p { margin: 6px 0; }
    .doc-footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>

  <div class="letterhead">
    <div>
      ${logoBlock}
      <div class="company-name">${escapeHtml(company).toUpperCase()}</div>
      <div class="doc-type">Carrier Estimate Audit — Notice of Supplement</div>
      ${brandContactLine(brand) ? `<div class="company-contact">${escapeHtml(brandContactLine(brand))}</div>` : ''}
    </div>
    <div class="doc-date">DATE: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      ${brand.licenseNumber ? `<br>Lic. ${escapeHtml(brand.licenseNumber)}` : ''}
    </div>
  </div>

  <div class="to-block">
    <div class="to-label">TO:</div>
    <p><strong>${escapeHtml(data.carrier ?? 'Insurance Carrier')}</strong></p>
    ${data.carrierAddress ? `<p>${escapeHtml(data.carrierAddress)}</p>` : ''}
    ${data.adjuster ? `<p><strong>ATTN:</strong> ${escapeHtml(data.adjuster)}${data.adjusterTitle ? ` (${escapeHtml(data.adjusterTitle)})` : ''}</p>` : ''}
    ${data.adjusterPhone ? `<p><strong>PHONE:</strong> ${escapeHtml(data.adjusterPhone)}</p>` : ''}
    ${data.adjusterEmail ? `<p><strong>EMAIL:</strong> ${escapeHtml(data.adjusterEmail)}</p>` : ''}
  </div>

  <div class="claim-grid">
    <div class="claim-label">Claim No.</div>       <div class="claim-value">${escapeHtml(data.claimNumber ?? 'N/A')}</div>
    <div class="claim-label">Policy No.</div>      <div class="claim-value">${escapeHtml(data.policyNumber ?? 'N/A')}</div>
    <div class="claim-label">Insured</div>         <div class="claim-value">${escapeHtml(data.customerName ?? 'N/A')}</div>
    <div class="claim-label">Deductible</div>      <div class="claim-value">${data.deductible ? `${m(data.deductible)}` : 'N/A'}</div>
    <div class="claim-label">Loss Type</div>       <div class="claim-value">${escapeHtml(data.causeOfLoss ?? 'N/A')}</div>
    <div class="claim-label">Property Address</div><div class="claim-value">${escapeHtml(data.propertyAddress ?? data.address ?? 'N/A')}</div>
    <div class="claim-label">Date of Loss</div>    <div class="claim-value">${escapeHtml(data.dateOfLoss ?? 'N/A')}</div>
    <div class="claim-label">Stories / Height</div><div class="claim-value">${escapeHtml(data.storiesHeightFactor ?? '1-story')}</div>
  </div>

  <div class="intent-title">CARRIER ESTIMATE AUDIT — NOTICE OF SUPPLEMENT</div>

  <p class="opening-para">
    ${escapeHtml(company)} ("<strong>Contractor</strong>") has conducted a detailed audit of the carrier estimate issued by ${escapeHtml(data.carrier ?? 'the Carrier')}
    ${data.carrierEstimateDate ? `dated ${escapeHtml(data.carrierEstimateDate)}` : ''}.
    This audit identifies items that are missing from the approved scope or priced below the correct value.
    All findings are supported by applicable building code, manufacturer installation requirements, field measurements, or photographic evidence as noted.
  </p>
  <p class="opening-para">
    Each item below includes the specific code or requirement that mandates its inclusion, the source of that requirement,
    and the recommended Xactimate line item for inclusion in the revised estimate.
    Items marked <em>Field Verification Required</em> require on-site measurement or photo documentation before submission.
  </p>

  ${data.claimSummary ? `<p class="opening-para"><em>${escapeHtml(data.claimSummary)}</em></p>` : ''}

  ${approvedScopeSection}

  <hr class="page-divider">

  ${missingSection}

  ${underpaidSection}

  <hr class="page-divider">

  ${narrativeSections}

  ${actionPlanSection}

  <hr class="page-divider">

  <h3>Summary of Requested Adjustments — Priced Line Items</h3>
  <table class="pricing-table">
    <tr><th>Xactimate Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Ht. Factor</th><th>O&amp;P</th><th>RCV Amount</th></tr>
    ${allItems.map((item: any) => `<tr><td>${escapeHtml(item.xactimateCode ?? '—')}</td><td>${escapeHtml(item.description ?? '')}</td><td>${escapeHtml(item.qty ?? '—')}</td><td>${escapeHtml(item.unit ?? '—')}</td><td>${item.unitPrice ? `${m(item.unitPrice)}` : '—'}</td><td>${escapeHtml(item.heightFactor ?? '1.0x')}</td><td>${escapeHtml(item.opApplied ?? '—')}</td><td>${item.estimatedValue ? `${m(item.estimatedValue)}` : 'N/A'}</td></tr>`).join('')}
    <tr class="total-row"><td colspan="7"><strong>TOTAL SUPPLEMENT REQUEST</strong></td><td><strong>${m(data.supplementTotal)}</strong></td></tr>
  </table>

  <h3>Revised Payment Summary</h3>
  <table class="summary-table">
    <tr><td>Original Carrier Estimate (RCV)</td><td style="text-align:right">${m(data.carrierApprovedTotal)}</td></tr>
    <tr class="highlight"><td><strong>Requested Supplement Amount</strong></td><td style="text-align:right"><strong>+ ${m(data.supplementTotal)}</strong></td></tr>
    <tr class="highlight"><td><strong>Revised Total RCV</strong></td><td style="text-align:right"><strong>${m(revisedRcv)}</strong></td></tr>
    ${Number(data.depreciationHeld) > 0 ? `<tr><td>Less Depreciation Held</td><td style="text-align:right">− ${m(data.depreciationHeld)}</td></tr>` : ''}
    ${Number(data.depreciationHeld) > 0 ? `<tr><td>Revised ACV</td><td style="text-align:right">${m(data.revisedAcv ?? revisedRcv - Number(data.depreciationHeld ?? 0))}</td></tr>` : ''}
    ${(Number(data.acvPaid) > 0 && Number(data.deductible) > 0)
      ? `<tr><td>Less ACV Already Paid</td><td style="text-align:right">− ${m(data.acvPaid)}</td></tr>
         <tr><td>Less Deductible</td><td style="text-align:right">− ${m(data.deductible)}</td></tr>
         <tr class="grand-total"><td><strong>NET ADDITIONAL PAYMENT DUE</strong></td><td style="text-align:right"><strong>${m(data.netAdditionalPaymentDue)}</strong></td></tr>`
      : `<tr class="grand-total"><td><strong>TOTAL SUPPLEMENT REQUESTED</strong></td><td style="text-align:right"><strong>${m(data.supplementTotal)}</strong></td></tr>
         <tr><td colspan="2" style="font-size:10px;color:#94a3b8;padding-top:4px">Note: Net payment calculation requires confirmed ACV paid and deductible — verify with carrier and homeowner before finalizing.</td></tr>`}
  </table>

  ${asArray(data.documentationNeeded).length ? `
  <h3>Documentation Required</h3>
  ${asArray(data.documentationNeeded).map((item: string) => `<p>• ${escapeHtml(item)}</p>`).join('')}` : ''}

  ${scoreSection}

  <div class="closing">
    <p>
      Based on the findings of this audit, <strong>${escapeHtml(company)}</strong> respectfully requests that the Carrier issue a revised estimate
      incorporating the line items identified above. Each item is required for a code-compliant, manufacturer-warrantable installation
      and is supported by the evidence referenced in this document.
    </p>
    <p style="margin-top:10px">
      Please review the attached audit findings and provide a revised estimate, or contact our estimating department at
      <strong>${escapeHtml(contactEmail)}</strong> to discuss the identified discrepancies.
      Items marked <em>Field Verification Required</em> are available for joint re-inspection upon request.
    </p>
  </div>

  <div class="signature">
    <div class="sig-line">
      PREPARED BY: ${escapeHtml(data.preparedBy ?? company)}<br>
      On behalf of ${escapeHtml(company)}
    </div>
  </div>

  <div class="doc-footer">${escapeHtml(brandFooterLine(brand))}</div>

</body>
</html>`
}

export const BUILTIN_TEMPLATES: Record<string, (data: any, brand: BrandKit) => string> = {
  estimate: buildEstimateHtml,
  inspection: buildInspectionHtml,
  sow: buildSowHtml,
  invoice: buildInvoiceHtml,
  supplement: buildSupplementHtml,
}
