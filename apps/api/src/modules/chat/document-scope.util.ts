import { randomUUID } from 'crypto'

export type DocumentScopeMode = 'single' | 'multi' | 'all'

export interface ConversationDocument {
  id: string
  name: string
  text: string
  uploadedAt: string
}

/** Legacy rows may only have { name, text } — normalize in place. */
export function normalizeDocuments(raw: any[] | undefined | null): ConversationDocument[] {
  if (!Array.isArray(raw) || !raw.length) return []
  return raw
    .filter((d) => d && typeof d.name === 'string' && typeof d.text === 'string' && d.text.trim())
    .map((d) => ({
      id: typeof d.id === 'string' && d.id ? d.id : `doc_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: d.name,
      text: d.text,
      uploadedAt: typeof d.uploadedAt === 'string' && d.uploadedAt ? d.uploadedAt : new Date().toISOString(),
    }))
}

export function makeConversationDocument(name: string, text: string): ConversationDocument {
  return {
    id: `doc_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name,
    text,
    uploadedAt: new Date().toISOString(),
  }
}

/**
 * Resolve which documents should be injected for this turn.
 * Defaults to latest-only (single). Expands only on explicit compare / all / filename cues.
 */
export function resolveDocumentScope(opts: {
  userMessage: string
  documents: ConversationDocument[]
  activeDocumentIds?: string[]
  documentScopeMode?: DocumentScopeMode
  newlyUploadedIds?: string[]
}): {
  mode: DocumentScopeMode
  activeDocumentIds: string[]
  scopedDocuments: ConversationDocument[]
  registrySummary: string
} {
  const docs = opts.documents
  if (!docs.length) {
    return { mode: 'single', activeDocumentIds: [], scopedDocuments: [], registrySummary: '' }
  }

  const msg = (opts.userMessage || '').toLowerCase()
  const newlyUploadedIds = opts.newlyUploadedIds?.filter(Boolean) ?? []

  // Fresh upload(s) this turn → scope to those only (prevents mixing with historical PDFs)
  if (newlyUploadedIds.length) {
    const scoped = docs.filter((d) => newlyUploadedIds.includes(d.id))
    const ids = scoped.map((d) => d.id)
    return {
      mode: ids.length > 1 ? 'multi' : 'single',
      activeDocumentIds: ids,
      scopedDocuments: scoped,
      registrySummary: formatRegistry(docs, ids, ids.length > 1 ? 'multi' : 'single'),
    }
  }

  const allCue =
    /\b(all\s+(uploaded\s+)?(docs|documents|files|pdfs)|across\s+(all\s+)?(my\s+)?(docs|documents|files)|every\s+(doc|document|file))\b/i.test(
      opts.userMessage || '',
    )
  const compareCue =
    /\b(compare|comparison|vs\.?|versus|side[-\s]?by[-\s]?side|contradict|inconsistenc|difference between|diff between)\b/i.test(
      opts.userMessage || '',
    )

  // Filename / basename mention → switch to that document
  const mentioned = docs.filter((d) => {
    const full = d.name.toLowerCase()
    const base = full.replace(/\.[^.]+$/, '')
    return (msg.includes(full) || (base.length >= 4 && msg.includes(base)))
  })

  let mode: DocumentScopeMode = opts.documentScopeMode === 'all' || opts.documentScopeMode === 'multi' || opts.documentScopeMode === 'single'
    ? opts.documentScopeMode
    : 'single'
  let activeIds = (opts.activeDocumentIds ?? []).filter((id) => docs.some((d) => d.id === id))

  if (allCue) {
    mode = 'all'
    activeIds = docs.map((d) => d.id)
  } else if (compareCue) {
    if (mentioned.length >= 2) {
      mode = 'multi'
      activeIds = mentioned.map((d) => d.id)
    } else if (mentioned.length === 1 && activeIds.length && !activeIds.includes(mentioned[0].id)) {
      mode = 'multi'
      activeIds = Array.from(new Set([...activeIds, mentioned[0].id]))
    } else if (docs.length >= 2) {
      // "compare the documents" with no names → last two uploads
      mode = 'multi'
      activeIds = docs.slice(-2).map((d) => d.id)
    }
  } else if (mentioned.length === 1) {
    mode = 'single'
    activeIds = [mentioned[0].id]
  } else if (mentioned.length > 1) {
    mode = 'multi'
    activeIds = mentioned.map((d) => d.id)
  }

  // Fallback: keep prior active, else latest document only
  if (!activeIds.length) {
    mode = 'single'
    activeIds = [docs[docs.length - 1].id]
  }

  if (mode === 'all') {
    activeIds = docs.map((d) => d.id)
  }

  const scopedDocuments =
    mode === 'all' ? docs : docs.filter((d) => activeIds.includes(d.id))

  return {
    mode,
    activeDocumentIds: activeIds,
    scopedDocuments,
    registrySummary: formatRegistry(docs, activeIds, mode),
  }
}

function formatRegistry(docs: ConversationDocument[], activeIds: string[], mode: DocumentScopeMode): string {
  const lines = docs.map((d) => {
    const active = activeIds.includes(d.id) ? 'ACTIVE' : 'stored (not in scope)'
    return `- [${d.id}] ${d.name} — ${active}`
  })
  return [
    `DOCUMENT SCOPE MODE: ${mode}`,
    `ACTIVE DOCUMENT IDS: ${activeIds.join(', ') || '(none)'}`,
    `DOCUMENT REGISTRY:`,
    ...lines,
    `RULES: Answer ONLY from ACTIVE documents below. Do NOT use stored-but-out-of-scope files for claim numbers, RCV, insured names, or line items. If the user asks about an out-of-scope file, ask them to name it or say "compare" / "use all documents". Cite facts as [filename].`,
  ].join('\n')
}

export function formatScopedDocumentsForPrompt(docs: ConversationDocument[]): string {
  if (!docs.length) return ''
  return docs
    .map(
      (d) =>
        `\n\n--- ATTACHED DOCUMENT [${d.id}]: ${d.name} ---\n${d.text}\n--- END DOCUMENT [${d.id}] ---`,
    )
    .join('')
}
