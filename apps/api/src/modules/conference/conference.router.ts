export type RoutingMethod = 'NAME' | 'CHAIR' | 'MODERATOR' | 'MANUAL' | 'SILENCE' | 'ROUNDTABLE'

export type RouteResult =
  | {
      action: 'SPEAK'
      /** One or more speakers — play in order */
      speakerIds: string[]
      /** @deprecated use speakerIds[0] */
      agentId: string
      method: RoutingMethod
      reason: string
    }
  | { action: 'SILENCE'; agentId: null; speakerIds: []; method: 'SILENCE'; reason: string }

export interface ConferenceParticipant {
  id: string
  name: string
  role: string
  aliases?: string[]
}

export const MAX_CONFERENCE_SPEAKERS = 5

const FILLER_RE =
  /^(uh+|um+|hmm+|hm+|mhm+|mm+|ah+|oh+|okay|ok|yeah|yep|yup|nah|nope|right|sure|thanks|thank you|got it|cool|nice|alright|all right)[.!?]*$/i

const GROUP_INTENT_RE =
  /\b(hello everyone|hi everyone|hey everyone|good morning (everyone|all|team)|good afternoon (everyone|all|team)|hi (all|team|folks)|hey (all|team|folks)|hello (all|team)|what does everyone think|what do (you )?all think|each of you|all of you|go around|round ?table|everyone (say|chime|introduce)|introduce yourselves)\b/i

/** Build default aliases from agent first name / full name. */
export function buildAliases(name: string, extra: string[] = []): string[] {
  const cleaned = name.split(/[—(]/)[0].trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const first = (parts[0] || cleaned).toLowerCase()
  const full = cleaned.toLowerCase()
  const set = new Set<string>([
    first,
    full,
    `hey ${first}`,
    `hi ${first}`,
    `ok ${first}`,
    `${first},`,
    ...extra.map((a) => a.toLowerCase()),
  ])
  return [...set].filter(Boolean)
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function speakResult(
  speakerIds: string[],
  method: RoutingMethod,
  reason: string,
): RouteResult {
  const unique = [...new Set(speakerIds)].slice(0, MAX_CONFERENCE_SPEAKERS)
  if (!unique.length) {
    return { action: 'SILENCE', agentId: null, speakerIds: [], method: 'SILENCE', reason }
  }
  return {
    action: 'SPEAK',
    speakerIds: unique,
    agentId: unique[0],
    method,
    reason,
  }
}

/**
 * Find all active participants addressed by name in the transcript.
 * Order = order of first mention in the text.
 */
export function matchAllAddressedParticipants(
  transcript: string,
  participants: ConferenceParticipant[],
): ConferenceParticipant[] {
  const text = normalize(transcript)
  if (!text) return []

  const hits: { p: ConferenceParticipant; index: number }[] = []

  for (const p of participants) {
    const aliases = (p.aliases?.length ? p.aliases : buildAliases(p.name))
      .map((a) => a.toLowerCase())
      .sort((a, b) => b.length - a.length)

    for (const alias of aliases) {
      const a = escapeRegExp(alias)
      const startRe = new RegExp(`(?:^|[.!?]\\s+)(?:hey |hi |ok |okay )?${a}\\b`, 'i')
      const vocativeRe = new RegExp(`(?:^|\\s)[@]?${a}\\s*[,:]`, 'i')
      const askRe = new RegExp(`\\b(?:ask |tell |hey |hi )?${a}\\b`, 'i')
      let idx = -1
      if (startRe.test(text)) idx = text.search(startRe)
      else if (vocativeRe.test(text)) idx = text.search(vocativeRe)
      else if (askRe.test(text)) idx = text.search(askRe)
      if (idx >= 0) {
        hits.push({ p, index: idx })
        break
      }
    }
  }

  hits.sort((a, b) => a.index - b.index)
  const seen = new Set<string>()
  const out: ConferenceParticipant[] = []
  for (const h of hits) {
    if (seen.has(h.p.id)) continue
    seen.add(h.p.id)
    out.push(h.p)
  }
  return out
}

/** @deprecated prefer matchAllAddressedParticipants */
export function matchAddressedParticipant(
  transcript: string,
  participants: ConferenceParticipant[],
): ConferenceParticipant | null {
  return matchAllAddressedParticipants(transcript, participants)[0] ?? null
}

export function isFillerUtterance(transcript: string): boolean {
  const t = normalize(transcript)
  if (!t) return true
  if (t.length <= 2) return true
  return FILLER_RE.test(t)
}

export function isGroupIntent(transcript: string): boolean {
  return GROUP_INTENT_RE.test(normalize(transcript))
}

/** Chair first, then remaining participants (stable order). */
export function orderWithChairFirst(
  participants: ConferenceParticipant[],
  chairAgentId: string,
  ids?: string[],
): string[] {
  const pool = ids?.length
    ? participants.filter((p) => ids.includes(p.id))
    : participants
  const chair = pool.find((p) => p.id === chairAgentId)
  const rest = pool.filter((p) => p.id !== chairAgentId)
  return [...(chair ? [chair.id] : []), ...rest.map((p) => p.id)].slice(
    0,
    MAX_CONFERENCE_SPEAKERS,
  )
}

/**
 * Deterministic routing (no AI): manual → name(s) → filler → group heuristic → null (needs AI/chair).
 */
export function routeConferenceTurnDeterministic(opts: {
  transcript: string
  participants: ConferenceParticipant[]
  chairAgentId: string
  manualAgentId?: string | null
}): RouteResult | null {
  const { transcript, participants, chairAgentId, manualAgentId } = opts

  if (manualAgentId) {
    const found = participants.find((p) => p.id === manualAgentId)
    if (found) {
      return speakResult([found.id], 'MANUAL', 'User selected participant')
    }
  }

  const addressed = matchAllAddressedParticipants(transcript, participants)
  if (addressed.length === 1) {
    return speakResult(
      [addressed[0].id],
      'NAME',
      `Addressed ${addressed[0].name}`,
    )
  }
  if (addressed.length > 1) {
    return speakResult(
      addressed.map((p) => p.id),
      'NAME',
      `Addressed ${addressed.map((p) => p.name.split(/[—(]/)[0].trim()).join(', ')}`,
    )
  }

  if (isFillerUtterance(transcript)) {
    return {
      action: 'SILENCE',
      agentId: null,
      speakerIds: [],
      method: 'SILENCE',
      reason: 'Filler / no actionable utterance',
    }
  }

  if (isGroupIntent(transcript)) {
    const ids = orderWithChairFirst(participants, chairAgentId)
    return speakResult(
      ids,
      'ROUNDTABLE',
      'Group greeting / roundtable intent — sequential replies',
    )
  }

  // Needs AI moderator or chair fallback
  return null
}

export function chairFallback(
  participants: ConferenceParticipant[],
  chairAgentId: string,
  reason = 'Chair fallback',
): RouteResult {
  const chair =
    participants.find((p) => p.id === chairAgentId) || participants[0]
  if (!chair) {
    return {
      action: 'SILENCE',
      agentId: null,
      speakerIds: [],
      method: 'SILENCE',
      reason: 'No participants in room',
    }
  }
  return speakResult([chair.id], 'CHAIR', `${reason} (${chair.name})`)
}

/**
 * Sync route used by self-tests: deterministic + chair (no AI).
 */
export function routeConferenceTurn(opts: {
  transcript: string
  participants: ConferenceParticipant[]
  chairAgentId: string
  manualAgentId?: string | null
}): RouteResult {
  return (
    routeConferenceTurnDeterministic(opts) ??
    chairFallback(opts.participants, opts.chairAgentId)
  )
}

/** Parse AI moderator JSON into a RouteResult (speakers filtered to participants). */
export function parseModeratorJson(
  raw: string,
  participants: ConferenceParticipant[],
  chairAgentId: string,
): RouteResult {
  const byId = new Map(participants.map((p) => [p.id, p]))
  const byName = new Map(
    participants.map((p) => [p.name.split(/[—(]/)[0].trim().toLowerCase(), p]),
  )

  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('no json')
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      action?: string
      speakers?: string[]
      speakerIds?: string[]
      confidence?: number
      reason?: string
    }

    const action = (parsed.action || 'SPEAK').toUpperCase()
    if (action === 'SILENCE') {
      return {
        action: 'SILENCE',
        agentId: null,
        speakerIds: [],
        method: 'SILENCE',
        reason: parsed.reason || 'Moderator chose silence',
      }
    }

    const rawList = parsed.speakers || parsed.speakerIds || []
    const resolved: string[] = []
    for (const token of rawList) {
      const t = String(token || '').trim()
      if (!t) continue
      if (byId.has(t)) {
        resolved.push(t)
        continue
      }
      const byN = byName.get(t.toLowerCase())
      if (byN) resolved.push(byN.id)
    }

    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0.7
    if (!resolved.length || confidence < 0.45) {
      return chairFallback(
        participants,
        chairAgentId,
        parsed.reason || 'Low moderator confidence',
      )
    }

    // Prefer chair first if multiple and chair is included
    let ordered = [...new Set(resolved)]
    if (ordered.length > 1 && ordered.includes(chairAgentId)) {
      ordered = [
        chairAgentId,
        ...ordered.filter((id) => id !== chairAgentId),
      ]
    }

    return speakResult(
      ordered,
      'MODERATOR',
      parsed.reason || 'AI moderator assignment',
    )
  } catch {
    return chairFallback(participants, chairAgentId, 'Moderator parse failed')
  }
}

export function buildModeratorPrompt(
  transcript: string,
  participants: ConferenceParticipant[],
  chairAgentId: string,
): string {
  const chair =
    participants.find((p) => p.id === chairAgentId)?.name || 'chair'
  const roster = participants
    .map(
      (p) =>
        `- id: ${p.id} | name: ${p.name.split(/[—(]/)[0].trim()} | role: ${p.role}`,
    )
    .join('\n')

  return `You are the conference floor router for an internal business meeting.
Pick WHO should reply to the owner's latest message. Return ONLY valid JSON.

Participants (only these ids are valid):
${roster}

Default chair: ${chair} (${chairAgentId})

Rules:
- speakers: array of 1..${MAX_CONFERENCE_SPEAKERS} participant ids (or names)
- Use MULTIPLE speakers only when the owner clearly addresses the group, wants several opinions, or the question spans multiple roles (e.g. greeting everyone, "what do you all think", progress + insurance).
- Use a SINGLE speaker when one specialist clearly owns the topic.
- Prefer fewer speakers. Cap at ${MAX_CONFERENCE_SPEAKERS}.
- Put the most relevant lead first; include chair first for group greetings when they are in the room.
- action "SILENCE" only for pure filler / noise (not for real questions).
- confidence 0..1. If unsure, pick only the chair id with lower confidence.

Owner message:
"""${transcript}"""

JSON schema:
{"action":"SPEAK"|"SILENCE","speakers":["agentId",...],"confidence":0.0,"reason":"short"}`
}
