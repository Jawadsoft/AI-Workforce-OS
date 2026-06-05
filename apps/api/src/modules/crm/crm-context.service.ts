import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { CrmService } from './crm.service'
import type { CRMContext } from './crm.interface'

@Injectable()
export class CrmContextService {
  private readonly logger = new Logger(CrmContextService.name)

  constructor(
    private readonly crm: CrmService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Resolve which permissions this agent actually has for a connection ──
  // Returns null if the agent has NO access (toggle is off)

  private async resolveAgentPermissions(agentId: string | undefined, connectionId: string, agentRole?: string): Promise<string[] | null> {
    if (!agentId) {
      // No agent ID supplied — fall back to role defaults (legacy path)
      const { ROLE_CRM_PERMISSIONS } = await import('./crm.interface')
      return ROLE_CRM_PERMISSIONS[agentRole ?? ''] ?? ROLE_CRM_PERMISSIONS['Receptionist'] ?? []
    }

    const record = await this.prisma.agentCRMAccess.findUnique({
      where: { agentId_connectionId: { agentId, connectionId } },
    })

    if (!record) {
      // Toggle is OFF for this agent — deny all CRM access
      this.logger.debug(`Agent ${agentId} has no CRM access to connection ${connectionId} (toggle is off)`)
      return null
    }

    // Toggle is ON — use the stored permissions (granular per-agent settings)
    return record.permissions as string[]
  }

  // ── Fetch live CRM context for a customer ─────────────────────────
  // Called at the start of every conversation that has caller info

  async fetchContext(tenantId: string, opts: {
    phone?: string
    email?: string
    customerId?: string
    leadId?: string
    jobId?: string
    agentRole?: string
    agentId?: string
  }): Promise<CRMContext> {
    const context: CRMContext = {}

    try {
      const conn = await this.prisma.cRMConnection.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'asc' },
      })
      if (!conn) return context

      // ── Check if this agent has the toggle enabled for this connection ──
      const agentPerms = await this.resolveAgentPermissions(opts.agentId, conn.id, opts.agentRole)
      if (agentPerms === null) {
        // Toggle is off — return empty context, no CRM data for this agent
        return context
      }

      const connector = this.crm['getConnector'](conn)

      // Helper: check permission against resolved list
      const can = (p: string) => agentPerms.includes(p)

      // 1. Find customer by phone or email or ID
      if (can('read_customers')) {
        if (opts.customerId) {
          context.customer = await connector.getCustomer(opts.customerId).catch(() => null)
        } else if (opts.phone) {
          context.customer = await connector.getContactByPhone(opts.phone)
        } else if (opts.email) {
          context.customer = await connector.getContactByEmail(opts.email)
        }
      }

      // 2. Find lead if not already a customer
      if (!context.customer && opts.leadId && can('read_leads')) {
        context.lead = await connector.getLead(opts.leadId).catch(() => null)
      }

      const cid = context.customer?.id ?? opts.customerId

      // 3. Fetch open jobs
      if (cid && can('read_jobs')) {
        context.openJobs = await connector.getJobsByCustomer(cid).catch(() => [])
      }

      // 4. Fetch recent notes
      if (cid && can('read_notes')) {
        context.recentNotes = await connector.getNoteHistory(cid).catch(() => [])
      }

      // 5. Fetch pending proposals
      if (cid && can('read_proposals')) {
        context.pendingProposals = await connector.getProposalsByCustomer(cid)
          .then(p => p.filter(prop => !['accepted', 'completed', 'declined'].includes(prop.status?.toLowerCase() ?? '')))
          .catch(() => [])
      }

      this.logger.log(`CRM context fetched for agent ${opts.agentId ?? 'unknown'} (${conn.provider}): customer=${!!context.customer}, jobs=${context.openJobs?.length ?? 0}`)
    } catch (err: any) {
      this.logger.debug(`No CRM context: ${err.message}`)
    }

    return context
  }

  // ── Format CRM context as a prompt block ─────────────────────────

  formatForPrompt(ctx: CRMContext): string {
    if (!ctx.customer && !ctx.lead && !ctx.openJobs?.length) return ''

    const lines: string[] = []

    if (ctx.customer) {
      lines.push(`CUSTOMER ON THE LINE:`)
      lines.push(`  Name: ${ctx.customer.name}`)
      if (ctx.customer.email) lines.push(`  Email: ${ctx.customer.email}`)
      if (ctx.customer.phone) lines.push(`  Phone: ${ctx.customer.phone}`)
      if (ctx.customer.address) lines.push(`  Address: ${ctx.customer.address}`)
      if (ctx.customer.company) lines.push(`  Company: ${ctx.customer.company}`)
    }

    if (ctx.lead && !ctx.customer) {
      lines.push(`INCOMING LEAD:`)
      lines.push(`  Name: ${ctx.lead.name}`)
      if (ctx.lead.email) lines.push(`  Email: ${ctx.lead.email}`)
      if (ctx.lead.phone) lines.push(`  Phone: ${ctx.lead.phone}`)
      if (ctx.lead.stage) lines.push(`  Pipeline stage: ${ctx.lead.stage}`)
      if (ctx.lead.source) lines.push(`  Lead source: ${ctx.lead.source}`)
      if (ctx.lead.value) lines.push(`  Deal value: $${ctx.lead.value}`)
    }

    if (ctx.openJobs?.length) {
      lines.push(`\nOPEN JOBS (${ctx.openJobs.length}):`)
      ctx.openJobs.slice(0, 3).forEach(j => {
        lines.push(`  - ${j.title} [${j.status}]${j.value ? ` — $${j.value}` : ''}`)
        if (j.address) lines.push(`    Address: ${j.address}`)
      })
    }

    if (ctx.pendingProposals?.length) {
      lines.push(`\nPENDING PROPOSALS (${ctx.pendingProposals.length}):`)
      ctx.pendingProposals.slice(0, 3).forEach(p => {
        lines.push(`  - ${p.title} [${p.status}]${p.value ? ` — $${p.value}` : ''}`)
      })
    }

    if (ctx.recentNotes?.length) {
      lines.push(`\nRECENT NOTES:`)
      ctx.recentNotes.slice(0, 3).forEach(n => {
        const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ''
        lines.push(`  [${date}] ${n.content.slice(0, 150)}`)
      })
    }

    return lines.length > 0
      ? `\n\nCRM CONTEXT (this customer's live data — use it to personalise your response):\n${lines.join('\n')}`
      : ''
  }

  // ── Tool executor — agent calls CRM during conversation ───────────

  async executeTool(tenantId: string, agentRole: string, tool: string, params: Record<string, any>, agentId?: string): Promise<{ result: any; summary: string }> {
    const conn = await this.prisma.cRMConnection.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!conn) throw new Error('No active CRM connection')

    // Check toggle
    const agentPerms = await this.resolveAgentPermissions(agentId, conn.id, agentRole)
    if (agentPerms === null) throw new Error('CRM access is disabled for this agent (toggle is off)')

    const can = (p: string) => agentPerms.includes(p)
    const connector = this.crm['getConnector'](conn)

    switch (tool) {
      case 'crm_search_contacts': {
        if (!can('read_customers')) throw new Error('Permission denied: read_customers')
        const results = await connector.searchContacts(params.query ?? '')
        return {
          result: results,
          summary: results.length
            ? `Found ${results.length} contact(s): ${results.map(r => r.name).join(', ')}`
            : 'No contacts found',
        }
      }

      case 'crm_search_leads': {
        if (!can('read_leads')) throw new Error('Permission denied: read_leads')
        // Pass stage filter directly to the API for efficiency
        const leads = await (connector as any).searchLeads?.(params.query ?? '', params.stage) ?? []
        return {
          result: leads,
          summary: leads.length
            ? `Found ${leads.length} lead(s)${params.stage ? ` in stage "${params.stage}"` : ''}:\n` +
              leads.slice(0, 20).map((l: any) =>
                `  - [${l.id}] ${l.name || '(no name)'} | ${l.email || '—'} | ${l.phone || '—'} | Stage: ${l.stage} | Source: ${l.source || '—'} | Address: ${l.address || '—'}`
              ).join('\n') +
              (leads.length > 20 ? `\n  ...and ${leads.length - 20} more` : '')
            : `No leads found${params.stage ? ` with stage "${params.stage}"` : ''}`,
        }
      }

      case 'crm_get_lead_stats': {
        if (!can('read_leads')) throw new Error('Permission denied: read_leads')
        const allLeads = await (connector as any).searchLeads?.('') ?? []
        const byStage: Record<string, number> = {}
        for (const lead of allLeads) {
          const stage = lead.stage ?? 'Unknown'
          byStage[stage] = (byStage[stage] ?? 0) + 1
        }
        const lines = Object.entries(byStage)
          .sort((a, b) => b[1] - a[1])
          .map(([stage, count]) => `  ${stage}: ${count} lead(s)`)
        return {
          result: byStage,
          summary: `Total leads in CRM: ${allLeads.length}\nBy stage:\n${lines.join('\n')}`,
        }
      }

      case 'crm_get_jobs': {
        if (!can('read_jobs')) throw new Error('Permission denied: read_jobs')
        const jobs = await connector.getJobsByCustomer(params.customerId)
        return {
          result: jobs,
          summary: jobs.length
            ? `${jobs.length} job(s): ${jobs.map(j => `${j.title} [${j.status}]`).join(', ')}`
            : 'No jobs found',
        }
      }

      case 'crm_get_proposals': {
        if (!can('read_proposals')) throw new Error('Permission denied: read_proposals')
        const proposals = await connector.getProposalsByCustomer(params.customerId)
        return {
          result: proposals,
          summary: proposals.length
            ? `${proposals.length} proposal(s): ${proposals.map(p => `${p.title} [${p.status}]`).join(', ')}`
            : 'No proposals found',
        }
      }

      case 'crm_get_materials': {
        if (!can('read_materials')) throw new Error('Permission denied: read_materials')
        const materials = await connector.getMaterialsList(params.jobId)
        return {
          result: materials,
          summary: materials.length
            ? `${materials.length} material item(s) on job`
            : 'No materials found',
        }
      }

      case 'crm_create_note': {
        if (!can('write_notes')) throw new Error('Permission denied: write_notes')
        const note = await connector.createNote({ content: params.content, customerId: params.customerId, jobId: params.jobId })
        return { result: note, summary: `Note logged in CRM (id: ${note.id})` }
      }

      case 'crm_create_task': {
        if (!can('create_tasks')) throw new Error('Permission denied: create_tasks')
        const task = await connector.createTask({ title: params.title, description: params.description, customerId: params.customerId, jobId: params.jobId, dueDate: params.dueDate })
        return { result: task, summary: `Task created in CRM: "${params.title}"` }
      }

      case 'crm_update_lead': {
        if (!can('update_leads')) throw new Error('Permission denied: update_leads')
        await connector.updateLeadStage(params.leadId, params.stage)
        return { result: { ok: true }, summary: `Lead stage updated to "${params.stage}"` }
      }

      case 'crm_update_record': {
        if (!can('update_records')) throw new Error('Permission denied: update_records')
        await connector.updateRecord(params.model, params.id, params.data)
        return { result: { ok: true }, summary: `${params.model} record updated` }
      }

      default:
        throw new Error(`Unknown CRM tool: ${tool}`)
    }
  }
}
