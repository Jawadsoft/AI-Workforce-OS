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

      // ── Job card tools ──────────────────────────────────────────────

      case 'crm_get_job': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const card = await connector.getJobCard(params.jobId)
        const lines: string[] = [`Job card for job ${params.jobId}:`]
        if (card.contactName)         lines.push(`  Contact: ${card.contactName} | ${card.contactEmail ?? ''} | ${card.contactPhone ?? ''}`)
        if (card.propertyAddress)     lines.push(`  Property: ${card.propertyAddress} (ZIP: ${card.propertyZip ?? '—'})`)
        if (card.insuranceCarrier)    lines.push(`  Insurance: ${card.insuranceCarrier} | Policy: ${card.policyNumber ?? '—'}`)
        if (card.claimNumber)         lines.push(`  Claim #: ${card.claimNumber} | Ref: ${card.claimReferenceNumber ?? '—'}`)
        if (card.stormEventDate)      lines.push(`  Storm date: ${card.stormEventDate} | NOAA event: ${card.noaaEventId ?? '—'}`)
        if (card.damageSeverity)      lines.push(`  Damage: ${card.damageSeverity} | Hail: ${card.hailSizeInches ?? '—'}"`)
        if (card.estimateTotal)       lines.push(`  Estimate: $${card.estimateTotal} | ACV: $${card.acvAmount ?? '—'} | RCV: $${card.rcvAmount ?? '—'}`)
        if (card.depreciationHoldback) lines.push(`  Depreciation holdback: $${card.depreciationHoldback}`)
        if (card.depositPaid)         lines.push(`  Deposit paid: $${card.depositPaid} | Balance owing: $${card.balanceOwing ?? '—'}`)
        if (card.inspectionDate)      lines.push(`  Inspection: ${card.inspectionDate}`)
        if (card.installationDate)    lines.push(`  Installation: ${card.installationDate}`)
        if (card.materialDeliveryDate) lines.push(`  Material delivery: ${card.materialDeliveryDate}`)
        if (card.permitNumber)        lines.push(`  Permit #: ${card.permitNumber}`)
        if (card.poNumber)            lines.push(`  PO #: ${card.poNumber}`)
        if (card.materialSpecs)       lines.push(`  Materials: ${card.materialSpecs.brand ?? ''} ${card.materialSpecs.product ?? ''} ${card.materialSpecs.colour ?? ''} | Underlayment: ${card.materialSpecs.underlayment ?? '—'}`)
        if (card.leadStatus)          lines.push(`  Lead status: ${card.leadStatus}`)
        if (card.warrantyType)        lines.push(`  Warranty: ${card.warrantyType}`)
        if (card.currentStageIndex !== undefined) lines.push(`  Current stage: ${card.currentStageIndex}`)
        if (card.notes)               lines.push(`  Notes: ${card.notes}`)
        return { result: card, summary: lines.join('\n') }
      }

      case 'crm_update_job': {
        if (!can('write_job_cards')) throw new Error('Permission denied: write_job_cards')
        const result = await connector.updateJobCard(params.jobId, params.fields ?? {})
        return {
          result,
          summary: `Job card updated — ${result.updatedFields.length} field(s) saved: ${result.updatedFields.join(', ')}`,
        }
      }

      // ── Checklist tools ─────────────────────────────────────────────

      case 'crm_get_checklist': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const cl = await connector.getChecklist(params.jobId, params.stageIndex)
        const lines = [`Checklist for Stage ${cl.stageIndex} — ${cl.stageName} (${cl.completedItems}/${cl.totalItems} complete):`]
        cl.items.forEach(item => {
          lines.push(`  [${item.completed ? '✓' : '☐'}] ${item.label}${item.completedBy ? ` (by ${item.completedBy})` : ''}`)
        })
        if (cl.allComplete) lines.push('\nAll checklist items complete — stage can be marked COMPLETED.')
        return { result: cl, summary: lines.join('\n') }
      }

      case 'crm_mark_checklist_item': {
        if (!can('write_checklists')) throw new Error('Permission denied: write_checklists')
        const res = await connector.markChecklistItem(
          params.jobId,
          params.stageIndex,
          params.itemIndex,
          params.completed !== false,
          params.completedBy ?? `${agentRole} (agent)`,
        )
        const statusMsg = res.allComplete
          ? 'All checklist items are now complete — you may call update_ticket(COMPLETED).'
          : `${res.remainingUncompleted} item(s) still remaining.`
        return {
          result: res,
          summary: `Checklist item ${params.itemIndex} marked ${params.completed !== false ? 'complete' : 'incomplete'}. ${statusMsg}`,
        }
      }

      // ── Document tools ──────────────────────────────────────────────

      case 'crm_attach_document': {
        if (!can('write_documents')) throw new Error('Permission denied: write_documents')
        const res = await connector.attachDocument({
          jobId: params.jobId,
          documentType: params.documentType,
          fileName: params.fileName,
          fileUrl: params.fileUrl,
          uploadedBy: params.uploadedBy ?? `${agentRole} (agent)`,
          stageIndex: params.stageIndex,
          notes: params.notes,
        })
        return {
          result: res,
          summary: `Document attached to job ${params.jobId}: "${params.fileName}" (type: ${params.documentType}, id: ${res.documentId})`,
        }
      }

      case 'crm_get_documents': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const docs = await connector.getDocuments(params.jobId, params.type)
        if (!docs.length) {
          return { result: docs, summary: params.type ? `No ${params.type} documents found on job ${params.jobId}` : `No documents found on job ${params.jobId}` }
        }
        const lines = [`${docs.length} document(s) on job ${params.jobId}:`]
        docs.forEach(d => lines.push(`  - [${d.type}] ${d.fileName} (uploaded ${d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : 'unknown'})`))
        return { result: docs, summary: lines.join('\n') }
      }

      // ── Extended job view ───────────────────────────────────────────

      case 'crm_get_job_full': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const full = await connector.getJobFull(params.jobId)
        const lines: string[] = [`Full job record for job ${params.jobId}:`]
        const c = full.contact ?? {}
        if (c.name)    lines.push(`  Contact: ${c.name} | ${c.email ?? '—'} | ${c.phone ?? '—'}`)
        if (c.address) lines.push(`  Property: ${c.address}, ${c.zip ?? ''}`)
        const j = full.job ?? {}
        lines.push(`  Stage: ${j.currentStageIndex ?? '—'} | Status: ${j.status ?? '—'} | Insured: ${j.isInsured ?? false}`)
        const ins = full.insurance ?? {}
        if (ins.carrier) lines.push(`  Insurance: ${ins.carrier} | Claim: ${ins.claimNumber ?? '—'} | ACV: $${ins.acvAmount ?? 0} | RCV: $${ins.rcvAmount ?? 0}`)
        const fin = full.financials ?? {}
        if (fin.estimateTotal !== undefined) lines.push(`  Financials: Est $${fin.estimateTotal} | Balance Due $${fin.balanceDue ?? 0}`)
        const mat = full.materials ?? {}
        if (mat.brand || mat.product) lines.push(`  Materials: ${mat.brand ?? ''} ${mat.product ?? ''} ${mat.colour ?? ''} | Underlayment: ${mat.underlayment ?? '—'}`)
        if (full.contract?.status) lines.push(`  Contract: ${full.contract.status} (${(full.contract.items ?? []).length} item(s))`)
        if (full.warranty?.type)   lines.push(`  Warranty: ${full.warranty.type}`)
        if (full.notes?.length)    lines.push(`  Notes: ${full.notes.length} note(s)`)
        const fileCount = Object.values(full.files ?? {}).reduce((n: number, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
        if (fileCount) lines.push(`  Files: ${fileCount} file(s) across all categories`)
        return { result: full, summary: lines.join('\n') }
      }

      case 'crm_get_job_timeline': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const timeline = await connector.getJobTimeline(params.jobId)
        if (!timeline.events.length) {
          return { result: timeline, summary: `No timeline events found for job ${params.jobId}` }
        }
        const lines = [`Timeline for job ${params.jobId} — ${timeline.total} event(s):`]
        timeline.events.slice(0, 10).forEach(e =>
          lines.push(`  [${e.type}] ${e.summary?.slice(0, 80) ?? '—'} (${e.timestamp?.slice(0, 10) ?? '—'})`)
        )
        if (timeline.total > 10) lines.push(`  ... and ${timeline.total - 10} more`)
        return { result: timeline, summary: lines.join('\n') }
      }

      case 'crm_get_documents_by_type': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const docs = await connector.getDocumentsByType(params.jobId, params.type, params.includeBase64 ?? false)
        if (!docs.length) {
          return { result: docs, summary: `No "${params.type}" documents found on job ${params.jobId}` }
        }
        const lines = [`${docs.length} "${params.type}" document(s) on job ${params.jobId}:`]
        docs.forEach(d => lines.push(`  - ${d.fileName} | status: ${d.status ?? '—'} | url: ${d.fileUrl ? 'present' : 'null'}`))
        return { result: docs, summary: lines.join('\n') }
      }

      case 'crm_get_financials': {
        if (!can('read_job_cards')) throw new Error('Permission denied: read_job_cards')
        const fin = await connector.getFinancials(params.jobId)
        const lines = [`Financial summary for job ${params.jobId}:`]
        lines.push(`  Estimate Total:    $${fin.estimateTotal ?? 0}`)
        lines.push(`  ACV / RCV:         $${fin.acvAmount ?? 0} / $${fin.rcvAmount ?? 0}`)
        lines.push(`  Depreciation:      $${fin.depreciationHoldback ?? 0}`)
        lines.push(`  Deposit Paid:      $${fin.depositPaid ?? 0}`)
        lines.push(`  Payments Received: $${fin.paymentsReceived ?? 0}`)
        lines.push(`  Balance Due:       $${fin.balanceDue ?? 0}`)
        if (fin.invoices?.length) {
          lines.push(`  Invoices (${fin.invoices.length}):`)
          fin.invoices.forEach(inv => lines.push(`    - #${inv.invoiceId} | ${inv.paidStatus ?? '—'} | $${inv.amount ?? 0} | paid $${inv.paidAmount ?? 0}`))
        }
        return { result: fin, summary: lines.join('\n') }
      }

      // ── Appointment tools ───────────────────────────────────────────

      case 'crm_get_available_slots': {
        if (!can('read_appointments')) throw new Error('Permission denied: read_appointments')
        const slots = await connector.getAvailableSlots(params.jobId, { type: params.type, from: params.from, to: params.to })
        if (!slots.length) {
          return { result: slots, summary: `No available slots found for job ${params.jobId}${params.type ? ` (type: ${params.type})` : ''}` }
        }
        const lines = [`${slots.length} available slot(s) for job ${params.jobId}:`]
        slots.slice(0, 10).forEach(s => lines.push(`  ${s.date} ${s.time} — ${s.inspectorName ?? '—'} (${s.type ?? 'inspection'})`))
        if (slots.length > 10) lines.push(`  ... and ${slots.length - 10} more slots`)
        return { result: slots, summary: lines.join('\n') }
      }

      case 'crm_book_appointment': {
        if (!can('write_appointments')) throw new Error('Permission denied: write_appointments')
        const res = await connector.bookAppointment(params.jobId, {
          type: params.type,
          date: params.date,
          time: params.time,
          assignedTo: params.assignedTo,
          title: params.title,
          priority: params.priority ?? 'Medium',
          status: params.status ?? 'Confirm',
          endTime: params.endTime,
          description: params.description,
        })
        const a: Record<string, any> = res.appointment ?? {}
        return {
          result: res,
          summary: `Appointment booked on job ${params.jobId}: ${a['type'] ?? params.type} on ${a['date'] ?? params.date} at ${a['time'] ?? params.time} — assigned to ${a['description'] ?? params.assignedTo ?? '—'} (id: ${res.appointmentId}, status: ${a['status'] ?? 'Confirm'})`,
        }
      }

      case 'crm_get_crew_availability': {
        if (!can('read_appointments')) throw new Error('Permission denied: read_appointments')
        const crews = await connector.getCrewAvailability(params.jobId, params.startDate, params.endDate)
        if (!crews.length) {
          return { result: crews, summary: `No crew availability data found for job ${params.jobId}` }
        }
        const lines = [`${crews.length} crew(s) available for job ${params.jobId} (${params.startDate} → ${params.endDate}):`]
        crews.forEach(c => lines.push(`  ${c.crewName} (id ${c.crewId}): ${c.availableDates?.length ?? 0} available date(s) — ${(c.availableDates ?? []).slice(0, 3).join(', ')}${(c.availableDates?.length ?? 0) > 3 ? '...' : ''}`))
        return { result: crews, summary: lines.join('\n') }
      }

      case 'crm_get_appointments': {
        if (!can('read_appointments')) throw new Error('Permission denied: read_appointments')
        const appts = await connector.getAppointments(params.jobId, params.type)
        if (!appts.length) {
          return { result: appts, summary: `No appointments found on job ${params.jobId}${params.type ? ` (type: ${params.type})` : ''}` }
        }
        const lines = [`${appts.length} appointment(s) on job ${params.jobId}:`]
        appts.forEach(a => lines.push(`  [${a.type ?? '?'}] ${a.title ?? '—'} | ${a.date ?? '—'} ${a.time ?? '—'} | ${a.status ?? '—'}`))
        return { result: appts, summary: lines.join('\n') }
      }

      default:
        throw new Error(`Unknown CRM tool: ${tool}`)
    }
  }
}
