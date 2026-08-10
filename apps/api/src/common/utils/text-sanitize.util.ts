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

  // If a letter was dropped next to "o" from "off" / "of" ligature corruption
  s = s.replace(/\b([Tt]ear)\s+o(?=\s|,|\.|$)/g, '$1 off')
  s = s.replace(/\b([Hh]aul)\s+o(?=\s|,|\.|$)/g, '$1 off')
  s = s.replace(/\b([Tt]ake)\s+o(?=\s|,|\.|$)/g, '$1 off')
  s = s.replace(/\bo\s*,\s*haul/gi, 'off, haul')
  s = s.replace(/\bo\s+haul/gi, 'off haul')

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

/** Drop "missing" items that already appear in approved scope (false positives). */
export function filterFalseMissingItems(missing: any[], approved: any[]): any[] {
  const approvedKeys = asArray(approved).map((a) => normalizeKey(a?.description ?? ''))
  return asArray(missing).filter((item) => {
    const key = normalizeKey(item?.description ?? '')
    if (!key) return false
    // Exact / near containment against approved descriptions
    const alreadyApproved = approvedKeys.some((ak) => {
      if (!ak) return false
      if (ak.includes(key) || key.includes(ak)) return true
      // Shared distinctive tokens (ice water, starter, drip edge, etc.)
      const tokens = key.split(' ').filter((t) => t.length >= 3)
      const hits = tokens.filter((t) => ak.includes(t))
      return hits.length >= Math.min(2, tokens.length) && hits.length >= 2
    })
    return !alreadyApproved
  })
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : value ? [value] : []
}
