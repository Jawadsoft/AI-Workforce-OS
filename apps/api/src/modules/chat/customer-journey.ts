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

export function industryRagExcludeCategories(_stage: CustomerStage, _latestUserMessage: string): string[] {
  // LLM decides what is relevant based on context — no hard exclusions
  return []
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildCustomerJourneyAddendum(_stage: CustomerStage): string {
  return `

CONVERSATION STYLE (public channel):
- Respond like a knowledgeable human sales rep — read the conversation and decide naturally what the customer needs next.
- One question at a time. Don't ask several questions at once.
- Only bring up pricing when the customer is ready or asks — not on the first message.
- When pricing comes up: use company brain figures if available, otherwise give a realistic industry range. Never invent a firm total before scoping the job.
- When they are ready to book: confirm name, address/area, preferred time, create a ticket.
- If they already have an ongoing booking or job: help with status or next step — don't restart the sales pitch.
- Use your own knowledge of the industry to guide what to ask and when.`
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
