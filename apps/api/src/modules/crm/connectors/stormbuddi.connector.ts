import axios, { AxiosInstance } from 'axios'
import type { CRMConnector, CRMCustomer, CRMLead, CRMJob, CRMProposal, CRMNote, CRMMaterial, CRMJobCard, CRMChecklist, CRMDocument } from '../crm.interface'

/**
 * StormBuddi CRM Connector
 * StormBuddi is a roofing-specific CRM at app.stormbuddy.co
 * Uses their REST API (requires API key from Settings → Integrations in StormBuddi)
 */
export class StormBuddiConnector implements CRMConnector {
  name = 'StormBuddi'
  private http: AxiosInstance
  private httpCrm: AxiosInstance

  constructor(apiKey: string) {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    this.http = axios.create({ baseURL: 'https://app.stormbuddy.co/api/agent', headers })
    this.httpCrm = axios.create({ baseURL: 'https://app.stormbuddy.co/api/crm', headers })
  }

  // ── Customers ────────────────────────────────────────────────────

  async getCustomer(id: string): Promise<CRMCustomer> {
    const { data } = await this.http.get(`/contacts/${id}`)
    return this.mapContact(data?.data ?? data)
  }

  async searchContacts(query: string): Promise<CRMCustomer[]> {
    const { data } = await this.http.get('/contacts', { params: { search: query || undefined, per_page: 50 } })
    const list = data?.data ?? data ?? []
    return list.map((c: any) => this.mapContact(c))
  }

  async getContactByPhone(phone: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.get('/contacts', { params: { phone, per_page: 1 } })
      const list = data?.data ?? data ?? []
      return list.length ? this.mapContact(list[0]) : null
    } catch { return null }
  }

  async getContactByEmail(email: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.get('/contacts', { params: { email, per_page: 1 } })
      const list = data?.data ?? data ?? []
      return list.length ? this.mapContact(list[0]) : null
    } catch { return null }
  }

  // ── Leads ─────────────────────────────────────────────────────────

  async getLead(id: string): Promise<CRMLead> {
    const { data } = await this.http.get(`/leads/${id}`)
    return this.mapLead(data?.data ?? data)
  }

  async searchLeads(query: string, stage?: string): Promise<CRMLead[]> {
    const params: any = { per_page: 100 }
    if (query) params.search = query
    if (stage) params.status = stage
    const { data } = await this.http.get('/leads', { params })
    const list = data?.data ?? data ?? []
    return list.map((l: any) => this.mapLead(l))
  }

  async updateLeadStage(id: string, stage: string): Promise<void> {
    await this.http.patch(`/leads/${id}`, { status: stage })
  }

  /** Resolve the CRM job ID for a given lead ID.
   *  The Stormbuddy lead response includes job_id directly — no second API call needed. */
  async getJobIdByLeadId(leadId: string): Promise<string | null> {
    try {
      const { data } = await this.http.get(`/leads/${leadId}`)
      const lead = data?.data ?? data
      const jobId = lead?.job_id ?? lead?.jobId
      return jobId != null ? String(jobId) : null
    } catch { return null }
  }

  // ── Jobs (called "Claims" or "Projects" in StormBuddi) ─────────────

  async getJob(id: string): Promise<CRMJob> {
    const { data } = await this.http.get(`/jobs/${id}`)
    return this.mapJob(data?.data ?? data)
  }

  async getJobsByCustomer(customerId: string): Promise<CRMJob[]> {
    try {
      const { data } = await this.http.get('/jobs', { params: { contact_id: customerId, per_page: 5 } })
      const list = data?.data ?? data ?? []
      return list.map((j: any) => this.mapJob(j))
    } catch { return [] }
  }

  // ── Proposals / Estimates ─────────────────────────────────────────

  async getProposal(id: string): Promise<CRMProposal> {
    const { data } = await this.http.get(`/estimates/${id}`)
    return this.mapProposal(data?.data ?? data)
  }

  async getProposalsByCustomer(customerId: string): Promise<CRMProposal[]> {
    try {
      const { data } = await this.http.get('/estimates', { params: { contact_id: customerId, per_page: 5 } })
      const list = data?.data ?? data ?? []
      return list.map((p: any) => this.mapProposal(p))
    } catch { return [] }
  }

  // ── Notes ─────────────────────────────────────────────────────────

  async createNote(input: { content: string; customerId?: string; jobId?: string }): Promise<{ id: string }> {
    const payload: any = { body: input.content, type: 'note' }
    if (input.customerId) payload.contact_id = input.customerId
    if (input.jobId) payload.job_id = input.jobId
    const { data } = await this.http.post('/notes', payload)
    return { id: (data?.data ?? data)?.id }
  }

  async getNoteHistory(customerId: string): Promise<CRMNote[]> {
    try {
      const { data } = await this.http.get('/notes', { params: { contact_id: customerId, per_page: 5 } })
      const list = data?.data ?? data ?? []
      return list.map((n: any) => ({
        id: n.id,
        content: n.body ?? n.content ?? '',
        customerId,
        createdAt: n.created_at,
        createdBy: n.user?.name ?? n.created_by,
      } as CRMNote))
    } catch { return [] }
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  async createTask(input: { title: string; description: string; jobId?: string; customerId?: string; dueDate?: string }): Promise<{ id: string }> {
    const payload: any = {
      title: input.title,
      description: input.description,
      due_date: input.dueDate,
    }
    if (input.customerId) payload.contact_id = input.customerId
    if (input.jobId) payload.job_id = input.jobId
    const { data } = await this.http.post('/tasks', payload)
    return { id: (data?.data ?? data)?.id }
  }

  // ── Materials ─────────────────────────────────────────────────────

  async getMaterialsList(jobId: string): Promise<CRMMaterial[]> {
    try {
      const { data } = await this.http.get(`/jobs/${jobId}/materials`)
      const list = data?.data ?? data ?? []
      return list.map((m: any) => ({
        id: m.id,
        name: m.name ?? m.product_name ?? '',
        quantity: m.quantity ?? 1,
        unit: m.unit ?? 'unit',
        unitPrice: m.unit_price ?? m.price ?? 0,
        status: m.status,
      } as CRMMaterial))
    } catch { return [] }
  }

  // ── Documents ─────────────────────────────────────────────────────

  async uploadDocument(input: { name: string; url: string; jobId?: string; customerId?: string }): Promise<{ id: string }> {
    const payload: any = { name: input.name, url: input.url }
    if (input.customerId) payload.contact_id = input.customerId
    if (input.jobId) payload.job_id = input.jobId
    const { data } = await this.http.post('/documents', payload)
    return { id: (data?.data ?? data)?.id }
  }

  // ── Generic update ────────────────────────────────────────────────

  async updateRecord(model: string, id: string, payload: Record<string, unknown>): Promise<void> {
    await this.http.patch(`/${model}/${id}`, payload)
  }

  // ── Job card (full detail) ────────────────────────────────────────

  async getJobCard(jobId: string): Promise<CRMJobCard> {
    const { data } = await this.httpCrm.post(`/get-job/${jobId}`, {})
    const d = data?.data ?? data
    return {
      jobId: d.jobId ?? d.job_id ?? jobId,
      leadId: d.leadId ?? d.lead_id,
      contactName: d.contactName ?? d.contact_name ?? d.customer_name,
      contactEmail: d.contactEmail ?? d.contact_email ?? d.email,
      contactPhone: d.contactPhone ?? d.contact_phone ?? d.phone,
      propertyAddress: d.propertyAddress ?? d.property_address ?? d.address,
      propertyZip: d.propertyZip ?? d.property_zip ?? d.zip,
      insuranceCarrier: d.insuranceCarrier ?? d.insurance_carrier,
      policyNumber: d.policyNumber ?? d.policy_number,
      claimNumber: d.claimNumber ?? d.claim_number,
      claimReferenceNumber: d.claimReferenceNumber ?? d.claim_reference_number,
      stormEventDate: d.stormEventDate ?? d.storm_event_date,
      noaaEventId: d.noaaEventId ?? d.noaa_event_id,
      damageType: d.damageType ?? d.damage_type,
      damageSeverity: d.damageSeverity ?? d.damage_severity,
      hailSizeInches: d.hailSizeInches ?? d.hail_size_inches,
      estimateTotal: d.estimateTotal ?? d.estimate_total,
      acvAmount: d.acvAmount ?? d.acv_amount,
      rcvAmount: d.rcvAmount ?? d.rcv_amount,
      depreciationHoldback: d.depreciationHoldback ?? d.depreciation_holdback,
      depositPaid: d.depositPaid ?? d.deposit_paid,
      balanceOwing: d.balanceOwing ?? d.balance_owing,
      inspectionDate: d.inspectionDate ?? d.inspection_date,
      installationDate: d.installationDate ?? d.installation_date,
      materialDeliveryDate: d.materialDeliveryDate ?? d.material_delivery_date,
      permitNumber: d.permitNumber ?? d.permit_number,
      poNumber: d.poNumber ?? d.po_number,
      contractorLicenceNumber: d.contractorLicenceNumber ?? d.contractor_licence_number,
      materialSpecs: d.materialSpecs ?? d.material_specs,
      leadStatus: d.leadStatus ?? d.lead_status ?? d.status,
      warrantyType: d.warrantyType ?? d.warranty_type,
      profitability: d.profitability,
      googleReviewLink: d.googleReviewLink ?? d.google_review_link,
      currentStageIndex: d.currentStageIndex ?? d.current_stage_index,
      notes: d.notes,
    }
  }

  async updateJobCard(jobId: string, fields: Partial<CRMJobCard>): Promise<{ success: boolean; updatedFields: string[] }> {
    try {
      const { data } = await this.httpCrm.post(`/update-job/${jobId}`, { fields })
      const d = data?.data ?? data
      return {
        success: d.success ?? true,
        updatedFields: d.updatedFields ?? d.updated_fields ?? Object.keys(fields),
      }
    } catch (err: any) {
      const status = err?.response?.status
      const body = err?.response?.data
      const detail = body?.message ?? body?.error
        ?? (body?.errors ? JSON.stringify(body.errors) : null)
        ?? (typeof body === 'string' ? body : body ? JSON.stringify(body) : err.message)
      throw new Error(`CRM update-job failed (${status ?? 'network'}): ${detail}`)
    }
  }

  // ── Checklist ─────────────────────────────────────────────────────

  async getChecklist(jobId: string, stageIndex: number): Promise<CRMChecklist> {
    const { data } = await this.httpCrm.post(`/get-checklist/${jobId}`, { stageIndex })
    const d = data?.data ?? data
    const items = (d.items ?? []).map((it: any) => ({
      index: it.index,
      label: it.label,
      completed: it.completed ?? false,
      completedBy: it.completedBy ?? it.completed_by ?? null,
      completedAt: it.completedAt ?? it.completed_at ?? null,
    }))
    const completedItems = items.filter((i: any) => i.completed).length
    return {
      jobId,
      stageIndex,
      stageName: d.stageName ?? d.stage_name ?? `Stage ${stageIndex}`,
      items,
      totalItems: items.length,
      completedItems,
      allComplete: completedItems === items.length && items.length > 0,
    }
  }

  async markChecklistItem(jobId: string, stageIndex: number, itemIndex: number, completed: boolean, completedBy?: string): Promise<{ success: boolean; remainingUncompleted: number; allComplete: boolean }> {
    const { data } = await this.httpCrm.post(`/mark-checklist-item/${jobId}`, {
      stageIndex,
      itemIndex,
      completed,
      completedBy: completedBy ?? 'agent',
      completedAt: new Date().toISOString(),
    })
    const d = data?.data ?? data
    return {
      success: d.success ?? true,
      remainingUncompleted: d.remainingUncompleted ?? d.remaining_uncompleted ?? 0,
      allComplete: d.allComplete ?? d.all_complete ?? false,
    }
  }

  // ── Document management ───────────────────────────────────────────

  async attachDocument(input: { jobId: string; documentType: string; fileName: string; fileUrl: string; uploadedBy?: string; stageIndex?: number; notes?: string }): Promise<{ success: boolean; documentId: string; fileUrl: string }> {
    const { data } = await this.httpCrm.post(`/attach-document/${input.jobId}`, {
      documentType: input.documentType,
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      uploadedBy: input.uploadedBy ?? 'agent',
      stageIndex: input.stageIndex,
      notes: input.notes,
    })
    const d = data?.data ?? data
    return {
      success: d.success ?? true,
      documentId: d.documentId ?? d.document_id ?? d.id,
      fileUrl: d.fileUrl ?? d.file_url ?? input.fileUrl,
    }
  }

  async getDocuments(jobId: string, type?: string): Promise<CRMDocument[]> {
    const body: any = {}
    if (type) body.type = type
    const { data } = await this.httpCrm.post(`/get-documents/${jobId}`, body)
    const list = data?.documents ?? data?.data ?? data ?? []
    return list.map((doc: any) => ({
      documentId: doc.documentId ?? doc.document_id ?? doc.id,
      type: doc.type ?? doc.documentType ?? doc.document_type,
      fileName: doc.fileName ?? doc.file_name,
      fileUrl: doc.fileUrl ?? doc.file_url,
      uploadedBy: doc.uploadedBy ?? doc.uploaded_by,
      uploadedAt: doc.uploadedAt ?? doc.uploaded_at ?? doc.created_at,
      stageIndex: doc.stageIndex ?? doc.stage_index,
      notes: doc.notes,
    } as CRMDocument))
  }

  // ── Private mappers ───────────────────────────────────────────────

  private mapContact(c: any): CRMCustomer {
    return {
      id: c.id,
      name: c.full_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() ?? c.name ?? '',
      email: c.email,
      phone: c.phone ?? c.mobile_phone ?? c.cell_phone,
      address: c.address ?? [c.address_line1, c.city, c.state].filter(Boolean).join(', '),
      company: c.company_name ?? c.company,
    }
  }

  private mapLead(l: any): CRMLead {
    // StormBuddi API returns 'customer_name' on leads (not full_name/name/first+last)
    const name = l.customer_name ?? l.full_name ?? l.name
      ?? `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim()
      ?? `Lead #${l.id}`
    // Address can be a string (leads) or an object (contacts)
    const address = typeof l.address === 'string'
      ? l.address
      : l.address?.street ?? [l.address?.city, l.address?.state].filter(Boolean).join(', ') ?? ''
    return {
      id: l.id,
      name,
      email: l.email,
      phone: l.phone ?? l.mobile_phone,
      stage: l.stage ?? l.status ?? 'New',
      source: l.source ?? l.lead_source,
      value: l.estimated_value ?? l.value,
      address,
      createdAt: l.created_at ?? l.createdAt,
      lastContactedAt: l.last_contacted_at ?? l.follow_up_date,
      jobId: l.job_id != null ? String(l.job_id) : (l.jobId != null ? String(l.jobId) : undefined),
    }
  }

  private mapJob(j: any): CRMJob {
    return {
      id: j.id,
      title: j.title ?? j.name ?? `Job #${j.id}`,
      status: j.status ?? 'Open',
      customerId: j.contact_id ?? j.customer_id ?? '',
      address: j.address ?? j.property_address,
      value: j.total_amount ?? j.claim_amount ?? j.value,
      scheduledDate: j.scheduled_date ?? j.start_date,
      description: j.description ?? j.scope_of_work,
    }
  }

  private mapProposal(p: any): CRMProposal {
    return {
      id: p.id,
      title: p.title ?? p.name ?? `Estimate #${p.id}`,
      status: p.status ?? 'Draft',
      customerId: p.contact_id ?? p.customer_id ?? '',
      value: p.total ?? p.amount ?? p.total_amount,
      sentAt: p.sent_at ?? p.created_at,
      expiresAt: p.expires_at,
    }
  }
}
