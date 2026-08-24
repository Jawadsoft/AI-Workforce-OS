/** Helpers to combine two tenant agents into one without editing presets. */

export interface MergeableAgent {
  id: string
  name: string
  role: string
  prompt: string
  tools: string[]
  permissions: string[]
  approvalRules?: Record<string, unknown> | null
  industry: string
  avatar?: string | null
  voiceId?: string | null
}

const TICKET_TOOLS = ['create_ticket', 'update_ticket', 'get_my_tickets']

const IDENTITY_PREFIX = /^(you are|you'?re|i am|i'?m|my name is)\b/i
const COMPANY_HEADER = /^(company context|company|brand)\s*:?\s*$/i
const SECTION_HEADER = /^[A-Z][A-Z0-9 /&().,+\-]{2,}:?\s*$/

export function firstName(agentName: string): string {
  return agentName.split(/[—(]/)[0].trim().split(/\s+/)[0] || agentName
}

function skillLabel(role?: string | null): string {
  const cleaned = (role || 'additional services')
    .split(/[—(]/)[0]
    .replace(/\b(coordinator|specialist|manager|executive|assistant|officer)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'additional services'
}

export function suggestMergedName(primary: MergeableAgent, secondary?: MergeableAgent | null): string {
  const a = firstName(primary.name)
  if (!secondary) return `${a} — Combined`
  const b = firstName(secondary.name)
  return `${a} + ${b}`
}

export function suggestMergedRole(primary: MergeableAgent, secondary?: MergeableAgent | null): string {
  if (!secondary) return primary.role
  const p = primary.role.split(/[—(]/)[0].trim()
  const s = secondary.role.split(/[—(]/)[0].trim()
  if (p.toLowerCase() === s.toLowerCase()) return p
  return `${p} & ${s}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function identityNames(agentName: string): string[] {
  const cleaned = agentName.split(/[—(]/)[0].trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const names = [cleaned, parts[0], parts.join(' ')].filter(Boolean)
  return [...new Set(names)]
}

function lineMentionsName(line: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(line))
}

/** Drop secondary company-identity blocks — primary already has company context. */
function stripCompanySections(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!skipping && COMPANY_HEADER.test(trimmed)) {
      skipping = true
      continue
    }
    if (skipping) {
      if (trimmed && SECTION_HEADER.test(trimmed) && !COMPANY_HEADER.test(trimmed)) {
        skipping = false
        out.push(line)
      }
      continue
    }
    out.push(line)
  }

  return out.join('\n')
}

/**
 * Turn a secondary agent prompt into extra skills only.
 * Removes "You are Jake…" and duplicate company context so identity stays the primary agent.
 */
export function extractAdditionalSkills(prompt: string, secondaryName: string): string {
  let text = (prompt || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''

  const names = identityNames(secondaryName)
  text = stripCompanySections(text)

  // Opening identity sentence only ("You are Jake, the Handyman…") — keep the rest of that line
  text = text.replace(
    /^(You are|You're|I am|I'm|My name is)\s+[A-Z][A-Za-z'’.\-]+[^.]*\.\s*/i,
    '',
  )

  const kept = text.split('\n').filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    if (IDENTITY_PREFIX.test(trimmed) && lineMentionsName(trimmed, names)) return false
    return true
  })
  text = kept.join('\n')

  for (const name of names) {
    const re = new RegExp(`\\b(you are|you'?re|i am|i'?m)\\s+${escapeRegExp(name)}\\b`, 'gi')
    text = text.replace(re, 'you')
  }

  text = text.replace(/\bYOU COORDINATE\b/g, '')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function buildMergedPrompt(primary: MergeableAgent, secondary?: MergeableAgent | null): string {
  const primaryBlock = (primary.prompt || '').trim()
  if (!secondary?.prompt?.trim()) {
    return primaryBlock
  }

  const primaryName = firstName(primary.name)
  const secRole = skillLabel(secondary.role)
  const skills = extractAdditionalSkills(secondary.prompt, secondary.name)

  // Build natural capability extension — reads as the primary agent's own abilities, not a bolted-on identity
  const capabilityLines = skills.trim()
    ? skills.trim()
    : `Handle ${secRole} enquiries: understand the scope, give a typical price range, and book.`

  return `${primaryBlock}

You also handle ${secRole} requests directly — this is part of your role, not a referral.
When a customer asks about ${secRole} work, qualify it, give a realistic price range, and book it yourself.
Do not name or refer to any other colleague for this — you own it end-to-end.

${capabilityLines}

UNIFIED ROLE RULES:
- One identity (${primaryName}), one conversation, one booking.
- Handle all service areas in your prompt yourself — never split the customer across agents.
- One question at a time; keep replies short and natural (especially on WhatsApp/SMS).
- Log the correct job type in CRM when creating a ticket.`
}

export function mergeTools(primary: MergeableAgent, secondary?: MergeableAgent | null): string[] {
  const set = new Set<string>([
    ...(primary.tools ?? []),
    ...(secondary?.tools ?? []),
    ...TICKET_TOOLS,
  ])
  return [...set]
}

export function mergePermissions(primary: MergeableAgent, secondary?: MergeableAgent | null): string[] {
  return [...new Set([...(primary.permissions ?? []), ...(secondary?.permissions ?? [])])]
}

export function mergeApprovalRules(
  primary: MergeableAgent,
  secondary: MergeableAgent | null | undefined,
  mergeMeta: Record<string, unknown>,
): Record<string, unknown> {
  const p = (primary.approvalRules as Record<string, unknown>) ?? {}
  const s = (secondary?.approvalRules as Record<string, unknown>) ?? {}
  const requireA = Array.isArray(p.requireApprovalFor) ? p.requireApprovalFor : []
  const requireB = Array.isArray(s.requireApprovalFor) ? s.requireApprovalFor : []
  return {
    ...p,
    ...s,
    requireApprovalFor: [...new Set([...requireA, ...requireB])],
    mergeSource: mergeMeta,
  }
}
