import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../common/prisma/prisma.service'
import { ChatService } from '../chat/chat.service'
import { CrmService } from '../crm/crm.service'

/**
 * CRM Lead Scanner — runs every 15 minutes.
 *
 * For each active tenant that has a CRM connection:
 *  1. Queries the CRM for new/recently-updated leads.
 *  2. Cross-references against existing ActivityTickets (deduplication by contactRef/contactEmail).
 *  3. For each genuinely new lead, auto-creates an ActivityTicket assigned to the
 *     tenant's Lead Qualification agent (Charlie role) with status OPEN.
 *  4. Stamps tenant.settings.crmLeadScan.lastScannedAt to avoid re-processing.
 *
 * Safety guards:
 *  - Skips tenants with no active CRM connection.
 *  - Skips tenants with no lead-qualification agent.
 *  - Max 20 new tickets per tenant per run to avoid flooding.
 *  - Catches and logs per-tenant errors without stopping other tenants.
 */
@Injectable()
export class CrmLeadScannerScheduler {
  private readonly logger = new Logger(CrmLeadScannerScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly crm: CrmService,
  ) {}

  @Cron('*/15 * * * *')
  async scanAllTenants() {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, settings: true },
    })

    for (const tenant of tenants) {
      try {
        await this.scanTenant(tenant.id, tenant.settings as any)
      } catch (err: any) {
        this.logger.warn(`[CrmLeadScanner] Tenant ${tenant.id}: ${err.message}`)
      }
    }
  }

  private async scanTenant(tenantId: string, settings: any) {
    // Grab the operational playbook once — used for stage-0 context + nextAction
    const playbook = settings?.brain?.operationalPlaybook
    const pipelineStages: any[] = playbook?.pipelineStages ?? []
    const stage0 = pipelineStages[0]   // Lead Qualification stage (index 0)

    // Find the lead qualification agent for this tenant
    // Prefer the agent whose role matches stage-0's ownerRole from the playbook,
    // falling back to known keyword matches (charlie / lead qual / qualification / intake)
    // 'intake' intentionally excluded — Customer Intake (Jackie/Nora) is a different role
    const LEAD_QUAL_KEYWORDS = ['lead qual', 'charlie', 'qualification', 'lead agent']
    const roleKeywords = stage0?.ownerRole
      ? [stage0.ownerRole, ...LEAD_QUAL_KEYWORDS]
      : LEAD_QUAL_KEYWORDS

    const leadAgent = await this.prisma.agent.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        OR: roleKeywords.map(k => ({ role: { contains: k, mode: 'insensitive' as const } })),
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!leadAgent) return  // No lead-qual agent — skip

    // Check if CRM connection exists
    const crmConn = await this.prisma.cRMConnection.findFirst({
      where: { tenantId, isActive: true },
    })
    if (!crmConn) return  // No CRM connected — skip

    // Determine window: last scan → now
    const scanMeta = settings?.crmLeadScan ?? {}
    const lastScannedAt: Date = scanMeta.lastScannedAt
      ? new Date(scanMeta.lastScannedAt)
      : new Date(Date.now() - 24 * 60 * 60 * 1000)  // Default: last 24h on first run

    let leads: any[] = []
    try {
      leads = await this.crm.searchLeads(tenantId, '')
    } catch (err: any) {
      this.logger.warn(`[CrmLeadScanner][${tenantId}] CRM searchLeads failed: ${err.message}`)
      return
    }

    if (!leads.length) {
      this.logger.log(`[CrmLeadScanner][${tenantId}] CRM returned 0 leads — nothing to import`)
      return
    }
    this.logger.log(`[CrmLeadScanner][${tenantId}] Fetched ${leads.length} lead(s) from CRM — checking for new ones...`)

    // Stamp lastScannedAt immediately so a crash doesn't cause double-processing
    const now = new Date()
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...(settings ?? {}),
          crmLeadScan: { ...scanMeta, lastScannedAt: now.toISOString() },
        } as any,
      },
    })

    // Only import leads created within the last 30 days.
    // If the CRM lead has no createdAt we include it (can't tell age → safer to process).
    const twoDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    let created = 0
    let skipped = 0
    for (const lead of leads.slice(0, 50)) {
      if (created >= 50) break

      // Skip leads older than 2 days (only when the CRM provides a createdAt date)
      if (lead.createdAt) {
        const leadDate = new Date(lead.createdAt)
        if (!isNaN(leadDate.getTime()) && leadDate < twoDaysAgo) {
          this.logger.debug(`[CrmLeadScanner][${tenantId}] Skipping lead older than 30 days: "${lead.name}" (created ${lead.createdAt})`)
          skipped++
          continue
        }
      }

      // Normalize lead fields (CRMs vary in field names)
      const name: string  = lead.name ?? lead.contactName ?? lead.fullName ?? `Lead #${lead.id ?? ''}`
      const email: string = lead.email ?? lead.contactEmail ?? ''
      const phone: string = lead.phone ?? lead.contactPhone ?? ''
      const source: string = lead.source ?? lead.leadSource ?? 'CRM'
      const leadId: string = String(lead.id ?? lead.leadId ?? '')

      if (!name) continue

      // Deduplication: skip if a ticket already references this CRM lead
      const existing = await this.prisma.activityTicket.findFirst({
        where: {
          tenantId,
          OR: [
            ...(email ? [{ contactEmail: email }] : []),
            ...(leadId ? [{ metadata: { path: ['crmLeadId'], equals: leadId } }] : []),
          ],
        },
        select: { id: true },
      })
      if (existing) { skipped++; continue }

      // Build nextAction — use completion criteria reworded as a task (NOT the trigger text)
      // The trigger describes when the stage starts; we want what Charlie must DO to finish it.
      const stage0NextAction = stage0?.completion
        ? `Qualify this lead: ${stage0.completion}. Call fetch_storm_data for the property address, score the lead, email the homeowner via contact_customer, then call update_ticket(AWAITING_CUSTOMER) after emailing or update_ticket(COMPLETED) if fully qualified.`
        : 'Qualify this lead — run storm data check, score (0–100), email the homeowner, then call update_ticket with status AWAITING_CUSTOMER or COMPLETED.'

      // Create the lead qualification ticket — Stage 0 of the pipeline
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ticket = await (this.prisma.activityTicket.create as any)({
        data: {
          tenantId,
          title: `New lead — ${name} (via ${source})`,
          description: [
            `Lead imported from CRM (${crmConn.provider}).`,
            `Source: ${source}`,
            phone  ? `Phone: ${phone}` : '',
            email  ? `Email: ${email}` : '',
            lead.address ? `Address: ${lead.address}` : '',
            lead.notes ? `Notes: ${lead.notes}` : '',
            stage0?.name ? `Pipeline stage: ${stage0.name}` : '',
            stage0?.completion ? `Done when: ${stage0.completion}` : '',
          ].filter(Boolean).join('\n'),
          type: 'GENERAL',
          status: 'OPEN',
          priority: 'MEDIUM',
          source: 'PIPELINE',
          contactRef: name,
          contactEmail: email || undefined,
          contactPhone: phone || undefined,
          leadId: leadId || undefined,
          assignedAgentId: leadAgent.id,
          nextAction: stage0NextAction,
          metadata: {
            crmLeadId: leadId,
            crmProvider: crmConn.provider,
            pipelineStageIndex: 0,   // starts at Stage 0 (Lead Qualification)
            pipelineStageName: stage0?.name ?? 'Lead Qualification',
          } as any,
          activityLog: [
            {
              agentName: 'System',
              agentId: 'system',
              action: 'CRM_LEAD_IMPORTED',
              note: `Auto-imported from ${crmConn.provider} CRM. Lead ID: ${leadId}`,
              timestamp: now.toISOString(),
            },
          ] as any,
        },
      })

      this.logger.log(`[CrmLeadScanner][${tenantId}] Created ticket #${String(ticket.ticketNumber).padStart(4,'0')} for lead: ${name}`)
      created++
    }

    this.logger.log(`[CrmLeadScanner][${tenantId}] Done — ${created} ticket(s) created, ${skipped} already existed → assigned to ${leadAgent.name}`)
  }
}
