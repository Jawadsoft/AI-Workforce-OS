/**
 * Clean PDF/OCR extraction artifacts that break downstream LLM + PDF generation.
 * Handles null bytes, soft hyphens, and common PDF ligature / control-char damage
 * (e.g. "Tear o\u0000" from "Tear off").
 */
export function cleanExtractedText(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)

  // Strip NULs and other C0 controls except tab/newline/CR
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')

  // Soft hyphen / zero-width / BOM junk
  s = s.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '')

  // Common PDF ligature codepoints → ASCII
  s = s
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st')

  // Replacement char left when a ligature glyph was dropped
  s = s.replace(/\uFFFD/g, '')

  // If a letter was dropped next to "o" from "off" / "of" ligature corruption
  s = s.replace(/\b([Tt]ear)\s+o\b/g, '$1 off')
  s = s.replace(/\b([Hh]aul)\s+o\b/g, '$1 off')
  s = s.replace(/\b([Tt]ake)\s+o\b/g, '$1 off')
  s = s.replace(/\bo\s*,\s*haul/gi, 'off, haul')
  s = s.replace(/\bo\s+haul/gi, 'off haul')
  s = s.replace(/\bTear\s+o(?=[^a-zA-Z]|$)/g, 'Tear off')

  // Collapse weird spacing from extraction
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')

  return s.trim()
}

/** True if a string is an empty / placeholder value we should not print. */
export function isPlaceholderValue(value: any): boolean {
  if (value === null || value === undefined) return true
  const s = String(value).trim().toLowerCase()
  if (!s) return true
  return (
    s === 'n/a' ||
    s === 'na' ||
    s === 'none' ||
    s === '—' ||
    s === '-' ||
    s === 'null' ||
    s === 'undefined' ||
    s === 'tbd' ||
    s === 'unknown' ||
    /^verify with field/.test(s) ||
    s === 'field verification required' ||
    s === 'field verification'
  )
}

/** Map common roofing line descriptions to typical Xactimate-style codes when the model left them blank. */
export function inferXactimateCode(description: string): string {
  const d = (description || '').toLowerCase()
  if (!d) return ''
  if (/\bo\s*&\s*p\b|overhead\s*(and|&)\s*profit|10%\s*\/\s*10%/.test(d)) return 'O&P'
  if (/permit/.test(d)) return 'JOB PERMIT'
  if (/tear\s*o|tear\s*off|haul.*dispose|remove.*shingle/.test(d)) return 'RFG TEAR'
  if (/ice\s*&?\s*water|iws|ice and water/.test(d)) return 'RFG IWS'
  if (/felt|underlayment/.test(d) && !/ice/.test(d)) return 'RFG FELT'
  if (/starter/.test(d)) return 'RFG STRT'
  if (/ridge\s*cap|hip\s*\/?\s*ridge|hip cap/.test(d)) return 'RFG RGCAP'
  if (/drip\s*edge/.test(d)) return 'RFG DRIP'
  if (/step\s*flash/.test(d)) return 'RFG STEP'
  if (/pipe\s*jack|boot/.test(d)) return 'RFG PIPE'
  if (/turbine|roof\s*vent|static\s*vent|ridge\s*vent/.test(d)) return 'RFG VENT'
  if (/flue\s*cap/.test(d)) return 'RFG FLUE'
  if (/chimney\s*flash/.test(d)) return 'RFG CHIM'
  if (/chimney\s*chase|chase\s*cover/.test(d)) return 'RFG CHASE'
  if (/gutter|downspout/.test(d)) return 'GTTR'
  if (/fascia/.test(d)) return 'FASC'
  if (/dumpster|debris/.test(d)) return 'DMO DUMP'
  if (/3\s*tab|comp\.?\s*shingle|composition\s*shingle|laminated/.test(d)) return 'RFG SHING'
  if (/steep\s*roof|high\s*roof/.test(d)) return 'RFG PREM'
  return ''
}

function normalizeKey(description: string): string {
  return (description || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(r\s*&?\s*r|remove|install|replace|additional charge for)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Canonical concept tags so "Permit Fee" matches "Taxes, insurance, permits & fees (Bid Item)". */
export function conceptTags(text: string): string[] {
  const d = (text || '').toLowerCase()
  const tags: string[] = []
  if (/permit|bid item|taxes.{0,20}insurance.{0,20}fee/.test(d)) tags.push('permit')
  if (/\bo\s*&\s*p\b|overhead\s*(and|&)\s*profit|10%\s*\/\s*10%/.test(d)) tags.push('op')
  if (/ice\s*&?\s*water|iws|ice and water/.test(d)) tags.push('iws')
  if (/starter/.test(d)) tags.push('starter')
  if (/drip\s*edge/.test(d)) tags.push('drip')
  if (/ridge\s*cap|hip\s*\/?\s*ridge/.test(d)) tags.push('ridge')
  if (/step\s*flash/.test(d)) tags.push('step')
  if (/pipe\s*jack|boot/.test(d)) tags.push('pipe')
  if (/felt|underlayment/.test(d) && !/ice/.test(d)) tags.push('felt')
  if (/tear\s*o|haul.*dispose/.test(d)) tags.push('tearoff')
  if (/gutter|downspout/.test(d)) tags.push('gutter')
  return tags
}

export function itemMatchesApproved(item: any, approved: any[]): { match: any | null } {
  const haystack = `${item?.description ?? ''} ${item?.xactimateCode ?? ''}`
  const key = normalizeKey(item?.description ?? '')
  const tags = conceptTags(haystack)
  for (const a of asArray(approved)) {
    const aHay = `${a?.description ?? ''} ${a?.xactimateCode ?? ''}`
    const ak = normalizeKey(a?.description ?? '')
    const aTags = conceptTags(aHay)
    if (tags.length && tags.some((t) => aTags.includes(t))) return { match: a }
    if (key && ak && (ak.includes(key) || key.includes(ak))) return { match: a }
    if (key && ak) {
      const tokens = key.split(' ').filter((t) => t.length >= 3)
      const hits = tokens.filter((t) => ak.includes(t))
      if (hits.length >= Math.min(2, tokens.length) && hits.length >= 2) return { match: a }
    }
  }
  return { match: null }
}

/** Drop "missing" items that already appear in approved scope (false positives). */
export function filterFalseMissingItems(missing: any[], approved: any[]): any[] {
  return asArray(missing).filter((item) => !itemMatchesApproved(item, approved).match)
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : value ? [value] : []
}

function parseFirstMoney(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const n = parseFloat(m[1].replace(/,/g, ''))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return undefined
}

/** Pull claim financials from generate_document prompt / analysis text when the JSON omitted them. */
export function extractClaimFinancialsFromText(text: string): {
  deductible?: number
  priorPayments?: number
  recoverableDepreciation?: number
  netClaimRemaining?: number
  depreciationHeld?: number
  acvPaid?: number
  carrierApprovedTotal?: number
} {
  const t = text || ''
  return {
    deductible: parseFirstMoney(t, [
      /less\s+deductible[^$\d]{0,30}\(?\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
      /dwelling\s+deductible[^$\d]{0,30}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
      /(?:^|\n)\s*deductible[:\s]+\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
      /coverage[^\n]{0,40}deductible[\s\S]{0,80}dwelling\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    priorPayments: parseFirstMoney(t, [
      /prior\s+payments?[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
      /less\s+prior\s+payment[^$\d]{0,20}\(?\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    recoverableDepreciation: parseFirstMoney(t, [
      /recoverable\s+depreciation[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    netClaimRemaining: parseFirstMoney(t, [
      /net\s+claim\s+remaining[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    depreciationHeld: parseFirstMoney(t, [
      /(?:depreciation\s+held|less\s+depreciation)[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    acvPaid: parseFirstMoney(t, [
      /(?:acv\s+paid|actual\s+cash\s+value)[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
    carrierApprovedTotal: parseFirstMoney(t, [
      /(?:carrier\s+approved\s+total|original\s+carrier\s+estimate|replacement\s+cost\s+value)[^$\d]{0,40}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    ]),
  }
}

function money(v: any): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Client rule 2+5: anything already in approved scope cannot stay MISSING.
 * Permit/bid-fee already allowed → UNDER-SCOPED (credit the existing $), not a duplicate missing line.
 * Priced supplement lines that duplicate approved scope are stripped unless a positive documented gap remains.
 */
export function applyDuplicateScopeGuard(data: Record<string, any>): Record<string, any> {
  const approved = asArray(data.approvedScope)
  const underScoped = asArray(data.underScopedItems)
  const missingKept: any[] = []

  for (const item of asArray(data.missingItems)) {
    const { match } = itemMatchesApproved(item, approved)
    if (!match) {
      missingKept.push(item)
      continue
    }
    const carrierAllowance = money(match.amount)
    underScoped.push({
      description: item.description,
      xactimateCode: item.xactimateCode || inferXactimateCode(item.description ?? ''),
      approvedQty: match.qty,
      approvedAmount: carrierAllowance,
      recommendedQty: item.estimatedQty,
      recommendedAmount: 0,
      gap: 0,
      reason: `Existing but potentially under-scoped. Carrier already allowed ${carrierAllowance ? `$${carrierAllowance.toFixed(2)}` : 'an amount'} for this concept. Supplement only the documented actual cost minus that allowance — do not request a duplicate full line.`,
    })
  }

  const pricedKept: any[] = []
  for (const item of asArray(data.recommendedLineItems)) {
    const { match } = itemMatchesApproved(item, approved)
    if (!match) {
      pricedKept.push(item)
      continue
    }
    const carrierAllowance = money(match.amount)
    const requested = money(item.estimatedValue)
    const tags = conceptTags(`${item.description} ${item.xactimateCode}`)
    // Permit: never invent a priced gap without a documented AHJ invoice — credit existing allowance only
    const gap = tags.includes('permit')
      ? 0
      : (requested > carrierAllowance && carrierAllowance > 0 ? Math.round((requested - carrierAllowance) * 100) / 100 : 0)
    underScoped.push({
      description: item.description,
      xactimateCode: item.xactimateCode,
      approvedQty: match.qty,
      approvedAmount: carrierAllowance,
      recommendedQty: item.qty,
      recommendedAmount: requested,
      gap,
      reason: gap > 0
        ? `Under-scoped: carrier allowed $${carrierAllowance.toFixed(2)}; requested $${requested.toFixed(2)}. Credit existing allowance.`
        : `Already in carrier estimate ($${carrierAllowance.toFixed(2)}). Field/AHJ verification required before adding more. Not billed as missing.`,
    })
    if (gap > 0) {
      pricedKept.push({
        ...item,
        description: `${item.description} (less existing allowance)`,
        estimatedValue: gap,
        justification: `${item.justification ?? ''} Credit carrier allowance of $${carrierAllowance.toFixed(2)}.`.trim(),
      })
    }
  }

  // Deduplicate under-scoped by concept tag
  const seen = new Set<string>()
  const underScopedUnique = underScoped.filter((row: any) => {
    const tag = conceptTags(`${row.description} ${row.xactimateCode}`).join('|') || normalizeKey(row.description ?? '')
    if (!tag || seen.has(tag)) return false
    seen.add(tag)
    return true
  })

  data.missingItems = missingKept
  data.recommendedLineItems = pricedKept
  data.underScopedItems = underScopedUnique

  // Merge under-scoped positive gaps into underpaid table when not already there
  const underpaid = asArray(data.underpaidItems)
  for (const row of underScopedUnique) {
    if (money(row.gap) <= 0) continue
    if (itemMatchesApproved(row, underpaid).match) continue
    underpaid.push({
      description: row.description,
      xactimateCode: row.xactimateCode,
      approvedQty: row.approvedQty,
      approvedAmount: row.approvedAmount,
      recommendedQty: row.recommendedQty,
      recommendedAmount: row.recommendedAmount,
      gap: row.gap,
      reason: row.reason,
    })
  }
  data.underpaidItems = underpaid
  return data
}

/** If the model omitted a permit/bid-fee line that is clearly in the source estimate, inject it so duplicate-guard can fire. */
export function hydrateKnownAllowancesFromText(data: Record<string, any>, sourceText: string): Record<string, any> {
  const approved = Array.isArray(data.approvedScope) ? [...data.approvedScope] : []
  const hasPermit = approved.some((a) => conceptTags(`${a?.description ?? ''} ${a?.xactimateCode ?? ''}`).includes('permit'))
  if (!hasPermit && /permit/i.test(sourceText || '')) {
    const amount =
      parseFirstMoney(sourceText, [
        /taxes,?\s*insurance,?\s*permits?\s*&?\s*fees[^\d]{0,120}([0-9][0-9,]*(?:\.\d{2})?)/i,
        /permits?\s*&?\s*fees\s*\(bid item\)[^\d]{0,80}([0-9][0-9,]*(?:\.\d{2})?)/i,
        /1\.00\s*EA[^\n]{0,40}(75\.00)[^\n]{0,80}permit/i,
      ]) || (/permit fee for roof/i.test(sourceText) && /75\.00/.test(sourceText) ? 75 : undefined)
    if (amount) {
      approved.push({
        description: 'Taxes, insurance, permits & fees (Bid Item) — Permit fee for roof repairs',
        xactimateCode: 'JOB PERMIT',
        qty: '1.00',
        unit: 'EA',
        amount,
      })
    }
  }
  data.approvedScope = approved
  return data
}

export function applyExtractedFinancials(data: Record<string, any>, sourceText: string): Record<string, any> {
  const extracted = extractClaimFinancialsFromText(sourceText)
  const fill = (key: string, value?: number) => {
    const current = money(data[key])
    if ((!current || isPlaceholderValue(data[key])) && value) data[key] = value
  }
  fill('deductible', extracted.deductible)
  fill('priorPayments', extracted.priorPayments)
  fill('recoverableDepreciation', extracted.recoverableDepreciation)
  fill('netClaimRemaining', extracted.netClaimRemaining)
  fill('depreciationHeld', extracted.depreciationHeld)
  fill('acvPaid', extracted.acvPaid)
  fill('carrierApprovedTotal', extracted.carrierApprovedTotal)
  return data
}

/** Soften absolute O&P "required" language unless trades were actually listed. */
export function softenOpLanguage(text: string, hasTradeAnalysis: boolean): string {
  if (!text) return text
  if (hasTradeAnalysis) {
    return text.replace(/xactimate guidelines require/gi, 'Xactimate guidelines support O&P when a GC coordinates multiple trades')
      .replace(/\brequired when GC\b/gi, 'potentially applicable when a GC')
  }
  return text
    .replace(/xactimate guidelines require[^.]*\.?/gi, 'Potential O&P opportunity — documentation required. Identify the actual trades in the carrier recap and explain why GC coordination may be reasonably necessary.')
    .replace(/\brequired when GC coordinates multiple trades\b/gi, 'may apply when a GC coordinates multiple trades — list those trades from the estimate')
}
