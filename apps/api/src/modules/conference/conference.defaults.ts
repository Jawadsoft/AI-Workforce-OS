/** Conference meeting types + default agendas agents must know about. */

export type ConferenceMeetingType =
  | 'MANAGEMENT'
  | 'SALES'
  | 'OPS'
  | 'CLAIMS'
  | 'GENERAL'

export const DEFAULT_MEETING_TYPE: ConferenceMeetingType = 'MANAGEMENT'

export const MEETING_TYPE_LABELS: Record<ConferenceMeetingType, string> = {
  MANAGEMENT: 'Management',
  SALES: 'Sales',
  OPS: 'Operations',
  CLAIMS: 'Claims / Insurance',
  GENERAL: 'General',
}

export const DEFAULT_AGENDAS: Record<ConferenceMeetingType, string> = {
  MANAGEMENT:
    'Internal management sync with ownership. Share brief status in your lane, answer the owner’s questions, surface blockers and priorities, and pass the floor to the right teammate when the topic is not yours.',
  SALES:
    'Sales pipeline sync with ownership. Cover leads, follow-ups, quotes, and conversion blockers. Pass to the right specialist when needed.',
  OPS:
    'Operations sync with ownership. Cover field work, inspections, scheduling, and delivery blockers. Pass to the right specialist when needed.',
  CLAIMS:
    'Claims and insurance sync with ownership. Cover supplements, carrier status, and documentation gaps. Pass to the right specialist when needed.',
  GENERAL:
    'Internal team conference with the owner. Stay on-topic, be concise, and pass the floor when another teammate is a better fit.',
}

export function normalizeMeetingType(raw?: string | null): ConferenceMeetingType {
  const t = (raw || '').trim().toUpperCase()
  if (t in DEFAULT_AGENDAS) return t as ConferenceMeetingType
  return DEFAULT_MEETING_TYPE
}

export function resolveAgenda(
  meetingType: ConferenceMeetingType,
  agenda?: string | null,
): string {
  const custom = (agenda || '').trim()
  if (custom) return custom
  return DEFAULT_AGENDAS[meetingType]
}

export function meetingTitle(
  meetingType: ConferenceMeetingType,
  customTitle?: string | null,
): string {
  if (customTitle?.trim()) return customTitle.trim()
  return `${MEETING_TYPE_LABELS[meetingType]} conference · ${new Date().toLocaleString()}`
}

/** Hidden pass-floor tag agents may append; stripped before TTS/UI. */
export const PASS_TAG_RE = /⟦\s*PASS\s*:\s*([^⟧]+)⟧/i

export function stripPassTag(text: string): { clean: string; passToName: string | null } {
  const m = text.match(PASS_TAG_RE)
  if (!m) return { clean: text.trim(), passToName: null }
  const passToName = m[1].trim().replace(/\s+/g, ' ')
  const clean = text.replace(PASS_TAG_RE, '').replace(/\s{2,}/g, ' ').trim()
  return { clean, passToName: passToName || null }
}

export function resolvePassTarget(
  passToName: string,
  participants: Array<{ id: string; name: string }>,
  excludeAgentId?: string,
): string | null {
  const needle = passToName.split(/[—(]/)[0].trim().toLowerCase()
  if (!needle) return null
  const hit = participants.find((p) => {
    if (excludeAgentId && p.id === excludeAgentId) return false
    const first = p.name.split(/[—(]/)[0].trim().toLowerCase()
    return first === needle || first.startsWith(needle) || needle.startsWith(first)
  })
  return hit?.id ?? null
}
