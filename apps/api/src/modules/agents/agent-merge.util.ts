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

export function firstName(agentName: string): string {
  return agentName.split(/[—(]/)[0].trim().split(/\s+/)[0] || agentName
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

export function buildMergedPrompt(primary: MergeableAgent, secondary?: MergeableAgent | null): string {
  const primaryBlock = (primary.prompt || '').trim()
  if (!secondary?.prompt?.trim()) {
    return primaryBlock
  }

  const secName = firstName(secondary.name)
  const secRole = secondary.role

  return `${primaryBlock}

═══════════════════════════════════════
ADDITIONAL SCOPE (merged from ${secondary.name})
═══════════════════════════════════════
You are ONE agent for the customer — never say you are transferring them to ${secName} or another teammate.

You handle BOTH your primary role above AND the following responsibilities (from ${secRole}):

${secondary.prompt.trim()}

COMBINED ROLE RULES:
• Match the customer's ask: use the right section above (primary vs merged scope).
• If the job spans both areas, treat it as one conversation and one booking — do not split the customer across agents.
• One question at a time; short, human replies (especially on WhatsApp).
• Log the correct job type in CRM when creating tickets.`
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
