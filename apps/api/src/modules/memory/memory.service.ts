import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

export type MemorySubject = {
  userId?: string | null
  customerId?: string | null
  phone?: string | null
  email?: string | null
  conversationId?: string | null
}

/**
 * MemoryService — ChatGPT-like multi-layer agent memory.
 *
 * 1) Working memory — Conversation.runningSummary (always injected for this thread)
 * 2) Profile memory — AgentMemoryFact durable facts for a subject (always injected)
 * 3) Episodic memory — ConversationSummary vectors (intent search, last 90 days)
 * 4) Task memory — ticket embeddings (existing)
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  // ── Identity binding ──────────────────────────────────────────────

  resolveSubjectKey(subject: MemorySubject): string {
    if (subject.customerId) return `customer:${subject.customerId}`
    if (subject.userId) return `user:${subject.userId}`
    if (subject.phone) {
      const digits = subject.phone.replace(/\D/g, '')
      if (digits.length >= 7) return `phone:${digits}`
    }
    if (subject.email) return `email:${subject.email.trim().toLowerCase()}`
    if (subject.conversationId) return `anon:${subject.conversationId}`
    return 'anon:unknown'
  }

  // ── 1. Summarise conversation + update running summary + extract facts ─

  async summariseConversation(
    conversationId: string,
    subject?: MemorySubject,
  ): Promise<void> {
    try {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          agent: { select: { id: true, name: true, role: true, tenantId: true } },
          messages: {
            where: { role: { in: ['USER', 'ASSISTANT'] } },
            orderBy: { createdAt: 'asc' },
            take: 60,
          },
        },
      })
      if (!conv || !conv.agent) return
      if (conv.messages.length < 2) return

      const subjectKey = this.resolveSubjectKey({
        userId: conv.userId,
        phone: subject?.phone ?? conv.callerPhone,
        email: subject?.email ?? conv.callerEmail,
        customerId: subject?.customerId,
        conversationId,
      })

      const agentLabel = conv.agent.name.split('—')[0].trim()
      const transcript = conv.messages
        .map(m => `${m.role === 'USER' ? 'User' : agentLabel}: ${m.content.slice(0, 500)}`)
        .join('\n')

      const prompt = `You are summarising a conversation for an AI agent's long-term memory.
Write a 2-5 sentence summary that captures:
- What the customer/user needed
- What was agreed, quoted, or decided
- Any specific numbers, names, dates, materials, or preferences
- Current status / what happens next

Be specific and factual. No fluff. Write from the agent's perspective (first person).

Conversation:
${transcript}

Summary:`

      const summary = await this.ai.chat(prompt, [])
      if (!summary || summary.length < 20) return

      const keyEntities = await this.extractEntities(summary)
      const embedding = await this.ai.embed(summary).catch(() => null)

      // Always refresh the in-thread running summary (working memory)
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { runningSummary: summary },
      })

      // Upsert the primary CONVERSATION summary row for this thread
      const existing = await this.prisma.conversationSummary.findFirst({
        where: { conversationId, summaryType: 'CONVERSATION', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      })

      if (existing) {
        // Archive previous version as an EPISODE when content meaningfully changed
        const changed = existing.summary.trim() !== summary.trim()
        if (changed && existing.messageCount > 0 && conv.messages.length - existing.messageCount >= 4) {
          await this.prisma.conversationSummary.create({
            data: {
              tenantId: conv.agent.tenantId,
              agentId: conv.agent.id,
              conversationId,
              summaryType: 'EPISODE',
              summary: existing.summary,
              keyEntities: existing.keyEntities,
              embedding: existing.embedding as any,
              messageCount: existing.messageCount,
              subjectKey: existing.subjectKey ?? subjectKey,
              importance: existing.importance,
            },
          })
        }
        await this.prisma.conversationSummary.update({
          where: { id: existing.id },
          data: {
            summary,
            keyEntities,
            embedding: embedding as any,
            messageCount: conv.messages.length,
            subjectKey,
            updatedAt: new Date(),
          },
        })
      } else {
        await this.prisma.conversationSummary.create({
          data: {
            tenantId: conv.agent.tenantId,
            agentId: conv.agent.id,
            conversationId,
            summaryType: 'CONVERSATION',
            summary,
            keyEntities,
            embedding: embedding as any,
            messageCount: conv.messages.length,
            subjectKey,
          },
        })
      }

      // Extract durable profile facts (non-blocking failure)
      await this.extractAndStoreFacts(
        conv.agent.tenantId,
        conv.agent.id,
        subjectKey,
        conversationId,
        transcript,
        summary,
      ).catch((e) => this.logger.warn(`[Memory] Fact extract failed: ${e.message}`))

      this.logger.log(`[Memory] Summarised conversation ${conversationId.slice(-6)} for ${conv.agent.name}`)
    } catch (err: any) {
      this.logger.warn(`[Memory] Failed to summarise conversation ${conversationId}: ${err.message}`)
    }
  }

  private async extractEntities(text: string): Promise<string[]> {
    try {
      const raw = await this.ai.chat(
        `Extract 5-10 key nouns/terms from this text as a JSON array of lowercase strings. Only the array, no explanation.
Text: "${text.slice(0, 600)}"
Example output: ["gutter", "aluminum", "120ft", "john", "estimate"]`,
        [],
      )
      const match = raw.match(/\[.*?\]/s)
      if (match) return JSON.parse(match[0])
    } catch { /* non-fatal */ }
    return []
  }

  private async extractAndStoreFacts(
    tenantId: string,
    agentId: string,
    subjectKey: string,
    conversationId: string,
    transcript: string,
    summary: string,
  ): Promise<void> {
    const prompt = `Extract durable facts worth remembering long-term about this person / conversation.
Return ONLY a JSON array (max 6 items). Each item:
{"fact":"...","category":"identity|preference|decision|constraint|general","importance":1-5}

Rules:
- Only stable facts (name, prefs, quoted prices agreed, constraints, decisions)
- Skip greetings, one-off small talk, and temporary status
- importance 4-5 = must never forget; 1-2 = nice to have
- Empty array [] if nothing durable

Summary: ${summary}

Recent transcript (truncated):
${transcript.slice(-2500)}`

    const raw = await this.ai.chat(prompt, [])
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return
    let items: { fact: string; category?: string; importance?: number }[] = []
    try {
      items = JSON.parse(match[0])
    } catch {
      return
    }
    if (!Array.isArray(items) || !items.length) return

    for (const item of items.slice(0, 6)) {
      const fact = String(item.fact ?? '').trim()
      if (fact.length < 8) continue
      await this.rememberFact(tenantId, agentId, subjectKey, fact, {
        category: item.category ?? 'general',
        importance: Math.min(5, Math.max(1, Number(item.importance) || 2)),
        sourceConversationId: conversationId,
        confidence: 0.75,
      })
    }
  }

  // ── 2. Profile facts ──────────────────────────────────────────────

  async rememberFact(
    tenantId: string,
    agentId: string,
    subjectKey: string,
    fact: string,
    opts?: {
      category?: string
      importance?: number
      sourceConversationId?: string
      confidence?: number
    },
  ): Promise<{ id: string; fact: string }> {
    const clean = fact.trim().slice(0, 500)
    const category = (opts?.category ?? 'general').toLowerCase()
    const importance = opts?.importance ?? 3

    // Dedupe: if a very similar active fact exists, update it
    const existing = await this.prisma.agentMemoryFact.findMany({
      where: { tenantId, agentId, subjectKey, deletedAt: null },
      select: { id: true, fact: true },
      take: 40,
    })
    const lower = clean.toLowerCase()
    const dup = existing.find((f) => {
      const a = f.fact.toLowerCase()
      return a === lower || a.includes(lower) || lower.includes(a)
    })

    const embedding = await this.ai.embed(clean).catch(() => null)

    if (dup) {
      const updated = await this.prisma.agentMemoryFact.update({
        where: { id: dup.id },
        data: {
          fact: clean,
          category,
          importance: Math.max(importance, 1),
          embedding: embedding as any,
          confidence: opts?.confidence ?? 0.85,
          sourceConversationId: opts?.sourceConversationId,
          updatedAt: new Date(),
        },
      })
      return { id: updated.id, fact: updated.fact }
    }

    const created = await this.prisma.agentMemoryFact.create({
      data: {
        tenantId,
        agentId,
        subjectKey,
        fact: clean,
        category,
        importance,
        embedding: embedding as any,
        confidence: opts?.confidence ?? 0.85,
        sourceConversationId: opts?.sourceConversationId,
      },
    })
    this.logger.log(`[Memory] Stored fact for ${subjectKey}: ${clean.slice(0, 80)}`)
    return { id: created.id, fact: created.fact }
  }

  async forgetFact(
    tenantId: string,
    agentId: string,
    opts: { factId?: string; query?: string; subjectKey?: string },
  ): Promise<string> {
    if (opts.factId) {
      const row = await this.prisma.agentMemoryFact.findFirst({
        where: { id: opts.factId, tenantId, agentId, deletedAt: null },
      })
      if (!row) return 'No matching memory fact found to forget.'
      await this.prisma.agentMemoryFact.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      })
      return `Forgot: "${row.fact}"`
    }

    if (!opts.query) return 'Provide a factId or a short description of what to forget.'

    const facts = await this.prisma.agentMemoryFact.findMany({
      where: {
        tenantId,
        agentId,
        deletedAt: null,
        ...(opts.subjectKey ? { subjectKey: opts.subjectKey } : {}),
      },
      take: 80,
      orderBy: { updatedAt: 'desc' },
    })
    const q = opts.query.toLowerCase()
    const words = q.split(/\s+/).filter((w) => w.length > 3)
    const matches = facts.filter((f) => {
      const text = f.fact.toLowerCase()
      return text.includes(q) || words.some((w) => text.includes(w))
    })

    if (!matches.length) return `I couldn't find a saved memory matching "${opts.query}".`

    await this.prisma.agentMemoryFact.updateMany({
      where: { id: { in: matches.map((m) => m.id) } },
      data: { deletedAt: new Date() },
    })
    if (matches.length === 1) return `Forgot: "${matches[0].fact}"`
    return `Forgot ${matches.length} related memories, including: "${matches[0].fact}"`
  }

  async getProfileFacts(
    agentId: string,
    tenantId: string,
    subjectKey: string,
    limit = 12,
  ): Promise<{ id: string; fact: string; category: string; importance: number }[]> {
    if (!subjectKey || subjectKey.startsWith('anon:unknown')) return []
    return this.prisma.agentMemoryFact.findMany({
      where: { tenantId, agentId, subjectKey, deletedAt: null },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      select: { id: true, fact: true, category: true, importance: true },
    })
  }

  // ── 3. Intent search + full memory block for the prompt ───────────

  async buildMemoryContext(
    agentId: string,
    tenantId: string,
    userMessage: string,
    opts?: {
      subjectKey?: string
      runningSummary?: string | null
      topK?: number
      conversationId?: string
    },
  ): Promise<string> {
    const subjectKey = opts?.subjectKey
    const topK = opts?.topK ?? 5

    const [profileFacts, episodic] = await Promise.all([
      subjectKey ? this.getProfileFacts(agentId, tenantId, subjectKey) : Promise.resolve([]),
      this.searchMemory(agentId, tenantId, userMessage, topK, subjectKey),
    ])

    const parts: string[] = []

    if (opts?.runningSummary?.trim()) {
      parts.push(
        `THIS CONVERSATION SO FAR (working memory — do not re-ask what you already know):\n${opts.runningSummary.trim()}`,
      )
    }

    if (profileFacts.length) {
      const lines = profileFacts.map((f) => `- [${f.category}] ${f.fact}`)
      parts.push(
        `WHAT YOU REMEMBER ABOUT THIS PERSON (durable profile — treat as known facts):\n${lines.join('\n')}`,
      )
    }

    if (episodic) parts.push(episodic.trim())

    // Fallback cascade: the running summary only ever covers a conversation's
    // earliest ~60 messages (see summariseConversation), so anything said later
    // in a long-running thread can fall into a gap that's neither in the live
    // 40-message window nor in the compressed summary/episodic layers above.
    // Only pay for this extra raw-message search when the cheaper layers found
    // nothing relevant.
    if (!episodic && opts?.conversationId) {
      const rawRecall = await this.searchRawMessages(agentId, tenantId, userMessage, opts.conversationId, subjectKey)
      if (rawRecall) parts.push(rawRecall.trim())
    }

    if (!parts.length) return ''
    return `\n\nYOUR MEMORY (use this; do not pretend you forgot):\n${parts.join('\n\n')}`
  }

  /**
   * Raw-message vector search — fallback recall layer over MessageChunk.
   * Searches this conversation's own chunked messages (plus any other chunks
   * for the same subject) so detail that fell out of both the live 40-message
   * window and the frozen running summary can still be found on demand.
   */
  async searchRawMessages(
    agentId: string,
    tenantId: string,
    query: string,
    conversationId: string,
    subjectKey?: string,
    topK = 4,
  ): Promise<string> {
    try {
      const chunks = await this.prisma.messageChunk.findMany({
        where: {
          tenantId,
          agentId,
          OR: [
            { conversationId },
            ...(subjectKey ? [{ subjectKey }] : []),
          ],
        },
        select: { content: true, embedding: true, role: true, conversationId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 300,
      })
      if (!chunks.length) return ''

      const queryEmbedding = await this.ai.embed(query)
      const queryLC = query.toLowerCase()
      const words = queryLC.split(/\s+/).filter((w) => w.length > 3)

      const scored = chunks
        .filter((c) => Array.isArray(c.embedding) && (c.embedding as number[]).length > 0)
        .map((c) => {
          const score = cosineSimilarity(queryEmbedding, c.embedding as number[])
          const hasKeywordMatch = words.some((w) => c.content.toLowerCase().includes(w))
          return { ...c, score: score + (hasKeywordMatch ? 0.05 : 0) }
        })
        .filter((c) => c.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)

      if (!scored.length) return ''

      const lines = scored.map((c) => {
        const sameThread = c.conversationId === conversationId ? '' : ' (other conversation)'
        return `[Earlier in this chat${sameThread} — ${c.role === 'USER' ? 'them' : 'you'}]: ${c.content.slice(0, 400)}`
      })
      return `RAW MESSAGE RECALL (older content not captured in the summary above):\n${lines.join('\n\n')}`
    } catch (err: any) {
      this.logger.warn(`[Memory] Raw message search failed for agent ${agentId}: ${err.message}`)
      return ''
    }
  }

  /**
   * Intent-based episodic + ticket retrieval.
   * Returns a formatted block (or '') for the system prompt.
   */
  async searchMemory(
    agentId: string,
    tenantId: string,
    userMessage: string,
    topK = 5,
    subjectKey?: string,
  ): Promise<string> {
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

      const summaryWhere: any = {
        agentId,
        tenantId,
        deletedAt: null,
        createdAt: { gte: ninetyDaysAgo },
      }

      const [summaries, tickets] = await Promise.all([
        this.prisma.conversationSummary.findMany({
          where: summaryWhere,
          select: {
            conversationId: true,
            summary: true,
            embedding: true,
            keyEntities: true,
            createdAt: true,
            subjectKey: true,
            importance: true,
            summaryType: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 80,
        }),
        this.prisma.activityTicket.findMany({
          where: {
            tenantId,
            OR: [
              { assignedAgentId: agentId },
              { createdByAgentId: agentId },
            ],
            status: { not: 'CANCELLED' },
            createdAt: { gte: ninetyDaysAgo },
          },
          select: {
            id: true, title: true, description: true, notes: true,
            status: true, searchEmbedding: true, contactRef: true,
            nextAction: true, createdAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 40,
        }),
      ])

      if (!summaries.length && !tickets.length) return ''

      const queryEmbedding = await this.ai.embed(userMessage)
      const queryLC = userMessage.toLowerCase()
      const results: { text: string; score: number }[] = []

      for (const s of summaries) {
        const sameSubject = !!(subjectKey && s.subjectKey && s.subjectKey === subjectKey)
        const hasKeywordMatch = s.keyEntities.some((e) => e && queryLC.includes(e.toLowerCase()))

        let score = 0
        if (Array.isArray(s.embedding) && s.embedding.length > 0) {
          score = cosineSimilarity(queryEmbedding, s.embedding as number[])
        } else if (hasKeywordMatch || sameSubject) {
          score = sameSubject ? 0.55 : 0.45
        }

        if (sameSubject) score += 0.12
        if (hasKeywordMatch) score += 0.05
        if (s.importance >= 4) score += 0.03

        // Lower threshold when same identity; slightly lower overall than before
        const threshold = sameSubject ? 0.48 : 0.55
        if (score > threshold || hasKeywordMatch || (sameSubject && score > 0.35)) {
          const daysAgo = Math.floor((Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60 * 24))
          const age = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
          const kind = s.summaryType === 'HANDOFF' ? 'Handoff note' : 'Prior conversation'
          results.push({
            text: `[${kind} — ${age}]: ${s.summary}`,
            score,
          })
        }
      }

      for (const t of tickets) {
        const ticketText = [t.title, t.description, t.notes, t.nextAction].filter(Boolean).join(' ')
        const ticketLC = ticketText.toLowerCase()
        const hasKeywordMatch = queryLC.split(/\s+/).some((w) => w.length > 3 && ticketLC.includes(w))

        let score = 0
        if (Array.isArray(t.searchEmbedding) && (t.searchEmbedding as number[]).length > 0) {
          score = cosineSimilarity(queryEmbedding, t.searchEmbedding as number[])
        } else if (hasKeywordMatch) {
          score = 0.45
        }

        if (score > 0.52 || hasKeywordMatch) {
          const contact = t.contactRef ? ` | Customer: ${t.contactRef}` : ''
          const next = t.nextAction ? `\n  → What's left: ${t.nextAction}` : ''
          const notes = t.notes ? `\n  → Notes: ${t.notes.slice(0, 200)}` : ''
          results.push({
            text: `[Open ticket #${t.id.slice(-6)} (${t.status})${contact}]: ${t.title}${t.description ? `\n  → ${t.description.slice(0, 200)}` : ''}${notes}${next}`,
            score: score + (hasKeywordMatch ? 0.05 : 0),
          })
        }
      }

      if (!results.length) return ''

      const top = results.sort((a, b) => b.score - a.score).slice(0, topK)
      return `\nRELEVANT PAST CONTEXT (episodic — last 90 days):\n${top.map((r) => r.text).join('\n\n')}`
    } catch (err: any) {
      this.logger.warn(`[Memory] Intent search failed for agent ${agentId}: ${err.message}`)
      return ''
    }
  }

  // ── 4. Embed a ticket for future intent searches ──────────────────

  async embedTicket(ticketId: string): Promise<void> {
    try {
      const ticket = await this.prisma.activityTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, title: true, description: true, notes: true },
      })
      if (!ticket) return

      const text = [ticket.title, ticket.description, ticket.notes].filter(Boolean).join(' ')
      const embedding = await this.ai.embed(text)

      await this.prisma.activityTicket.update({
        where: { id: ticketId },
        data: { searchEmbedding: embedding as any },
      })
    } catch (err: any) {
      this.logger.warn(`[Memory] Failed to embed ticket ${ticketId}: ${err.message}`)
    }
  }

  // ── 5. Handoff memory for specialists ─────────────────────────────

  async storeHandoffMemory(
    tenantId: string,
    specialistAgentId: string,
    conversationId: string,
    summaryText: string,
    subject?: MemorySubject,
  ): Promise<void> {
    try {
      const keyEntities = await this.extractEntities(summaryText)
      const embedding = await this.ai.embed(summaryText).catch(() => null)
      const subjectKey = this.resolveSubjectKey({
        ...subject,
        conversationId,
      })

      await this.prisma.conversationSummary.create({
        data: {
          tenantId,
          agentId: specialistAgentId,
          conversationId: null,
          summaryType: 'HANDOFF',
          summary: summaryText,
          keyEntities,
          embedding: embedding as any,
          messageCount: 1,
          subjectKey,
          importance: 3,
        },
      })

      // Also store high-signal handoff content as a fact for the specialist
      await this.rememberFact(tenantId, specialistAgentId, subjectKey, summaryText.slice(0, 400), {
        category: 'decision',
        importance: 3,
        sourceConversationId: conversationId,
        confidence: 0.7,
      }).catch(() => {})

      this.logger.log(`[Memory] Stored handoff memory for specialist ${specialistAgentId.slice(-6)}`)
    } catch (err: any) {
      this.logger.warn(`[Memory] Failed to store handoff memory: ${err.message}`)
    }
  }

  // ── 6. Nightly cleanup — soft-delete low-importance memories > 90 days ─

  @Cron('0 2 * * *')
  async cleanupOldSummaries(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

    const summaries = await this.prisma.conversationSummary.updateMany({
      where: {
        createdAt: { lt: ninetyDaysAgo },
        importance: { lt: 4 },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })

    const facts = await this.prisma.agentMemoryFact.updateMany({
      where: {
        updatedAt: { lt: ninetyDaysAgo },
        importance: { lt: 4 },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })

    // Hard-delete soft-deleted rows older than 180 days
    const hardCut = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
    const hardSummaries = await this.prisma.conversationSummary.deleteMany({
      where: { deletedAt: { lt: hardCut } },
    })
    const hardFacts = await this.prisma.agentMemoryFact.deleteMany({
      where: { deletedAt: { lt: hardCut } },
    })

    if (summaries.count || facts.count || hardSummaries.count || hardFacts.count) {
      this.logger.log(
        `[Memory] Cleanup: soft ${summaries.count} summaries / ${facts.count} facts; ` +
        `hard ${hardSummaries.count} summaries / ${hardFacts.count} facts`,
      )
    }
  }
}
