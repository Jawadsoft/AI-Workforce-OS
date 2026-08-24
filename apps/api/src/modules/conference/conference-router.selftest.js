/**
 * Standalone self-test for conference routing (deterministic + roundtable).
 * Run: node apps/api/src/modules/conference/conference-router.selftest.js
 */

function buildAliases(name, extra = []) {
  const cleaned = name.split(/[—(]/)[0].trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  const first = (parts[0] || cleaned).toLowerCase()
  const full = cleaned.toLowerCase()
  return [...new Set([
    first, full, `hey ${first}`, `hi ${first}`, `ok ${first}`, `${first},`,
    ...extra.map((a) => a.toLowerCase()),
  ])].filter(Boolean)
}

const FILLER_RE =
  /^(uh+|um+|hmm+|hm+|mhm+|mm+|ah+|oh+|okay|ok|yeah|yep|yup|nah|nope|right|sure|thanks|thank you|got it|cool|nice|alright|all right)[.!?]*$/i
const GROUP_INTENT_RE =
  /\b(hello everyone|hi everyone|hey everyone|good morning (everyone|all|team)|hi (all|team|folks)|hey (all|team|folks)|hello (all|team)|what does everyone think|what do (you )?all think|each of you|all of you|go around|round ?table|everyone (say|chime|introduce)|introduce yourselves)\b/i
const MAX = 5

function normalize(text) {
  return text.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim()
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function speakResult(speakerIds, method, reason) {
  const unique = [...new Set(speakerIds)].slice(0, MAX)
  if (!unique.length) return { action: 'SILENCE', agentId: null, speakerIds: [], method: 'SILENCE', reason }
  return { action: 'SPEAK', speakerIds: unique, agentId: unique[0], method, reason }
}

function matchAll(transcript, participants) {
  const text = normalize(transcript)
  if (!text) return []
  const hits = []
  for (const p of participants) {
    const aliases = (p.aliases || buildAliases(p.name)).map((a) => a.toLowerCase()).sort((a, b) => b.length - a.length)
    for (const alias of aliases) {
      const a = escapeRegExp(alias)
      const startRe = new RegExp(`(?:^|[.!?]\\s+)(?:hey |hi |ok |okay )?${a}\\b`, 'i')
      const vocativeRe = new RegExp(`(?:^|\\s)[@]?${a}\\s*[,:]`, 'i')
      const askRe = new RegExp(`\\b(?:ask |tell |hey |hi )?${a}\\b`, 'i')
      let idx = -1
      if (startRe.test(text)) idx = text.search(startRe)
      else if (vocativeRe.test(text)) idx = text.search(vocativeRe)
      else if (askRe.test(text)) idx = text.search(askRe)
      if (idx >= 0) { hits.push({ p, index: idx }); break }
    }
  }
  hits.sort((a, b) => a.index - b.index)
  const seen = new Set()
  return hits.filter((h) => { if (seen.has(h.p.id)) return false; seen.add(h.p.id); return true }).map((h) => h.p)
}

function route({ transcript, participants, chairAgentId, manualAgentId }) {
  if (manualAgentId) {
    const found = participants.find((p) => p.id === manualAgentId)
    if (found) return speakResult([found.id], 'MANUAL', 'manual')
  }
  const addressed = matchAll(transcript, participants)
  if (addressed.length === 1) return speakResult([addressed[0].id], 'NAME', 'name')
  if (addressed.length > 1) return speakResult(addressed.map((p) => p.id), 'NAME', 'multi-name')

  const t = normalize(transcript)
  if (!t || t.length <= 2 || FILLER_RE.test(t)) {
    return { action: 'SILENCE', agentId: null, speakerIds: [], method: 'SILENCE', reason: 'filler' }
  }
  if (GROUP_INTENT_RE.test(t)) {
    const chair = participants.find((p) => p.id === chairAgentId)
    const rest = participants.filter((p) => p.id !== chairAgentId)
    const ids = [...(chair ? [chair.id] : []), ...rest.map((p) => p.id)].slice(0, MAX)
    return speakResult(ids, 'ROUNDTABLE', 'group')
  }
  const chair = participants.find((p) => p.id === chairAgentId) || participants[0]
  return speakResult([chair.id], 'CHAIR', 'chair')
}

const participants = [
  { id: 'will', name: 'Will', role: 'Sales', aliases: buildAliases('Will') },
  { id: 'charlie', name: 'Charlie', role: 'Lead Qual', aliases: buildAliases('Charlie') },
  { id: 'sarah', name: 'Sarah', role: 'Ops', aliases: buildAliases('Sarah') },
]
const chairAgentId = 'will'

const scenarios = [
  { name: 'Will, team size', input: { transcript: 'Will, what is our team size?', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'NAME', speakerCount: 1 } },
  { name: 'hey charlie', input: { transcript: 'hey charlie score this', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'charlie', method: 'NAME', speakerCount: 1 } },
  { name: 'Kevin and Sarah named (Sarah only in room)', input: { transcript: 'Will and Sarah update me', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'NAME', speakerCount: 2 } },
  { name: 'hello everyone → roundtable', input: { transcript: 'hello everyone', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'ROUNDTABLE', speakerCount: 3 } },
  { name: 'hi team → roundtable', input: { transcript: 'hi team', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'ROUNDTABLE', speakerCount: 3 } },
  { name: 'what do you all think', input: { transcript: 'what do you all think about pricing?', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'ROUNDTABLE', speakerCount: 3 } },
  { name: 'unnamed pricing → chair (AI would run in API)', input: { transcript: 'What is our pricing strategy?', participants, chairAgentId }, expect: { action: 'SPEAK', agentId: 'will', method: 'CHAIR', speakerCount: 1 } },
  { name: 'filler hmm', input: { transcript: 'hmm', participants, chairAgentId }, expect: { action: 'SILENCE', agentId: null, method: 'SILENCE', speakerCount: 0 } },
  { name: 'manual override', input: { transcript: 'Will, hi', participants, chairAgentId, manualAgentId: 'sarah' }, expect: { action: 'SPEAK', agentId: 'sarah', method: 'MANUAL', speakerCount: 1 } },
]

let passed = 0
let failed = 0
console.log('Conference router self-test (multi-speaker)\n' + '='.repeat(44))
for (const s of scenarios) {
  try {
    const r = route(s.input)
    if (r.action !== s.expect.action) throw new Error(`action ${r.action} != ${s.expect.action}`)
    if (r.agentId !== s.expect.agentId) throw new Error(`agentId ${r.agentId} != ${s.expect.agentId}`)
    if (r.method !== s.expect.method) throw new Error(`method ${r.method} != ${s.expect.method}`)
    const count = r.speakerIds?.length ?? 0
    if (count !== s.expect.speakerCount) throw new Error(`speakerCount ${count} != ${s.expect.speakerCount}`)
    passed++
    console.log(`PASS  ${s.name}`)
    console.log(`      → ${r.method} speakers=[${(r.speakerIds || []).join(',')}]`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${s.name}: ${err.message}`)
  }
}
console.log('='.repeat(44))
console.log(`Result: ${passed} passed, ${failed} failed, ${scenarios.length} total`)
process.exit(failed ? 1 : 0)
