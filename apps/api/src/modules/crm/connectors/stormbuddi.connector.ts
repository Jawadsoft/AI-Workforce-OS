import axios, { AxiosInstance } from 'axios'
import type { CRMConnector, CRMCustomer, CRMLead, CRMJob, CRMProposal, CRMNote, CRMMaterial } from '../crm.interface'

/**
 * StormBuddi CRM Connector
 * StormBuddi is a roofing-specific CRM at app.stormbuddi.com
 * Uses their REST API (requires API key from Settings → Integrations in StormBuddi)
 */
export class StormBuddiConnector implements CRMConnector {
  name = 'StormBuddi'
  private http: AxiosInstance

  constructor(apiKey: string) {
    this.http = axios.create({
      baseURL: 'https://app.stormbuddy.co/api/agent',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
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
