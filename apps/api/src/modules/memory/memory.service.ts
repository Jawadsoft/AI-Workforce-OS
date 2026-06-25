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

/**
 * MemoryService — gives every agent human-like memory across conversations.
 *
 * Three capabilities:
 *  1. summariseConversation — auto-generates a 2-4 sentence summary of a
 *     finished conversation, embeds it, and stores it per agent.
 *
 *  2. searchMemory — intent-based retrieval: given a new user message,
 *     finds relevant prior conversations + tickets for this agent within
 *     the last 30 days and returns a context block for the system prompt.
 *
 *  3. embedTicket — embeds a ticket's title + description + notes so it
 *     can be found by the intent search.
 *
 *  4. Nightly cleanup — removes summaries older than 30 days.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  // ── 1. Summarise a conversation and store the summary ─────────────

  async summariseConversation(conversationId: string): Promise<void> {
    try {
      // Load conversation + messages
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          agent: { select: { id: true, name: true, role: true, tenantId: true } },
          messages: {
            where: { role: { in: ['USER', 'ASSISTANT'] } },
            orderBy: { createdAt: 'asc' },
            take: 40,
          },
          summary: true,
        },
      })
      if (!conv || !conv.agent) return
      if (conv.messages.length < 2) return  // nothing worth summarising
      if (conv.summary) return               // already summarised

      const transcript = conv.messages
        .map(m => `${m.role === 'USER' ? 'User' : conv.agent.name.split('—')[0].trim()}: ${m.content.slice(0, 400)}`)
        .join('\n')

      const prompt = `You are summarising a conversation for an AI agent's long-term memory.
Write a 2-4 sentence summary that captures:
- What the customer needed
- What was agreed, quoted, or decided
- Any specific numbers, names, dates, or materials mentioned
- Current status / what happens next

Be specific and factual. No fluff. Write from the agent's perspective (first person).

Conversation:
${transcript}

Summary:`

      const summary = await this.ai.chat(prompt, [])
      if (!summary || summary.length < 20) return

      // Extract key entities for fast pre-filtering
      const entityPrompt = `Extract 5-10 key nouns/terms from this text as a JSON array of lowercase strings. Only the array, no explanation.
Text: "${summary}"
Example output: ["gutter", "aluminum", "120ft", "john", "estimate"]`

      let keyEntities: string[] = []
      try {
        const raw = await this.ai.chat(entityPrompt, [])
        const match = raw.match(/\[.*?\]/s)
        if (match) keyEntities = JSON.parse(match[0])
      } catch { /* non-fatal */ }

      // Embed the summary
      const embedding = await this.ai.embed(summary).catch(() => null)

      await this.prisma.conversationSummary.upsert({
        where: { conversationId },
        create: {
          tenantId: conv.agent.tenantId,
          agentId: conv.agent.id,
          conversationId,
          summaryType: 'CONVERSATION',
          summary,
          keyEntities,
          embedding: embedding as any,
          messageCount: conv.messages.length,
        },
        update: {
          summary,
          keyEntities,
          embedding: embedding as any,
          messageCount: conv.messages.length,
          updatedAt: new Date(),
        },
      })

      this.logger.log(`[Memory] Summarised conversation ${conversationId.slice(-6)} for ${conv.agent.name}`)
    } catch (err: any) {
      this.logger.warn(`[Memory] Failed to summarise conversation ${conversationId}: ${err.message}`)
    }
  }

  // ── 2. Intent search — find relevant past context for current message ──
  //
  // Returns a formatted block to inject into the system prompt.
  // Returns '' if nothing relevant found (agent starts fresh).

  async searchMemory(
    agentId: string,
    tenantId: string,
    userMessage: string,
    topK = 2,
  ): Promise<string> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      // Run ticket search + summary search in parallel
      const [summaries, tickets] = await Promise.all([
        // Conversation summaries from last 30 days for this agent
        this.prisma.conversationSummary.findMany({
          where: {
            agentId,
            tenantId,
            createdAt: { gte: thirtyDaysAgo },
          },
          select: { conversationId: true, summary: true, embedding: true, keyEntities: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        // Open/recent tickets for this agent — assigned to OR created by them
        this.prisma.activityTicket.findMany({
          where: {
            tenantId,
            OR: [
              { assignedAgentId: agentId },
              { createdByAgentId: agentId },
            ],
            status: { not: 'CANCELLED' },
            createdAt: { gte: thirtyDaysAgo },
          },
          select: {
            id: true, title: true, description: true, notes: true,
            status: true, searchEmbedding: true, contactRef: true,
            nextAction: true, createdAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }),
      ])

      if (!summaries.length && !tickets.length) return ''

      // Embed the user's message once, use for both searches
      const queryEmbedding = await this.ai.embed(userMessage)

      const queryLC = userMessage.toLowerCase()
      const results: { text: string; score: number; age: string }[] = []

      // ── Score conversation summaries ──
      for (const s of summaries) {
        // Fast keyword pre-filter — skip cosine if no entity overlap
        const hasKeywordMatch = s.keyEntities.some(e => queryLC.includes(e))

        let score = 0
        if (Array.isArray(s.embedding) && s.embedding.length > 0) {
          score = cosineSimilarity(queryEmbedding, s.embedding as number[])
        } else if (hasKeywordMatch) {
          score = 0.5  // keyword match but no embedding — give moderate score
        }

        if (score > 0.62 || hasKeywordMatch) {
          const daysAgo = Math.floor((Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60 * 24))
          const age = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
          results.push({
            text: `[Prior conversation — ${age}]: ${s.summary}`,
            score: score + (hasKeywordMatch ? 0.05 : 0), // slight boost for keyword match
            age,
          })
        }
      }

      // ── Score tickets ──
      for (const t of tickets) {
        const ticketText = [t.title, t.description, t.notes, t.nextAction].filter(Boolean).join(' ')
        const ticketLC = ticketText.toLowerCase()

        const hasKeywordMatch = queryLC.split(/\s+/).some(w => w.length > 3 && ticketLC.includes(w))

        let score = 0
        if (Array.isArray(t.searchEmbedding) && (t.searchEmbedding as number[]).length > 0) {
          score = cosineSimilarity(queryEmbedding, t.searchEmbedding as number[])
        } else if (hasKeywordMatch) {
          score = 0.45
        }

        if (score > 0.58 || hasKeywordMatch) {
          const contact = t.contactRef ? ` | Customer: ${t.contactRef}` : ''
          const next = t.nextAction ? `\n  → What's left: ${t.nextAction}` : ''
          const notes = t.notes ? `\n  → Notes: ${t.notes.slice(0, 200)}` : ''
          results.push({
            text: `[Open ticket #${t.id.slice(-6)} (${t.status})${contact}]: ${t.title}${t.description ? `\n  → ${t.description.slice(0, 200)}` : ''}${notes}${next}`,
            score: score + (hasKeywordMatch ? 0.05 : 0),
            age: '',
          })
        }
      }

      if (!results.length) return ''

      // Sort by score and take top-K
      const top = results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)

      return `\n\nYOUR RELEVANT MEMORY (from past 30 days — use this context, do not re-ask what you already know):\n${top.map(r => r.text).join('\n\n')}`
    } catch (err: any) {
      this.logger.warn(`[Memory] Intent search failed for agent ${agentId}: ${err.message}`)
      return ''
    }
  }

  // ── 3. Embed a ticket for future intent searches ──────────────────
  //
  // Call this async (non-blocking) when a ticket is created or updated.

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

  // ── 3b. Store a handoff memory entry for the specialist ──────────
  //
  // Called when an agent is consulted via handoff_to_agent.
  // Creates a ConversationSummary entry under the specialist's agentId
  // so they remember what they were asked and what they answered.

  async storeHandoffMemory(tenantId: string, specialistAgentId: string, conversationId: string, summaryText: string): Promise<void> {
    try {
      // Extract key entities
      const entityPrompt = `Extract 5-8 key nouns/terms from this text as a JSON array of lowercase strings. Only the array, no explanation.
Text: "${summaryText.slice(0, 300)}"
Example: ["gutter", "aluminum", "estimate", "120ft"]`

      let keyEntities: string[] = []
      try {
        const raw = await this.ai.chat(entityPrompt, [])
        const match = raw.match(/\[.*?\]/s)
        if (match) keyEntities = JSON.parse(match[0])
      } catch { /* non-fatal */ }

      const embedding = await this.ai.embed(summaryText).catch(() => null)

      // Store as a HANDOFF type memory (no conversationId — specialist wasn't in this conversation)
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
        },
      })

      this.logger.log(`[Memory] Stored handoff memory for specialist ${specialistAgentId.slice(-6)}`)
    } catch (err: any) {
      this.logger.warn(`[Memory] Failed to store handoff memory: ${err.message}`)
    }
  }

  // ── 4. Nightly cleanup — remove summaries older than 30 days ─────

  @Cron('0 2 * * *')  // 2 AM every day
  async cleanupOldSummaries(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { count } = await this.prisma.conversationSummary.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    })
    if (count > 0) this.logger.log(`[Memory] Cleaned up ${count} old conversation summaries`)
  }
}
