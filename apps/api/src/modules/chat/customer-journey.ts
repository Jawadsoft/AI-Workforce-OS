/** Stage-aware customer sales journey (WhatsApp / sales roles). */

export type CustomerStage = 'GREET' | 'QUALIFY' | 'BALLPARK' | 'BOOK' | 'FULFILL'

const STAGE_ORDER: CustomerStage[] = ['GREET', 'QUALIFY', 'BALLPARK', 'BOOK', 'FULFILL']

const GREET_ONLY_RE =
  /^(hi|hello|hey|hiya|yo|sup|good\s*(morning|afternoon|evening)|salaam|salam|assalamu?\s*alaikum|howdy|what'?s\s*up)\b[\s!.?]*$/i

const QUALIFY_RE =
  /\b(address|postcode|zip|hail|storm|leak|damage|roof|bedroom|bathroom|kitchen|flat|house|office|weekly|fortnight|how often|insurance|end of tenancy|eot|handyman|repair|quote for)\b/i

const BALLPARK_RE =
  /\b(how much|price|cost|quote|estimate|ballpark|roughly|typical(ly)?|rate|charges?)\b/i

const BOOK_RE =
  /\b(book|booking|schedule|appointment|come out|site visit|inspection|when can you|available|this week|tomorrow)\b/i

const FULFILL_RE =
  /\b(invoice|job status|on the way|running late|reschedule|complaint|already booked|our cleaner|the team)\b/i

export function isCustomerFacingSales(
  agent: { role?: string | null; name?: string | null },
  channel?: string | null,
): boolean {
  const ch = (channel || '').toUpperCase()
  if (ch === 'CONFERENCE') return false
  if (ch === 'WHATSAPP' || ch === 'SMS' || ch === 'WIDGET' || ch === 'WEB') return true

  const role = (agent.role || '').toLowerCase()
  return (
    role.includes('sales') ||
    role.includes('intake') ||
    role.includes('handyman') ||
    role.includes('receptionist') ||
    role.includes('customer')
  )
}

export function inferCustomerStage(opts: {
  stored?: string | null
  latestUserMessage: string
  userTexts?: string[]
}): CustomerStage {
  const latest = (opts.latestUserMessage || '').trim()
  const stored = normalizeStage(opts.stored)
  const hinted = hintStageFromText(latest)

  if (!stored) {
    if (GREET_ONLY_RE.test(latest) || latest.length < 12) return 'GREET'
    return hinted ?? 'QUALIFY'
  }

  // Never jump backwards unless they clearly restart with a bare greeting
  // after we were already in a later stage — stay put (same customer thread).
  if (hinted && stageIndex(hinted) >= stageIndex(stored)) return hinted

  if (GREET_ONLY_RE.test(latest) && stored === 'GREET') return 'GREET'
  return stored
}

export function industryRagExcludeCategories(stage: CustomerStage, latestUserMessage: string): string[] {
  const text = (latestUserMessage || '').toLowerCase()
  const mentionedInsurance = /insur|claim|adjuster|supplement|xactimate/.test(text)

  if (stage === 'GREET') return ['INSURANCE', 'PROCESS', 'PRICING', 'PRODUCTS']
  if (stage === 'QUALIFY') return mentionedInsurance ? [] : ['INSURANCE']
  return []
}

export function buildCustomerJourneyAddendum(stage: CustomerStage): string {
  const stageLine = {
    GREET:
      'They just greeted you or started. Welcome them briefly. Ask ONE discovery question. Do NOT quote prices, insurance, supplements, chemicals, or process dumps.',
    QUALIFY:
      'You are qualifying. Ask ONE question at a time (what they need, property type/area, frequency or damage, then insurance only if storm/damage). Do not dump a full checklist.',
    BALLPARK:
      'They want a sense of price. Use the hybrid pricing rule. One range + what changes the price + offer to book a visit. No full line-item quote unless brain has exact package prices.',
    BOOK:
      'They are ready to book. Confirm name, address/area, preferred time, and create a ticket. Keep it short.',
    FULFILL:
      'They have an existing job or operational ask. Help with status, changes, or next step. Do not restart the sales pitch.',
  }[stage]

  return `

═══════════════════════════════════════
CUSTOMER JOURNEY (this thread)
═══════════════════════════════════════
Current stage: ${stage}
${stageLine}

FLOW (do not skip ahead unless they already asked):
1. GREET → warm hello, who you are, one question
2. QUALIFY → need, location, scope (one question at a time)
3. BALLPARK → typical range, not a firm written quote
4. BOOK → site visit / slot + ticket
5. FULFILL → after they are booked, just deliver

HYBRID PRICING:
• If COMPANY BRAIN has a price for this service — use that.
• Else give a typical range from industry knowledge (“typically £X–£Y” / “around $X–$Y”).
• Firm written quote only after a visit or confirmed scope — never invent an exact total.
• Never lead with insurance supplements, Xactimate, or COSHH on a first “hello”.`
}

function normalizeStage(raw?: string | null): CustomerStage | null {
  const v = (raw || '').trim().toUpperCase()
  return STAGE_ORDER.includes(v as CustomerStage) ? (v as CustomerStage) : null
}

function stageIndex(stage: CustomerStage): number {
  return STAGE_ORDER.indexOf(stage)
}

function hintStageFromText(text: string): CustomerStage | null {
  if (!text.trim()) return null
  if (FULFILL_RE.test(text)) return 'FULFILL'
  if (BOOK_RE.test(text)) return 'BOOK'
  if (BALLPARK_RE.test(text)) return 'BALLPARK'
  if (QUALIFY_RE.test(text)) return 'QUALIFY'
  if (GREET_ONLY_RE.test(text)) return 'GREET'
  return null
}
