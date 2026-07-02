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
    // Find the lead qualification agent for this tenant
    const LEAD_QUAL_KEYWORDS = ['lead qual', 'charlie', 'qualification', 'intake', 'lead agent']
    const leadAgent = await this.prisma.agent.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        OR: LEAD_QUAL_KEYWORDS.map(k => ({ role: { contains: k, mode: 'insensitive' as const } })),
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

    if (!leads.length) return

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

    let created = 0
    for (const lead of leads.slice(0, 20)) {
      if (created >= 20) break

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
      if (existing) continue

      // Create the lead qualification ticket
      const ticket = await this.prisma.activityTicket.create({
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
          ].filter(Boolean).join('\n'),
          type: 'GENERAL',
          status: 'OPEN',
          priority: 'MEDIUM',
          source: 'INTERNAL',
          contactRef: name,
          contactEmail: email || undefined,
          contactPhone: phone || undefined,
          assignedAgentId: leadAgent.id,
          nextAction: 'Qualify this lead — check CRM history, assess fit, and either progress or reject.',
          metadata: { crmLeadId: leadId, crmProvider: crmConn.provider } as any,
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

    if (created > 0) {
      this.logger.log(`[CrmLeadScanner][${tenantId}] ${created} new lead ticket(s) created → assigned to ${leadAgent.name}`)
    }
  }
}
