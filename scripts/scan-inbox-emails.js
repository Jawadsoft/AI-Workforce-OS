/**
 * scan-inbox-emails.js
 *
 * Connects to all three simulation mailboxes via IMAP and produces a quality
 * report for emails sent/received during test journeys.
 *
 * Checks for:
 *   ❌ Double greetings  ("Hi Name, Hi Name,")
 *   ❌ Blank / near-empty bodies  (< 15 words)
 *   ❌ Broken threading  ("Re:" subject but no In-Reply-To header)
 *   ⚠️  Generic phrases  ("My name is from", "Hi there", etc.)
 *   ⚠️  Stage-name subjects  (should be "Re: Free Roof Inspection")
 *   ⚠️  Duplicate emails  (same subject+recipient within 10 min)
 *
 * Usage:
 *   node scripts/scan-inbox-emails.js
 *   node scripts/scan-inbox-emails.js --days 3          # scan last 3 days (default: 1)
 *   node scripts/scan-inbox-emails.js --account olise   # one account only
 *   node scripts/scan-inbox-emails.js --verbose         # show email body preview
 */

'use strict'

// imapflow lives in the pnpm virtual store; resolve from the api package
const path = require('path')
const imapflowPath = require.resolve('imapflow', {
  paths: [
    path.join(__dirname, '..', 'apps', 'api'),
    path.join(__dirname, '..', 'node_modules', '.pnpm'),
    path.join(__dirname, '..'),
  ],
})
const { ImapFlow } = require(imapflowPath)

// ── Accounts ──────────────────────────────────────────────────────────────────
const ACCOUNTS = [
  {
    label:    'Customer (olise)',
    user:     'olise@mitiesoft.com',
    pass:     'olise786@',
    imapHost: 'imap.one.com',
    imapPort: 993,
  },
  {
    label:    'Carrier (paulp)',
    user:     'paulp@mitiesoft.com',
    pass:     'paulp786@',
    imapHost: 'imap.one.com',
    imapPort: 993,
  },
  {
    label:    'Contractor (StormBuddy)',
    user:     'info@stormbuddy.co',
    pass:     process.env.STORMBUDDY_IMAP_PASS || '',
    imapHost: process.env.STORMBUDDY_IMAP_HOST || 'imap.one.com',
    imapPort: 993,
  },
]

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv    = process.argv.slice(2)
const days    = argv.includes('--days')    ? +argv[argv.indexOf('--days') + 1]    : 1
const verbose = argv.includes('--verbose')
const only    = argv.includes('--account') ?  argv[argv.indexOf('--account') + 1] : null
const since   = new Date(Date.now() - days * 86400000)

// ── Raw IMAP header/body parser (no external deps) ───────────────────────────

/** Decode quoted-printable transfer encoding */
function decodeQP(str) {
  return str
    .replace(/=\r?\n/g, '')                          // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Decode base64 transfer encoding (best-effort UTF-8) */
function decodeB64(str) {
  try { return Buffer.from(str.replace(/\s+/g, ''), 'base64').toString('utf8') }
  catch { return str }
}

/** Extract readable text from a raw email buffer (handles multipart MIME) */
function parseRaw(rawBuffer) {
  const raw  = rawBuffer.toString('binary') // keep raw bytes
  const sep  = raw.indexOf('\r\n\r\n')
  const hdrs = sep > -1 ? raw.slice(0, sep)  : raw
  const body = sep > -1 ? raw.slice(sep + 4) : ''

  // Unfold all header lines first (MIME folding: CRLF followed by WSP is a continuation)
  const unfolded = hdrs.replace(/\r\n([ \t])/g, ' ')

  function hdr(name) {
    const re = new RegExp(`^${name}:[\\t ]*(.+)`, 'im')
    const m  = unfolded.match(re)
    return m ? m[1].trim() : ''
  }

  // Find all text/plain or text/html parts by splitting on MIME boundaries
  const contentType = hdr('Content-Type') || ''
  const boundaryM   = contentType.match(/boundary=["']?([^"';\r\n]+)/i)
  const boundary    = boundaryM ? boundaryM[1].trim() : null

  let plainText = ''

  if (boundary) {
    // Split multipart body on boundary lines
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`))
    for (const part of parts) {
      const pSep  = part.indexOf('\r\n\r\n')
      if (pSep < 0) continue
      const pHdrs = part.slice(0, pSep)
      const pBody = part.slice(pSep + 4)
      const pCT   = (pHdrs.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1] || ''
      const pTE   = (pHdrs.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i) || [])[1]?.toLowerCase().trim() || ''

      if (/text\/plain/i.test(pCT)) {
        plainText = pTE === 'quoted-printable' ? decodeQP(pBody)
                  : pTE === 'base64'           ? decodeB64(pBody)
                  : pBody
        break // prefer text/plain
      }
      if (!plainText && /text\/html/i.test(pCT)) {
        const decoded = pTE === 'quoted-printable' ? decodeQP(pBody)
                      : pTE === 'base64'           ? decodeB64(pBody)
                      : pBody
        plainText = decoded
      }
    }
  } else {
    // Single-part body
    const te = hdr('Content-Transfer-Encoding').toLowerCase()
    plainText = te === 'quoted-printable' ? decodeQP(body)
              : te === 'base64'           ? decodeB64(body)
              : body
  }

  // Strip HTML tags and clean up whitespace
  const plain = plainText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

  // Decode encoded subject (e.g. =?UTF-8?Q?...?=)
  function decodeWords(str) {
    return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, charset, enc, data) => {
      try {
        const buf = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : Buffer.from(decodeQP(data.replace(/_/g, ' ')))
        return buf.toString('utf8')
      } catch { return data }
    })
  }

  return {
    messageId:  hdr('Message-ID'),
    inReplyTo:  hdr('In-Reply-To'),
    references: hdr('References'),
    from:       decodeWords(hdr('From')),
    to:         decodeWords(hdr('To')),
    subject:    decodeWords(hdr('Subject')),
    date:       hdr('Date'),
    plain,
  }
}

// ── IMAP fetch ────────────────────────────────────────────────────────────────
async function fetchFolder(client, folderPath) {
  const emails = []
  try {
    const lock = await client.getMailboxLock(folderPath)
    try {
      for await (const msg of client.fetch({ since }, { uid: true, source: true })) {
        if (!msg.source) continue
        const parsed = parseRaw(msg.source)
        parsed.folder = folderPath
        emails.push(parsed)
      }
    } finally {
      lock.release()
    }
  } catch (e) {
    // folder may not exist or be inaccessible — skip silently
  }
  return emails
}

async function fetchAccount(account) {
  const client = new ImapFlow({
    host: account.imapHost, port: account.imapPort, secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000, greetingTimeout: 5000, socketTimeout: 15000,
  })
  client.on('error', () => {})

  const allEmails = []
  try {
    await client.connect()

    const mailboxes = await client.list()

    // Collect Inbox + Sent folders
    const targets = ['INBOX']
    for (const m of mailboxes) {
      if (
        m.flags.has('\\Sent') ||
        /^(Sent|Sent Items|Sent Messages|\[Gmail\]\/Sent Mail)$/i.test(m.path)
      ) {
        targets.push(m.path)
      }
    }

    for (const folder of targets) {
      const emails = await fetchFolder(client, folder)
      allEmails.push(...emails)
    }

    await client.logout()
  } catch (err) {
    console.error(`  ❌ IMAP failed for ${account.user}: ${err.message}`)
  }
  return allEmails
}

// ── Quality checks ────────────────────────────────────────────────────────────
/** Extract Job/Lead reference tag from subject, e.g. "[Job #201]" → "201" */
function extractJobRef(subject) {
  const m = subject.match(/\[(?:Job|Lead)\s*#?(\S+)\]/i)
  return m ? m[1] : null
}

const GENERIC_PHRASES = [
  { text: 'my name is from',           msg: 'Incomplete sentence: "My name is from TenantName" (agent name missing)' },
  { text: 'hi there',                  msg: 'Generic greeting "Hi there" — customer name not used' },
  { text: 'i am following up on your roofing project with', msg: 'Generic follow-up phrase — no stage-specific content' },
  { text: 'we wanted to keep you informed on the progress and check if you have any questions', msg: 'Boilerplate filler text — adds no value' },
  { text: 'please reply to this email or call us',          msg: 'Generic CTA repeated across every email' },
]

const STAGE_SUBJECTS = [
  'sales consultation', 'inspection scheduling', 'field inspection',
  'storm verification', 'insurance analysis', 'estimate & scope',
  'proposal presentation', 'contract signing', 'project update',
  'quality control', 'customer walkthrough', 'payment collection',
]

function wordCount(text) { return text.split(/\s+/).filter(Boolean).length }

function runChecks(email) {
  const issues = []
  const plain  = (email.plain || '').toLowerCase()
  const subj   = (email.subject || '').toLowerCase()

  // 1. Double greeting (handles multi-word names like "Hi DIAJEF LLC INT, Hi DIAJEF LLC INT")
  if (/hi\s+[^,\n]{1,40},\s*hi\s+/i.test(plain)) {
    issues.push({ sev: 'error', msg: 'Double greeting: "Hi Name, Hi Name," — wrapper + message both added greeting' })
  }

  // 2. Blank / near-empty
  const wc = wordCount(email.plain || '')
  if (wc < 10) {
    issues.push({ sev: 'error', msg: `Near-empty body (${wc} words) — email likely sent blank` })
  } else if (wc < 35) {
    issues.push({ sev: 'warn', msg: `Short body (${wc} words) — may be missing context` })
  }

  // 3. Broken thread
  if (subj.startsWith('re:') && !email.inReplyTo) {
    issues.push({ sev: 'error', msg: 'Subject starts with "Re:" but no In-Reply-To header — thread will break in email client' })
  }

  // 4. Generic phrases
  for (const { text, msg } of GENERIC_PHRASES) {
    if (plain.includes(text)) {
      issues.push({ sev: 'warn', msg: `Generic phrase: ${msg}` })
    }
  }

  // 5. Stage name used as subject
  for (const st of STAGE_SUBJECTS) {
    if (subj.includes(st)) {
      issues.push({ sev: 'warn', msg: `Subject uses stage name "${st}" — should be "Re: Free Roof Inspection — Company"` })
    }
  }

  return issues
}

// ── Report ────────────────────────────────────────────────────────────────────
const SV = { error: '🔴', warn: '🟡', ok: '🟢' }

async function scanAccount(account) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`📬  ${account.label.toUpperCase()}  ·  ${account.user}`)
  console.log('═'.repeat(70))

  const emails = await fetchAccount(account)

  if (!emails.length) {
    console.log(`   (no emails in last ${days} day(s) — check credentials or IMAP host)`)
    return { total: 0, issues: 0 }
  }

  console.log(`   ${emails.length} email(s) found since ${since.toLocaleDateString()}\n`)

  // Duplicate detection: normalise subject (strip Re:/Fwd: prefix + job tag) so
  // "Free Roof Inspection [Job #201]" and "Re: Free Roof Inspection [Job #201]"
  // are treated as the same thread, not duplicates.
  const normSubj = (s) => (s||'').toLowerCase()
    .replace(/^(re:\s*|fwd:\s*)+/i, '')
    .replace(/\[(?:job|lead)\s*#?\S+\]/gi, '')
    .trim()
  const dupMap = {}
  for (const e of emails) {
    const k = `${normSubj(e.subject)}||${(e.to||'').toLowerCase()}`
    ;(dupMap[k] = dupMap[k] || []).push(new Date(e.date).getTime())
  }

  let totalIssues = 0

  for (const email of emails) {
    const issues = runChecks(email)

    // Duplicate check (use same normalised key)
    const k       = `${normSubj(email.subject)}||${(email.to||'').toLowerCase()}`
    const times   = dupMap[k] || []
    if (times.length > 1) {
      const sorted = times.slice().sort((a, b) => a - b)
      const span   = Math.round((sorted[sorted.length - 1] - sorted[0]) / 60000)
      if (span < 10) {
        issues.push({ sev: 'error', msg: `Duplicate: this subject+recipient appears ${times.length}× within ${span} min` })
      }
    }

    const topSev  = issues.some(i => i.sev === 'error') ? 'error' : issues.length ? 'warn' : 'ok'
    const dateStr = email.date ? new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?'
    const folder  = (email.folder || '').padEnd(12)
    const subj    = (email.subject || '(no subject)').slice(0, 55).padEnd(55)
    const from    = (email.from || '').slice(0, 30)
    const to      = (email.to  || '').slice(0, 30)
    const jobRef  = extractJobRef(email.subject || '')

    console.log(`  ${SV[topSev]} [${dateStr}] [${folder}] ${subj}${jobRef ? ` ← Job #${jobRef}` : ''}`)
    console.log(`       From: ${from}`)
    console.log(`       To:   ${to}`)
    if (email.inReplyTo) console.log(`       Thread: ${email.inReplyTo.slice(0, 60)}`)

    for (const iss of issues) {
      console.log(`       ${SV[iss.sev]} ${iss.msg}`)
      totalIssues++
    }

    if (verbose && email.plain) {
      console.log(`       ── body preview ──`)
      email.plain.slice(0, 500).split('\n').slice(0, 6).forEach(l =>
        console.log(`       ${l.slice(0, 100)}`)
      )
    }

    console.log()
  }

  console.log(`  ─── ${account.label}: ${emails.length} emails, ${totalIssues} issue(s) ───`)
  return { total: emails.length, issues: totalIssues }
}

async function main() {
  console.log(`\n${'█'.repeat(70)}`)
  console.log(`  EMAIL QUALITY SCANNER  ·  Last ${days} day(s)  ·  ${new Date().toLocaleString()}`)
  console.log('█'.repeat(70))

  const targets = only
    ? ACCOUNTS.filter(a => a.label.toLowerCase().includes(only.toLowerCase()) || a.user.includes(only))
    : ACCOUNTS

  if (!targets.length) { console.error(`No account matching "${only}"`); process.exit(1) }

  let gTotal = 0, gIssues = 0
  for (const acc of targets) {
    const { total, issues } = await scanAccount(acc)
    gTotal += total; gIssues += issues
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  SUMMARY  ·  ${gTotal} emails scanned  ·  ${gIssues} issue(s) found`)
  console.log(`  ${SV.error} error (must fix)   ${SV.warn} warning (should fix)   ${SV.ok} ok`)
  if (gIssues === 0) console.log(`  ✅ All emails look good!`)
  console.log('═'.repeat(70) + '\n')
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1) })
