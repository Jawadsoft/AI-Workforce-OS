import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AIService } from '../../ai/ai.service'

export interface HierarchyNode {
  id: string
  type: 'staff' | 'agent'
  label: string
  designation?: string
  department?: string
  avatar?: string
  role?: string
  managerId?: string
  supervisorUserId?: string
  position?: { x: number; y: number }
}

export interface HierarchyEdge {
  id: string
  source: string
  target: string
  type: 'reports-to' | 'supervises' | 'escalates-to'
}

export interface HierarchyLayout {
  nodes: HierarchyNode[]
  edges: HierarchyEdge[]
}

export interface SaveLayoutDto {
  layout?: HierarchyLayout
  nodeUpdates?: Array<{
    id: string
    type: 'staff' | 'agent'
    managerId?: string | null
    supervisorUserId?: string | null
    designation?: string
    department?: string
    phone?: string
    position?: { x: number; y: number }
  }>
  escalationRules?: Array<{
    agentId: string
    trigger: string
    triggerLabel: string
    action?: string
    targetUserId?: string
    targetAgentId?: string
    urgency?: string
  }>
}

@Injectable()
export class HierarchyService {
  private readonly logger = new Logger(HierarchyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  async getHierarchy(tenantId: string) {
    const [users, agents, savedLayout] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          avatar: true,
          designation: true,
          department: true,
          managerId: true,
          phone: true,
          nodePosition: true,
        },
      }),
      this.prisma.agent.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          role: true,
          avatar: true,
          supervisorUserId: true,
          hierarchyPosition: true,
          escalationRules: {
            select: {
              id: true,
              trigger: true,
              triggerLabel: true,
              action: true,
              targetUserId: true,
              targetAgentId: true,
              urgency: true,
            },
          },
        },
      }),
      this.prisma.tenantHierarchy.findUnique({ where: { tenantId } }),
    ])

    const nodes: HierarchyNode[] = [
      ...users.map((u) => ({
        id: u.id,
        type: 'staff' as const,
        label: u.name,
        designation: u.designation ?? u.role,
        department: u.department ?? undefined,
        avatar: u.avatar ?? undefined,
        role: u.role,
        managerId: u.managerId ?? undefined,
        position: (u.nodePosition as { x: number; y: number }) ?? undefined,
      })),
      ...agents.map((a) => ({
        id: a.id,
        type: 'agent' as const,
        label: a.name,
        designation: a.role,
        avatar: a.avatar ?? undefined,
        role: a.role,
        supervisorUserId: a.supervisorUserId ?? undefined,
        position: (a.hierarchyPosition as { x: number; y: number }) ?? undefined,
      })),
    ]

    const edges: HierarchyEdge[] = []
    for (const u of users) {
      if (u.managerId) {
        edges.push({
          id: `e-${u.managerId}-${u.id}`,
          source: u.managerId,
          target: u.id,
          type: 'reports-to',
        })
      }
    }
    for (const a of agents) {
      if (a.supervisorUserId) {
        edges.push({
          id: `e-${a.supervisorUserId}-${a.id}`,
          source: a.supervisorUserId,
          target: a.id,
          type: 'supervises',
        })
      }
    }

    return {
      layout: { nodes, edges },
      savedLayout: savedLayout?.layout ?? null,
      escalationRules: agents.flatMap((a) =>
        a.escalationRules.map((r) => ({ ...r, agentId: a.id, agentName: a.name })),
      ),
    }
  }

  async saveLayout(tenantId: string, dto: SaveLayoutDto) {
    const ops: Promise<unknown>[] = []

    // Upsert the full canvas snapshot (only when layout is provided)
    if (dto.layout) {
      ops.push(
        this.prisma.tenantHierarchy.upsert({
          where: { tenantId },
          update: { layout: dto.layout as object },
          create: { tenantId, layout: dto.layout as object },
        }),
      )
    }

    // Apply node-level updates (positions + manager/supervisor links)
    for (const update of dto.nodeUpdates ?? []) {
      if (update.type === 'staff') {
        ops.push(
          this.prisma.user.update({
            where: { id: update.id },
            data: {
              // Explicitly pass null to Prisma to clear the relationship when managerId is null
              managerId: update.managerId === undefined ? undefined : (update.managerId ?? null),
              designation: update.designation,
              department: update.department,
              phone: update.phone,
              nodePosition: update.position ? { x: update.position.x, y: update.position.y } : undefined,
            },
          }),
        )
      } else {
        ops.push(
          this.prisma.agent.update({
            where: { id: update.id },
            data: {
              supervisorUserId: update.supervisorUserId === undefined ? undefined : (update.supervisorUserId ?? null),
              hierarchyPosition: update.position ? { x: update.position.x, y: update.position.y } : undefined,
            },
          }),
        )
      }
    }

    // Replace escalation rules
    if (dto.escalationRules?.length) {
      const agentIds = [...new Set(dto.escalationRules.map((r) => r.agentId))]
      for (const agentId of agentIds) {
        ops.push(this.prisma.agentEscalationRule.deleteMany({ where: { agentId, tenantId } }))
        const rules = dto.escalationRules.filter((r) => r.agentId === agentId)
        ops.push(
          this.prisma.agentEscalationRule.createMany({
            data: rules.map((r) => ({
              tenantId,
              agentId: r.agentId,
              trigger: r.trigger,
              triggerLabel: r.triggerLabel,
              action: r.action ?? 'notify',
              targetUserId: r.targetUserId ?? null,
              targetAgentId: r.targetAgentId ?? null,
              urgency: r.urgency ?? 'NORMAL',
            })),
          }),
        )
      }
    }

    await Promise.all(ops)
    return { ok: true }
  }

  /**
   * Builds the agent context string that is injected into the system prompt
   * so that AI agents know the org hierarchy.
   */
  async getAgentContext(tenantId: string, agentId: string): Promise<string> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, tenantId },
      include: {
        supervisor: {
          select: { id: true, name: true, designation: true, phone: true, email: true },
        },
        escalationRules: {
          include: {
            targetUser: {
              select: { id: true, name: true, designation: true, phone: true, email: true },
            },
          },
        },
      },
    })

    if (!agent) return ''

    const allStaff = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        designation: true,
        department: true,
        phone: true,
        email: true,
        managerId: true,
      },
    })

    const lines: string[] = ['== ORG HIERARCHY CONTEXT ==']

    if (agent.supervisor) {
      lines.push(
        `Your direct supervisor: ${agent.supervisor.name} (${agent.supervisor.designation ?? 'Manager'}) [userId: ${agent.supervisor.id}]`,
      )
      if (agent.supervisor.phone) lines.push(`  Phone: ${agent.supervisor.phone}`)
      if (agent.supervisor.email) lines.push(`  Email: ${agent.supervisor.email}`)
    }

    lines.push('\nHuman staff you can reach via contact_human tool (ALWAYS use the exact userId shown):')
    for (const s of allStaff) {
      lines.push(
        `- userId:"${s.id}" | name:${s.name} | role:${s.designation ?? s.role} | phone:${s.phone ?? 'N/A'} | email:${s.email}`,
      )
    }

    if (agent.escalationRules.length) {
      lines.push('\nEscalation rules (follow these exactly):')
      for (const rule of agent.escalationRules) {
        const target = rule.targetUser
          ? `${rule.targetUser.name} [userId: "${rule.targetUser.id}"]`
          : `Agent ${rule.targetAgentId}`
        lines.push(
          `- When "${rule.triggerLabel}" → ${rule.action} ${target} [${rule.urgency}]`,
        )
      }
    }

    lines.push('\nCRITICAL RULES for contact_human:')
    lines.push('- You MUST pass the exact userId string shown above (e.g. userId:"cmtcx29jy0025wcfvyh6adz0l").')
    lines.push('- Do NOT guess, shorten, or modify the userId — copy it exactly.')
    lines.push('- Always respect the reporting hierarchy: do not bypass your supervisor.')
    lines.push('- For time-sensitive or high-stakes issues, escalate immediately per the rules above.')

    return lines.join('\n')
  }

  /**
   * Applies a natural-language correction to an existing hierarchy.
   * The caller passes the current nodes/edges so the AI knows the current state
   * and returns only the targeted changes needed.
   */
  async aiRefineHierarchy(
    tenantId: string,
    instruction: string,
    currentNodes: Array<{ id: string; type: string; label: string; designation?: string; managerId?: string; supervisorUserId?: string }>,
    currentEdges: Array<{ source: string; target: string; type: string }>,
  ) {
    const staffNodes = currentNodes.filter(n => n.type === 'staff')
    const agentNodes = currentNodes.filter(n => n.type === 'agent')

    const currentTree = staffNodes.map(n => {
      const manager = currentEdges.find(e => e.target === n.id && e.type === 'reports-to')
      const managerNode = manager ? currentNodes.find(m => m.id === manager.source) : null
      return `- id:${n.id} | ${n.label} (${n.designation ?? 'Staff'}) → reports to: ${managerNode ? `${managerNode.label} (id:${managerNode.id})` : 'nobody (top level)'}`
    }).join('\n')

    const currentAgents = agentNodes.map(n => {
      const sup = currentEdges.find(e => e.target === n.id && e.type === 'supervises')
      const supNode = sup ? currentNodes.find(m => m.id === sup.source) : null
      return `- id:${n.id} | ${n.label} (AI Agent) → supervised by: ${supNode ? `${supNode.label} (id:${supNode.id})` : 'nobody'}`
    }).join('\n')

    const prompt = `You are an org-chart editor. The user wants to make a targeted correction to the current hierarchy.

CURRENT HIERARCHY:
${currentTree}

CURRENT AGENT ASSIGNMENTS:
${currentAgents}

USER INSTRUCTION: "${instruction}"

Apply ONLY the changes described in the instruction. Do not rearrange anything else.
Return ONLY valid JSON with this exact shape (include only the nodes that actually changed):
{
  "summary": "one sentence: what you changed",
  "staffRelationships": [
    { "userId": "...", "managerId": "..." | null }
  ],
  "agentRelationships": [
    { "agentId": "...", "supervisorUserId": "..." }
  ],
  "escalationRules": []
}`

    let raw: string
    try {
      const result = await this.ai.complete([
        { role: 'system', content: 'You are an org-chart editor. Return only valid JSON, no markdown.' },
        { role: 'user', content: prompt },
      ], undefined, { temperature: 0.1, maxTokens: 1000 })
      raw = result.content
    } catch (err: any) {
      this.logger.error(`[AI Refine] LLM call failed: ${err.message}`)
      throw new Error('AI service unavailable. Please try again.')
    }

    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      this.logger.error(`[AI Refine] Could not parse response: ${cleaned.slice(0, 300)}`)
      throw new Error('AI returned an unexpected format. Please try again.')
    }

    return {
      summary: parsed.summary ?? '',
      staffRelationships: (parsed.staffRelationships ?? []) as Array<{ userId: string; managerId: string | null }>,
      agentRelationships: (parsed.agentRelationships ?? []) as Array<{ agentId: string; supervisorUserId: string }>,
      escalationRules: (parsed.escalationRules ?? []) as any[],
    }
  }

  /**
   * Uses GPT to analyse all staff designations + agent roles and suggest
   * a sensible org hierarchy: who reports to whom, which agents go under
   * which humans, and recommended escalation rules per agent.
   */
  async aiSuggestHierarchy(tenantId: string, customInstructions?: string) {
    const [users, agents] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, role: true, designation: true, department: true },
      }),
      this.prisma.agent.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, name: true, role: true },
      }),
    ])

    const staffList = users.map(u =>
      `- id:${u.id} | ${u.name} | role:${u.role} | title:${u.designation ?? 'unset'} | dept:${u.department ?? 'unset'}`,
    ).join('\n')

    const agentList = agents.map(a =>
      `- id:${a.id} | ${a.name} | aiRole:${a.role}`,
    ).join('\n')

    const customBlock = customInstructions?.trim()
      ? `\nSPECIAL INSTRUCTIONS FROM THE USER (follow these exactly, they override general rules):\n${customInstructions.trim()}\n`
      : ''

    const prompt = `You are an org-chart expert. Given a list of human staff and AI agents, determine the best reporting hierarchy.

HUMAN STAFF:
${staffList}

AI AGENTS:
${agentList}
${customBlock}
RULES:
1. Identify the most senior human (CEO/Owner/Director/MD/General Manager) — they have no manager (managerId: null).
2. Build a logical tree: senior staff manage junior staff based on job titles and departments.
3. Each AI agent should be supervised by the most relevant human based on the agent's role (e.g. a Sales AI agent → Sales Manager, an Operations AI → Operations Manager, a Support AI → Support Manager).
4. For each AI agent, suggest 1-3 escalation rules: realistic trigger scenarios (like "complaint received", "quote above threshold", "out of hours", "technical issue") with the appropriate human to notify.
5. Every staff member must appear exactly once in the hierarchy.
6. Return ONLY valid JSON — no markdown, no explanation.

Return this exact JSON shape:
{
  "reasoning": "one sentence summary of the hierarchy you built",
  "staffRelationships": [
    { "userId": "...", "managerId": "..." | null }
  ],
  "agentRelationships": [
    { "agentId": "...", "supervisorUserId": "..." }
  ],
  "escalationRules": [
    {
      "agentId": "...",
      "trigger": "complaint_received",
      "triggerLabel": "Customer complaint received",
      "action": "notify",
      "targetUserId": "...",
      "urgency": "URGENT"
    }
  ]
}`

    let raw: string
    try {
      const result = await this.ai.complete([
        { role: 'system', content: 'You are an org-chart expert. Respond only with valid JSON.' },
        { role: 'user', content: prompt },
      ], undefined, { temperature: 0.2, maxTokens: 2000 })
      raw = result.content
    } catch (err: any) {
      this.logger.error(`[AI Hierarchy] LLM call failed: ${err.message}`)
      throw new Error('AI service unavailable. Please try again.')
    }

    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      this.logger.error(`[AI Hierarchy] Could not parse LLM response: ${cleaned.slice(0, 300)}`)
      throw new Error('AI returned an unexpected format. Please try again.')
    }

    return {
      reasoning: parsed.reasoning ?? '',
      staffRelationships: (parsed.staffRelationships ?? []) as Array<{ userId: string; managerId: string | null }>,
      agentRelationships: (parsed.agentRelationships ?? []) as Array<{ agentId: string; supervisorUserId: string }>,
      escalationRules: (parsed.escalationRules ?? []) as Array<{
        agentId: string
        trigger: string
        triggerLabel: string
        action: string
        targetUserId: string
        urgency: string
      }>,
    }
  }
}
