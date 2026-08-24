import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { AIService } from '../../ai/ai.service'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'
import {
  DEFAULT_MEETING_TYPE,
  MEETING_TYPE_LABELS,
  meetingTitle,
  normalizeMeetingType,
  resolveAgenda,
  resolvePassTarget,
  type ConferenceMeetingType,
} from './conference.defaults'
import {
  buildAliases,
  buildModeratorPrompt,
  chairFallback,
  parseModeratorJson,
  routeConferenceTurnDeterministic,
  type ConferenceParticipant,
  type RouteResult,
  type RoutingMethod,
} from './conference.router'

type TurnStatus =
  | 'ROUTING'
  | 'GENERATING'
  | 'SPEAKING'
  | 'COMPLETE'
  | 'INTERRUPTED'
  | 'SILENCE'

interface ActiveTurn {
  turnId: string
  clientTurnId: string
  status: TurnStatus
  selectedAgentId: string | null
  speakerIds: string[]
  routingMethod: RoutingMethod | null
  startedAt: number
}

@Injectable()
export class ConferenceService {
  private readonly logger = new Logger(ConferenceService.name)
  private readonly locks = new Map<string, ActiveTurn>()
  private readonly turnResults = new Map<string, any>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly ai: AIService,
  ) {}

  async listActiveAgents(tenantId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        role: true,
        avatar: true,
        voiceId: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      avatarUrl: a.avatar,
      voiceId: a.voiceId,
    }))
  }

  /** Past / open conference rooms for this tenant (for reopen + memory UX). */
  async listSessions(tenantId: string, limit = 20) {
    const rows = await this.prisma.conversation.findMany({
      where: { tenantId, channel: 'CONFERENCE' },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 50),
      select: {
        id: true,
        title: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    })
    return rows.map((c) => {
      const meta = (c.metadata as any) || {}
      const meetingType = normalizeMeetingType(meta.meetingType)
      return {
        id: c.id,
        title: c.title,
        status: c.status,
        meetingType,
        meetingTypeLabel: MEETING_TYPE_LABELS[meetingType],
        agenda: resolveAgenda(meetingType, meta.agenda),
        messageCount: c._count.messages,
        participantCount: (meta.participantAgentIds || []).length,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }
    })
  }

  async createSession(
    tenantId: string,
    userId: string,
    opts: {
      participantAgentIds?: string[]
      chairAgentId?: string
      title?: string
      meetingType?: string
      agenda?: string
    } = {},
  ) {
    const agents = await this.listActiveAgents(tenantId)
    if (!agents.length) {
      throw new BadRequestException('No ACTIVE agents available for a conference')
    }

    let participantIds = opts.participantAgentIds?.filter(Boolean) ?? []
    if (!participantIds.length) {
      participantIds = agents.map((a) => a.id)
    }

    const byId = new Map(agents.map((a) => [a.id, a]))
    participantIds = participantIds.filter((id) => byId.has(id))
    if (!participantIds.length) {
      throw new BadRequestException('None of the selected participants are ACTIVE agents')
    }

    const chairAgentId =
      (opts.chairAgentId && participantIds.includes(opts.chairAgentId)
        ? opts.chairAgentId
        : participantIds[0])!

    const meetingType = normalizeMeetingType(opts.meetingType)
    const agenda = resolveAgenda(meetingType, opts.agenda)

    const participants = participantIds.map((id) => {
      const a = byId.get(id)!
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        avatarUrl: a.avatarUrl,
        aliases: buildAliases(a.name),
      }
    })

    const conv = await this.prisma.conversation.create({
      data: {
        tenantId,
        userId,
        agentId: chairAgentId,
        channel: 'CONFERENCE',
        status: 'OPEN',
        title: meetingTitle(meetingType, opts.title),
        metadata: {
          participantAgentIds: participantIds,
          chairAgentId,
          listeningEnabled: true,
          mode: 'chair',
          meetingType,
          agenda,
          participants,
        },
      },
    })

    return this.getSession(tenantId, conv.id)
  }

  async getSession(tenantId: string, sessionId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'CONFERENCE' },
      include: {
        agent: { select: { id: true, name: true, role: true, avatar: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 200,
          select: {
            id: true,
            role: true,
            content: true,
            agentId: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    })
    if (!conv) throw new NotFoundException('Conference session not found')

    const meta = (conv.metadata as any) || {}
    const active = this.locks.get(sessionId)
    const meetingType = normalizeMeetingType(meta.meetingType)

    const agentIds = [
      ...new Set(
        conv.messages.map((m) => m.agentId).filter(Boolean) as string[],
      ),
    ]
    const agentRows = agentIds.length
      ? await this.prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, role: true, avatar: true },
        })
      : []
    const agentMap = new Map(agentRows.map((a) => [a.id, a]))

    return {
      id: conv.id,
      title: conv.title,
      status: conv.status,
      meetingType,
      meetingTypeLabel: MEETING_TYPE_LABELS[meetingType],
      agenda: resolveAgenda(meetingType, meta.agenda),
      chairAgentId: meta.chairAgentId || conv.agentId,
      participantAgentIds: meta.participantAgentIds || [conv.agentId],
      participants: meta.participants || [],
      listeningEnabled: meta.listeningEnabled !== false,
      mode: meta.mode || 'chair',
      chair: {
        id: conv.agent.id,
        name: conv.agent.name,
        role: conv.agent.role,
        avatarUrl: conv.agent.avatar,
      },
      activeTurn: active
        ? {
            turnId: active.turnId,
            status: active.status,
            selectedAgentId: active.selectedAgentId,
            speakerIds: active.speakerIds,
            routingMethod: active.routingMethod,
          }
        : null,
      messages: conv.messages.map((m) => {
        const md = (m.metadata as any) || {}
        const agent = m.agentId ? agentMap.get(m.agentId) : null
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          agentId: m.agentId,
          speakerName:
            md.speakerName ||
            (m.role === 'USER' ? 'You' : agent?.name || 'Agent'),
          speakerType: md.speakerType || (m.role === 'USER' ? 'USER' : 'AGENT'),
          turnId: md.turnId,
          routingMethod: md.routingMethod,
          interrupted: Boolean(md.interrupted),
          createdAt: m.createdAt,
          avatarUrl: agent?.avatar,
        }
      }),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }
  }

  async updateParticipants(
    tenantId: string,
    sessionId: string,
    opts: {
      participantAgentIds?: string[]
      chairAgentId?: string
      listeningEnabled?: boolean
      meetingType?: string
      agenda?: string
      title?: string
    },
  ) {
    const conv = await this.requireSession(tenantId, sessionId)
    const agents = await this.listActiveAgents(tenantId)
    const byId = new Map(agents.map((a) => [a.id, a]))
    const meta = { ...((conv.metadata as any) || {}) }

    let participantIds: string[] =
      opts.participantAgentIds ?? meta.participantAgentIds ?? [conv.agentId]
    participantIds = participantIds.filter((id) => byId.has(id))
    if (!participantIds.length) {
      throw new BadRequestException('At least one ACTIVE participant is required')
    }

    const chairAgentId =
      opts.chairAgentId && participantIds.includes(opts.chairAgentId)
        ? opts.chairAgentId
        : participantIds.includes(meta.chairAgentId)
          ? meta.chairAgentId
          : participantIds[0]

    meta.participantAgentIds = participantIds
    meta.chairAgentId = chairAgentId
    meta.participants = participantIds.map((id) => {
      const a = byId.get(id)!
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        avatarUrl: a.avatarUrl,
        aliases: buildAliases(a.name),
      }
    })
    if (typeof opts.listeningEnabled === 'boolean') {
      meta.listeningEnabled = opts.listeningEnabled
    }
    if (opts.meetingType) {
      meta.meetingType = normalizeMeetingType(opts.meetingType)
    }
    if (typeof opts.agenda === 'string') {
      meta.agenda = opts.agenda.trim() || resolveAgenda(
        normalizeMeetingType(meta.meetingType),
        null,
      )
    }

    const meetingType = normalizeMeetingType(meta.meetingType)
    const title =
      opts.title?.trim() ||
      conv.title ||
      meetingTitle(meetingType)

    await this.prisma.conversation.update({
      where: { id: sessionId },
      data: { metadata: meta, agentId: chairAgentId, title },
    })

    return this.getSession(tenantId, sessionId)
  }

  /** Close room and persist a durable conference summary for later recall. */
  async closeSession(tenantId: string, sessionId: string) {
    await this.requireSession(tenantId, sessionId)
    await this.summariseConference(tenantId, sessionId, true)
    await this.prisma.conversation.update({
      where: { id: sessionId },
      data: { status: 'ENDED' },
    })
    this.locks.delete(sessionId)
    return this.getSession(tenantId, sessionId)
  }

  async submitTurn(
    tenantId: string,
    sessionId: string,
    opts: {
      text: string
      clientTurnId: string
      manualAgentId?: string
    },
    emit?: (data: object) => void,
  ) {
    const text = (opts.text || '').trim()
    if (!text) throw new BadRequestException('text is required')
    if (!opts.clientTurnId) throw new BadRequestException('clientTurnId is required')

    const idemKey = `${sessionId}:${opts.clientTurnId}`
    if (this.turnResults.has(idemKey)) {
      const cached = this.turnResults.get(idemKey)
      emit?.(cached)
      emit?.({ type: 'done', ...cached })
      return cached
    }

    const existing = this.locks.get(sessionId)
    if (
      existing &&
      existing.status !== 'COMPLETE' &&
      existing.status !== 'INTERRUPTED' &&
      existing.status !== 'SILENCE'
    ) {
      throw new ConflictException(
        `Conference floor is busy (${existing.status}). Wait or barge-in.`,
      )
    }

    const conv = await this.requireSession(tenantId, sessionId)
    const meta = (conv.metadata as any) || {}
    const participantIds: string[] = meta.participantAgentIds || [conv.agentId]
    const chairAgentId: string = meta.chairAgentId || conv.agentId
    const meetingType = normalizeMeetingType(meta.meetingType)
    const agenda = resolveAgenda(meetingType, meta.agenda)

    const agents = await this.prisma.agent.findMany({
      where: { tenantId, id: { in: participantIds }, status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
    })
    const participants: ConferenceParticipant[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      aliases:
        (meta.participants as any[])?.find((p) => p.id === a.id)?.aliases ||
        buildAliases(a.name),
    }))

    const turnId = randomUUID()
    const lock: ActiveTurn = {
      turnId,
      clientTurnId: opts.clientTurnId,
      status: 'ROUTING',
      selectedAgentId: null,
      speakerIds: [],
      routingMethod: null,
      startedAt: Date.now(),
    }
    this.locks.set(sessionId, lock)

    try {
      const route = await this.resolveRoute({
        text,
        participants,
        chairAgentId,
        manualAgentId: opts.manualAgentId,
      })

      lock.routingMethod = route.method
      lock.speakerIds = route.action === 'SPEAK' ? route.speakerIds : []
      lock.selectedAgentId = route.action === 'SPEAK' ? route.agentId : null

      const userMsg = await this.prisma.message.create({
        data: {
          conversationId: sessionId,
          role: 'USER',
          content: text,
          metadata: {
            turnId,
            speakerType: 'USER',
            speakerName: 'You',
            clientTurnId: opts.clientTurnId,
            routingPreview: route,
            meetingType,
          },
        },
      })

      const userFormatted = this.formatMessage(userMsg, 'You')
      emit?.({
        type: 'user',
        turnId,
        action: route.action,
        routingMethod: route.method,
        reason: route.reason,
        meetingType,
        selectedAgentIds: route.action === 'SPEAK' ? route.speakerIds : [],
        userMessage: userFormatted,
      })

      if (route.action === 'SILENCE') {
        lock.status = 'SILENCE'
        const result = {
          turnId,
          action: 'SILENCE' as const,
          selectedAgentId: null,
          selectedAgentIds: [] as string[],
          routingMethod: route.method,
          reason: route.reason,
          meetingType,
          userMessage: userFormatted,
          agentMessage: null,
          agentMessages: [],
        }
        this.turnResults.set(idemKey, result)
        this.locks.set(sessionId, { ...lock, status: 'COMPLETE' })
        emit?.({ type: 'done', ...result })
        return result
      }

      lock.status = 'GENERATING'
      const speakerQueue = [...route.speakerIds]
      const plannedMulti = route.speakerIds.length > 1
      const participantNames = participants.map((p) => p.name)
      const agentMessages: any[] = []
      const spoken = new Set<string>()
      const priorMemory = await this.loadPriorConferenceMemory(
        tenantId,
        meetingType,
        sessionId,
        text,
      )

      // Sequential: agent N → emit (UI + TTS) → optional pass-through → next
      for (let i = 0; i < speakerQueue.length; i++) {
        const live = this.locks.get(sessionId)
        if (live?.status === 'INTERRUPTED' || live?.turnId !== turnId) {
          this.logger.log(`Conference turn ${turnId.slice(-6)} interrupted mid-sequence`)
          break
        }

        const agentId = speakerQueue[i]
        const selected = participants.find((p) => p.id === agentId)
        if (!selected || spoken.has(agentId)) continue
        spoken.add(agentId)

        const nextId = speakerQueue[i + 1]
        const nextSpeaker = nextId
          ? participants.find((p) => p.id === nextId)?.name
          : null

        // Roundtable planned speakers: brief + verbal handoff. Pass-through: full answer.
        const isPlannedRoundtable =
          plannedMulti && route.speakerIds.includes(agentId)
        const allowPass = !isPlannedRoundtable

        emit?.({
          type: 'generating',
          turnId,
          speakerIndex: i,
          speakerCount: speakerQueue.length,
          agentId,
          speakerName: selected.name,
        })

        const generated = await this.chat.generateConferenceReply({
          tenantId,
          conversationId: sessionId,
          agentId,
          participantNames,
          briefMode: isPlannedRoundtable,
          speakerIndex: i,
          speakerCount: isPlannedRoundtable
            ? route.speakerIds.length
            : speakerQueue.length,
          nextSpeakerName: isPlannedRoundtable ? nextSpeaker : null,
          meetingType,
          agenda,
          priorConferenceMemory: priorMemory,
          allowPassThrough: allowPass,
        })

        const still = this.locks.get(sessionId)
        if (still?.status === 'INTERRUPTED' || still?.turnId !== turnId) break

        const agentMsg = await this.prisma.message.create({
          data: {
            conversationId: sessionId,
            role: 'ASSISTANT',
            content: generated.text,
            agentId,
            metadata: {
              turnId,
              speakerType: 'AGENT',
              speakerName: selected.name,
              routingMethod: route.method,
              reason: route.reason,
              speakerIndex: i,
              speakerCount: speakerQueue.length,
              meetingType,
              passedTo: generated.passToName || null,
            },
          },
        })
        const formatted = this.formatMessage(agentMsg, selected.name)
        agentMessages.push(formatted)
        emit?.({
          type: 'agent',
          turnId,
          speakerIndex: i,
          speakerCount: speakerQueue.length,
          routingMethod: route.method,
          agentMessage: formatted,
        })

        // Soft pass-through: append better specialist if not already queued
        if (generated.passToName) {
          const passId = resolvePassTarget(
            generated.passToName,
            participants,
            agentId,
          )
          if (passId && !spoken.has(passId) && !speakerQueue.slice(i + 1).includes(passId)) {
            speakerQueue.push(passId)
            this.logger.log(
              `Conference pass-through ${selected.name} → ${generated.passToName} (${passId.slice(-6)})`,
            )
            emit?.({
              type: 'pass',
              turnId,
              fromAgentId: agentId,
              toAgentId: passId,
              toName: generated.passToName,
            })
          }
        }
      }

      await this.prisma.conversation.update({
        where: { id: sessionId },
        data: { updatedAt: new Date(), status: 'OPEN' },
      })

      // Refresh working memory periodically (non-blocking)
      void this.summariseConference(tenantId, sessionId, false).catch((e) =>
        this.logger.warn(`Conference summarise skip: ${e}`),
      )

      const result = {
        turnId,
        action: 'SPEAK' as const,
        selectedAgentId: speakerQueue[0] ?? null,
        selectedAgentIds: [...spoken],
        routingMethod: route.method,
        reason: route.reason,
        meetingType,
        userMessage: userFormatted,
        agentMessage: agentMessages[0] ?? null,
        agentMessages,
      }

      this.turnResults.set(idemKey, result)
      const lockNow = this.locks.get(sessionId)
      if (lockNow?.turnId === turnId && lockNow.status !== 'INTERRUPTED') {
        lock.status = 'COMPLETE'
        this.locks.set(sessionId, lock)
      }
      this.logger.log(
        `Conference turn ${turnId.slice(-6)} → ${agentMessages.length} speaker(s) (${route.method}): ${agentMessages.map((m) => m.speakerName).join(', ')}`,
      )
      emit?.({ type: 'done', ...result })
      return result
    } catch (err) {
      this.locks.delete(sessionId)
      emit?.({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  private async resolveRoute(opts: {
    text: string
    participants: ConferenceParticipant[]
    chairAgentId: string
    manualAgentId?: string
  }): Promise<RouteResult> {
    const deterministic = routeConferenceTurnDeterministic({
      transcript: opts.text,
      participants: opts.participants,
      chairAgentId: opts.chairAgentId,
      manualAgentId: opts.manualAgentId,
    })
    if (deterministic) return deterministic

    try {
      const prompt = buildModeratorPrompt(
        opts.text,
        opts.participants,
        opts.chairAgentId,
      )
      const raw = await this.ai.chat(
        prompt,
        [{ role: 'user', content: opts.text }],
        undefined,
        { temperature: 0.2, maxTokens: 220 },
      )
      const route = parseModeratorJson(
        raw || '',
        opts.participants,
        opts.chairAgentId,
      )
      this.logger.log(
        `Conference moderator → ${route.action} ${route.action === 'SPEAK' ? route.speakerIds.join(',') : '-'} (${route.method})`,
      )
      return route
    } catch (err) {
      this.logger.warn(`Conference moderator failed: ${err}`)
      return chairFallback(opts.participants, opts.chairAgentId, 'Moderator error')
    }
  }

  async bargeIn(tenantId: string, sessionId: string, turnId?: string) {
    await this.requireSession(tenantId, sessionId)
    const active = this.locks.get(sessionId)
    if (!active) {
      return { ok: true, turnStatus: 'IDLE' as const }
    }
    if (turnId && active.turnId !== turnId) {
      return { ok: true, turnStatus: active.status }
    }

    if (active.status === 'SPEAKING' || active.status === 'GENERATING') {
      active.status = 'INTERRUPTED'
      this.locks.set(sessionId, active)

      if (active.turnId) {
        const msgs = await this.prisma.message.findMany({
          where: { conversationId: sessionId, role: 'ASSISTANT' },
          orderBy: { createdAt: 'desc' },
          take: 8,
        })
        for (const m of msgs) {
          const md = (m.metadata as any) || {}
          if (md.turnId === active.turnId && !md.interrupted) {
            await this.prisma.message.update({
              where: { id: m.id },
              data: { metadata: { ...md, interrupted: true } },
            })
          }
        }
      }
    } else {
      this.locks.delete(sessionId)
    }

    return { ok: true, turnStatus: 'INTERRUPTED' as const }
  }

  /**
   * Persist conference memory: runningSummary on the thread + CONFERENCE summary row
   * keyed by meeting type so later sessions can recall decisions.
   */
  async summariseConference(
    tenantId: string,
    sessionId: string,
    force = false,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'CONFERENCE' },
      include: {
        messages: {
          where: { role: { in: ['USER', 'ASSISTANT'] } },
          orderBy: { createdAt: 'asc' },
          take: 80,
          select: {
            role: true,
            content: true,
            agentId: true,
            metadata: true,
          },
        },
      },
    })
    if (!conv || conv.messages.length < 2) return

    if (!force && conv.messages.length < 4) return
    if (!force && conv.runningSummary && conv.messages.length % 3 !== 0) return

    const meta = (conv.metadata as any) || {}
    const meetingType = normalizeMeetingType(meta.meetingType)
    const agenda = resolveAgenda(meetingType, meta.agenda)
    const subjectKey = `conference:${meetingType}:${tenantId}`

    const transcript = conv.messages
      .map((m) => {
        const md = (m.metadata as any) || {}
        const who =
          m.role === 'USER'
            ? 'Owner'
            : (md.speakerName || 'Agent').split(/[—(]/)[0].trim()
        return `${who}: ${m.content.slice(0, 400)}`
      })
      .join('\n')

    const prompt = `Summarise this ${meetingType} conference for long-term team memory.
Agenda was: ${agenda}

Capture in 3–6 factual sentences:
- Decisions / agreements
- Status updates by role
- Blockers and owners
- Follow-ups / next steps
- Anything the owner asked the team to remember

No fluff. Third person.

Transcript:
${transcript}

Summary:`

    const summary = await this.ai.chat(prompt, [], undefined, {
      temperature: 0.2,
      maxTokens: 280,
    })
    if (!summary || summary.length < 30) return

    const embedding = await this.ai.embed(summary).catch(() => null)

    await this.prisma.conversation.update({
      where: { id: sessionId },
      data: { runningSummary: summary },
    })

    const existing = await this.prisma.conversationSummary.findFirst({
      where: {
        conversationId: sessionId,
        summaryType: 'CONFERENCE',
        deletedAt: null,
      },
    })

    const chairAgentId = meta.chairAgentId || conv.agentId

    if (existing) {
      await this.prisma.conversationSummary.update({
        where: { id: existing.id },
        data: {
          summary,
          embedding: embedding as any,
          messageCount: conv.messages.length,
          subjectKey,
          importance: force ? 4 : 3,
          updatedAt: new Date(),
        },
      })
    } else {
      await this.prisma.conversationSummary.create({
        data: {
          tenantId,
          agentId: chairAgentId,
          conversationId: sessionId,
          summaryType: 'CONFERENCE',
          summary,
          keyEntities: [meetingType, MEETING_TYPE_LABELS[meetingType]],
          embedding: embedding as any,
          messageCount: conv.messages.length,
          subjectKey,
          importance: force ? 4 : 3,
        },
      })
    }

    this.logger.log(
      `Conference memory saved ${sessionId.slice(-6)} (${meetingType}, ${conv.messages.length} msgs)`,
    )
  }

  private async loadPriorConferenceMemory(
    tenantId: string,
    meetingType: ConferenceMeetingType,
    currentSessionId: string,
    query: string,
  ): Promise<string> {
    const subjectKey = `conference:${meetingType}:${tenantId}`
    const rows = await this.prisma.conversationSummary.findMany({
      where: {
        tenantId,
        summaryType: 'CONFERENCE',
        deletedAt: null,
        OR: [
          { subjectKey },
          { subjectKey: { startsWith: `conference:${meetingType}:` } },
        ],
        NOT: { conversationId: currentSessionId },
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: { summary: true, updatedAt: true, conversationId: true },
    })
    if (!rows.length) return ''

    // Prefer semantic match when embeddings exist; otherwise take newest 3
    let picked = rows.slice(0, 3)
    try {
      const qEmb = await this.ai.embed(query)
      if (qEmb?.length) {
        const withEmb = await this.prisma.conversationSummary.findMany({
          where: {
            tenantId,
            summaryType: 'CONFERENCE',
            deletedAt: null,
            subjectKey,
            NOT: { conversationId: currentSessionId },
          },
          orderBy: { updatedAt: 'desc' },
          take: 12,
          select: { summary: true, embedding: true, updatedAt: true },
        })
        const scored = withEmb
          .map((r) => {
            const emb = r.embedding as number[] | null
            if (!Array.isArray(emb) || emb.length !== qEmb.length) return null
            let dot = 0
            let na = 0
            let nb = 0
            for (let i = 0; i < qEmb.length; i++) {
              dot += qEmb[i] * emb[i]
              na += qEmb[i] * qEmb[i]
              nb += emb[i] * emb[i]
            }
            const score = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8)
            return { summary: r.summary, updatedAt: r.updatedAt, score }
          })
          .filter(Boolean)
          .sort((a, b) => b!.score - a!.score)
          .slice(0, 3)
        if (scored.length) {
          picked = scored.map((s) => ({
            summary: s!.summary,
            updatedAt: s!.updatedAt,
            conversationId: null,
          }))
        }
      }
    } catch {
      /* newest fallback already set */
    }

    return picked
      .map(
        (r, i) =>
          `(${i + 1}) ${new Date(r.updatedAt).toLocaleDateString()}: ${r.summary}`,
      )
      .join('\n')
  }

  private async requireSession(tenantId: string, sessionId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: sessionId, tenantId, channel: 'CONFERENCE' },
    })
    if (!conv) throw new NotFoundException('Conference session not found')
    return conv
  }

  private formatMessage(m: any, speakerName: string) {
    const md = (m.metadata as any) || {}
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      agentId: m.agentId ?? null,
      speakerName: md.speakerName || speakerName,
      speakerType: md.speakerType || (m.role === 'USER' ? 'USER' : 'AGENT'),
      turnId: md.turnId,
      routingMethod: md.routingMethod,
      interrupted: Boolean(md.interrupted),
      createdAt: m.createdAt,
    }
  }
}
