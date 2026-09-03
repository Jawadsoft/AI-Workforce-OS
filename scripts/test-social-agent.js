/**
 * Social Agent End-to-End Scenario Test
 *
 * Tests the full pipeline:
 *  1. Post generation with branded layers (customLayout:true + DEFAULT_POS)
 *  2. get_recent_posts — agent finds last post without asking for ID
 *  3. brand_existing_post — add branding/logo to an existing post
 *  4. get_post_layers — agent reads layer data
 *  5. update_post_layers — agent edits text and re-renders
 *  6. rerender_post — re-composite without AI regeneration
 *  7. REST API layer endpoints (GET/PATCH /social/posts/:id/layers)
 *
 * Run: node scripts/test-social-agent.js
 * Requires the API server on localhost:3001.
 */

require('./load-env')
const http = require('http')

const API_HOST = 'localhost'
const API_PORT = 3001
const LOGIN_EMAIL = process.env.TEST_EMAIL  || 'jawadsyed501@gmail.com'
const LOGIN_PASS  = process.env.TEST_PASS   || 'StormBuddy@2026'
const SOCIAL_AGENT_NAME = /syed|social.*media|marketing/i

// ── Minimal HTTP helpers ────────────────────────────────────────────────────

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const opts = {
      hostname: API_HOST, port: API_PORT,
      path: `/api/v1${path}`, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }
    const req = http.request(opts, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, body: raw }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

/**
 * Send a chat message via SSE stream and return:
 *   { text, steps, actionCards }
 * Steps are the tool-use labels emitted during the response.
 */
function chat(conversationId, content, token, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(content)
    const opts = {
      hostname: API_HOST, port: API_PORT,
      path: `/api/v1/chat/${conversationId}/stream?content=${encoded}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    }
    let text = '', steps = [], actionCards = []
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve({ text, steps, actionCards }) }
    }, timeoutMs)

    const req = http.request(opts, res => {
      if (res.statusCode >= 400) {
        clearTimeout(timer)
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.on('data', chunk => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const p = JSON.parse(line.slice(6))
            if (p.token) text += p.token
            if (p.step?.label) steps.push({ label: p.step.label, status: p.step.status })
            if (p.action_card) actionCards.push(p.action_card)
            if (p.done && !resolved) {
              resolved = true
              clearTimeout(timer)
              resolve({ text, steps, actionCards })
            }
            if (p.error) { clearTimeout(timer); reject(new Error(p.error)) }
          } catch { /* partial chunk */ }
        }
      })
      res.on('end', () => { if (!resolved) { resolved = true; clearTimeout(timer); resolve({ text, steps, actionCards }) } })
      res.on('error', e => { clearTimeout(timer); reject(e) })
    })
    req.on('error', e => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

// ── Assertion helpers ───────────────────────────────────────────────────────

const PASS  = '\x1b[32m✔\x1b[0m'
const FAIL  = '\x1b[31m✘\x1b[0m'
const INFO  = '\x1b[36mℹ\x1b[0m'
const WARN  = '\x1b[33m⚠\x1b[0m'
const BOLD  = '\x1b[1m'
const RESET = '\x1b[0m'

let passed = 0, failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`    ${PASS} ${label}`)
    passed++
  } else {
    console.log(`    ${FAIL} ${label}${detail ? ' — ' + detail : ''}`)
    failed++
  }
  return condition
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function stepUsed(steps, keyword) {
  return steps.some(s => s.label?.toLowerCase().includes(keyword.toLowerCase()))
}

function extractPostId(text) {
  // Matches cuid-like IDs: `cmXXXX` or id: cmXXXX
  const m = text.match(/(?:id[:\s`]+)(cm[a-z0-9]{20,})/i)
    || text.match(/\b(cm[a-z0-9]{20,})\b/)
  return m ? m[1] : null
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════╗`)
  console.log(`║        Social Agent End-to-End Scenario Test         ║`)
  console.log(`╚══════════════════════════════════════════════════════╝${RESET}\n`)

  // ── 1. Login ───────────────────────────────────────────────────────────────
  console.log(`${BOLD}1. Authentication${RESET}`)
  const loginRes = await request('POST', '/auth/login', { email: LOGIN_EMAIL, password: LOGIN_PASS })
  if (loginRes.status !== 200 || !loginRes.body?.access_token) {
    console.log(`  ${FAIL} Login failed (${loginRes.status}): ${JSON.stringify(loginRes.body)}`)
    process.exit(1)
  }
  const token    = loginRes.body.access_token
  const tenantId = loginRes.body.user?.tenantId
  console.log(`  ${PASS} Logged in — tenant: ${tenantId}\n`)

  // ── 2. Find Syed / social media agent ─────────────────────────────────────
  console.log(`${BOLD}2. Finding social media agent${RESET}`)
  const agentsRes = await request('GET', '/agents', null, token)
  const agents = agentsRes.body ?? []
  const socialAgent = agents.find(a => SOCIAL_AGENT_NAME.test(a.name + ' ' + a.role))
    ?? agents.find(a => (a.tools ?? []).includes('post_to_social'))
  if (!socialAgent) {
    console.log(`  ${FAIL} No social media agent found — ensure post_to_social tool is assigned`)
    process.exit(1)
  }
  console.log(`  ${PASS} Agent: ${socialAgent.name} (${socialAgent.role}) — id: ${socialAgent.id}\n`)

  // ── 3. Create a conversation ───────────────────────────────────────────────
  console.log(`${BOLD}3. Creating conversation${RESET}`)
  const convRes = await request('POST', '/chat', { agentId: socialAgent.id, channel: 'INTERNAL' }, token)
  if ((convRes.status !== 200 && convRes.status !== 201) || !convRes.body) {
    console.log(`  ${FAIL} Failed to create conversation: ${JSON.stringify(convRes.body)}`)
    process.exit(1)
  }
  const convId = convRes.body?.id ?? convRes.body?.conversation?.id
  console.log(`  ${PASS} Conversation: ${convId}\n`)

  let lastPostId = null

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO A — Generate a branded post and verify layers are stored
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`${BOLD}══ Scenario A: Generate branded post with AI image ══${RESET}`)
  console.log(`  ${INFO} Asking: "Generate a Facebook post about our storm damage roof repair service"`)

  const replyA = await chat(convId,
    'Generate a Facebook post about our storm damage roof repair service. Use a branded image.',
    token
  )

  console.log(`  ${INFO} Steps used: ${replyA.steps.map(s => s.label).join(', ') || '(none)'}`)
  console.log(`  ${INFO} Reply (${replyA.text.length} chars): "${replyA.text.slice(0, 160).replace(/\n/g,' ')}..."`)

  check('Agent called post_to_social',
    stepUsed(replyA.steps, 'social post') || stepUsed(replyA.steps, 'generating') || stepUsed(replyA.steps, 'post'),
    `steps: ${replyA.steps.map(s=>s.label).join(', ')}`
  )
  check('Response contains a post ID',
    /cm[a-z0-9]{20,}/i.test(replyA.text) || replyA.actionCards.length > 0,
    'no cuid-like ID found in text'
  )

  // Extract post ID from action card or text
  const cardA = replyA.actionCards.find(c => c.type === 'social_post')
  lastPostId = cardA?.id ?? extractPostId(replyA.text)
  console.log(`  ${INFO} Post ID: ${lastPostId ?? '(not found)'}`)
  check('Got a usable post ID', !!lastPostId)

  if (lastPostId) {
    // Verify layers were stored
    await sleep(1500)
    const layersRes = await request('GET', `/social/posts/${lastPostId}/layers`, null, token)
    console.log(`  ${INFO} GET /social/posts/${lastPostId}/layers → ${layersRes.status}`)
    const layers = layersRes.body

    check('Layers endpoint returns 200', layersRes.status === 200, `got ${layersRes.status}`)
    check('Layers version is 1', layers?.version === 1, JSON.stringify(layers?.version))
    check('customLayout is true', layers?.customLayout === true, 'post was generated without customLayout flag')
    check('Logo layer exists', typeof layers?.logo === 'object')
    check('Headline layer has text', typeof layers?.headline?.text === 'string' && layers.headline.text.length > 0)
    check('Headline has pos (DEFAULT_POS set)', typeof layers?.headline?.pos === 'object' && layers.headline.pos.x != null,
      JSON.stringify(layers?.headline?.pos))
    check('Bullets array present', Array.isArray(layers?.bullets) && layers.bullets.length > 0)
    check('CTA has pos', typeof layers?.cta?.pos === 'object', JSON.stringify(layers?.cta?.pos))
    check('backgroundUrl is a URL', typeof layers?.backgroundUrl === 'string' && layers.backgroundUrl.startsWith('http'))
  }

  console.log()

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO B — Ask agent to find & brand "the last post" (no ID given)
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`${BOLD}══ Scenario B: Agent finds last post without being given an ID ══${RESET}`)
  console.log(`  ${INFO} Asking: "Add the StormBuddy logo to my last post"`)

  // Use a fresh conversation so there's no post ID in context
  const convResB = await request('POST', '/chat', { agentId: socialAgent.id, channel: 'INTERNAL' }, token)
  const convIdB = convResB.body?.id ?? convResB.body?.conversation?.id

  const replyB = await chat(convIdB,
    'Add the StormBuddy logo to my last post',
    token
  )

  console.log(`  ${INFO} Steps: ${replyB.steps.map(s => s.label).join(', ') || '(none)'}`)
  console.log(`  ${INFO} Reply: "${replyB.text.slice(0, 200).replace(/\n/g,' ')}..."`)

  const askedForId = /provide.*id|post id|which post|can you (share|give)|don't have access|cannot access|i need the|please (share|provide|send)/i.test(replyB.text)

  check('Agent did NOT ask user for post ID',   !askedForId,  'agent asked for ID instead of calling get_recent_posts')
  check('Agent did NOT claim it can\'t access', !/can't (access|directly access|find)|unable to access/i.test(replyB.text))
  // Agent may use get_recent_posts (→ 'recent posts'), brand_existing_post (→ 'brand' / 'Applying branded'),
  // or regenerate_social_image (→ 'Regenerating') — all are valid as long as it didn't ask the user
  check('Agent used a social tool to act on the post',
    stepUsed(replyB.steps, 'recent') || stepUsed(replyB.steps, 'brand') || stepUsed(replyB.steps, 'branding')
      || stepUsed(replyB.steps, 'logo') || stepUsed(replyB.steps, 'regenerat') || stepUsed(replyB.steps, 'post image'),
    `steps: ${replyB.steps.map(s=>s.label).join(', ')}`
  )

  console.log()

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO C — Edit layers via chat (get_post_layers + update_post_layers)
  // ══════════════════════════════════════════════════════════════════════════
  if (lastPostId) {
    console.log(`${BOLD}══ Scenario C: Edit layers via chat (change headline) ══${RESET}`)
    const convResC = await request('POST', '/chat', { agentId: socialAgent.id, channel: 'INTERNAL' }, token)
    const convIdC = convResC.body?.id ?? convResC.body?.conversation?.id

    console.log(`  ${INFO} Asking: "Change the headline on post ${lastPostId} to 'Storm Damage Experts'"`)
    const replyC = await chat(convIdC,
      `Change the headline on post ${lastPostId} to "Storm Damage Experts"`,
      token
    )

    console.log(`  ${INFO} Steps: ${replyC.steps.map(s => s.label).join(', ') || '(none)'}`)
    console.log(`  ${INFO} Reply: "${replyC.text.slice(0, 200).replace(/\n/g,' ')}..."`)

    check('Agent called get_post_layers or update_post_layers',
      stepUsed(replyC.steps, 'post design') || stepUsed(replyC.steps, 'layer') || stepUsed(replyC.steps, 'design'),
      `steps: ${replyC.steps.map(s=>s.label).join(', ')}`
    )
    check('Agent did not suggest Canva',
      !/canva|lightroom|photoshop|third.party|design tool/i.test(replyC.text)
    )

    // Verify headline actually changed in DB
    await sleep(2000)
    const layersC = await request('GET', `/social/posts/${lastPostId}/layers`, null, token)
    const headlineText = layersC.body?.headline?.text ?? ''
    console.log(`  ${INFO} Headline in DB now: "${headlineText}"`)
    check('Headline updated in DB', /storm damage experts/i.test(headlineText), `got: "${headlineText}"`)

    console.log()

    // ════════════════════════════════════════════════════════════════════════
    // SCENARIO D — Re-render without new AI image (rerender_post)
    // ════════════════════════════════════════════════════════════════════════
    console.log(`${BOLD}══ Scenario D: Re-render existing layers (no AI regeneration) ══${RESET}`)
    const convResD = await request('POST', '/chat', { agentId: socialAgent.id, channel: 'INTERNAL' }, token)
    const convIdD = convResD.body?.id ?? convResD.body?.conversation?.id

    console.log(`  ${INFO} Asking: "Re-render post ${lastPostId} — apply changes without generating a new AI image"`)
    const replyD = await chat(convIdD,
      `Re-render post ${lastPostId} — apply the current layers and re-composite the image. Do NOT generate a new AI background, just re-render.`,
      token
    )
    console.log(`  ${INFO} Steps: ${replyD.steps.map(s => s.label).join(', ') || '(none)'}`)
    console.log(`  ${INFO} Reply: "${replyD.text.slice(0, 200).replace(/\n/g,' ')}..."`)

    // Accept rerender_post OR update_post_layers (empty patch) — both re-composite without AI
    check('Agent called rerender or update_post_layers (no new AI image)',
      stepUsed(replyD.steps, 're-render') || stepUsed(replyD.steps, 'rerender') || stepUsed(replyD.steps, 're render')
        || stepUsed(replyD.steps, 'post design') || stepUsed(replyD.steps, 'updating post'),
      `steps: ${replyD.steps.map(s=>s.label).join(', ')}`
    )
    check('Agent response says no new AI image generated',
      /re.render|existing layer|no.*new.*image|not.*generat|current layer|keep.*background/i.test(replyD.text)
        || replyD.actionCards.some(c => c.type === 'social_post')
    )

    console.log()
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO E — REST API: PATCH layers directly and verify image URL changes
  // ══════════════════════════════════════════════════════════════════════════
  if (lastPostId) {
    console.log(`${BOLD}══ Scenario E: REST API layer endpoints ══${RESET}`)

    // GET current layers
    const getRes = await request('GET', `/social/posts/${lastPostId}/layers`, null, token)
    check('GET /social/posts/:id/layers returns 200', getRes.status === 200, `got ${getRes.status}`)

    if (getRes.status === 200 && getRes.body?.version) {
      const oldImageUrl = (await request('GET', `/social/posts/${lastPostId}`, null, token)).body?.imageUrl ?? ''

      // PATCH — change accent colour (fast, cheap re-render)
      const patchRes = await request('PATCH', `/social/posts/${lastPostId}/layers`, {
        ...getRes.body,
        accentColor: '#e53e3e',
      }, token)
      console.log(`  ${INFO} PATCH /layers → ${patchRes.status}`)

      check('PATCH /social/posts/:id/layers returns 200', patchRes.status === 200, `got ${patchRes.status}: ${JSON.stringify(patchRes.body).slice(0,120)}`)
      check('PATCH response has imageUrl', typeof patchRes.body?.imageUrl === 'string' && patchRes.body.imageUrl.startsWith('http'))
      check('PATCH response has layers', patchRes.body?.layers?.version === 1)
      check('accentColor updated', patchRes.body?.layers?.accentColor === '#e53e3e',
        `got: ${patchRes.body?.layers?.accentColor}`)
      check('New image URL generated (re-rendered)',
        typeof patchRes.body?.imageUrl === 'string' && patchRes.body.imageUrl !== oldImageUrl,
        'imageUrl unchanged — may have failed silently'
      )
    }

    console.log()
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO F — Init layers on a clean (no-layer) post
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`${BOLD}══ Scenario F: Init layers on post without layer data ══${RESET}`)

  // Find or create a post without layers
  const allPosts = await request('GET', '/social/posts?limit=20', null, token)
  const noLayerPost = (allPosts.body ?? []).find(p =>
    p.imageUrl && (!p.layers || !p.layers?.version)
  )

  if (!noLayerPost) {
    console.log(`  ${WARN} No post without layers found — skipping init-layers test`)
  } else {
    console.log(`  ${INFO} Using post without layers: ${noLayerPost.id}`)
    const initRes = await request('POST', `/social/posts/${noLayerPost.id}/init-layers`, null, token)
    console.log(`  ${INFO} POST /init-layers → ${initRes.status}`)
    check('POST /social/posts/:id/init-layers returns 200 or 201', initRes.status === 200 || initRes.status === 201, `got ${initRes.status}: ${JSON.stringify(initRes.body).slice(0,120)}`)
    check('init-layers response has imageUrl', typeof initRes.body?.imageUrl === 'string')
    check('init-layers response has layers', initRes.body?.layers?.version === 1)
    check('init-layers sets customLayout:true', initRes.body?.layers?.customLayout === true)
    check('init-layers sets headline pos', initRes.body?.layers?.headline?.pos?.x != null)
  }

  console.log()

  // ══════════════════════════════════════════════════════════════════════════
  // SCENARIO G — Agent never suggests Canva (hallucination check)
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`${BOLD}══ Scenario G: Hallucination guard — no Canva suggestions ══${RESET}`)
  const convResG = await request('POST', '/chat', { agentId: socialAgent.id, channel: 'INTERNAL' }, token)
  const convIdG = convResG.body?.id ?? convResG.body?.conversation?.id

  console.log(`  ${INFO} Asking: "The image quality is bad, generate a better one for my last post"`)
  const replyG = await chat(convIdG,
    'The image quality is bad, generate a better one for my last post',
    token
  )
  console.log(`  ${INFO} Steps: ${replyG.steps.map(s => s.label).join(', ') || '(none)'}`)
  console.log(`  ${INFO} Reply: "${replyG.text.slice(0, 200).replace(/\n/g,' ')}..."`)

  check('Agent did NOT suggest Canva / Lightroom / Unsplash',
    !/canva|lightroom|photoshop|unsplash|picsart|adobe|third.party|design tool/i.test(replyG.text)
  )
  check('Agent called a social tool (not a text answer)',
    replyG.steps.length > 0,
    'no tool calls detected — agent gave a text-only reply'
  )

  console.log()

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed
  const colour = failed === 0 ? '\x1b[32m' : '\x1b[31m'
  console.log(`${BOLD}══════════════════════ Results ══════════════════════${RESET}`)
  console.log(`  ${colour}${BOLD}${passed}/${total} checks passed${RESET}  (${failed} failed)`)
  if (failed > 0) {
    console.log(`\n  ${WARN} Some checks failed — review the output above for details.`)
    console.log(`  Common causes:`)
    console.log(`    • API server not running (node scripts/test-social-agent.js requires localhost:3001)`)
    console.log(`    • social_image_editor feature flag not enabled for this tenant`)
    console.log(`    • Puppeteer/Chrome not installed on this machine (layer re-render will fail)`)
    console.log(`    • Post generation timed out (OpenAI slow — try again)`)
  } else {
    console.log(`\n  ${PASS} All checks passed! Social agent is working as designed.`)
  }
  console.log()
}

main().catch(err => {
  console.error('\x1b[31mUnhandled error:\x1b[0m', err.message)
  process.exit(1)
})
