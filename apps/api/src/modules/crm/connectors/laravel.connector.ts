import axios, { AxiosInstance } from 'axios'
import type { CRMConnector, CRMCustomer, CRMLead, CRMJob, CRMProposal, CRMNote, CRMMaterial } from '../crm.interface'

export class LaravelCRMConnector implements CRMConnector {
  name = 'Laravel CRM'
  private http: AxiosInstance

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
  }

  // ── Customers ────────────────────────────────────────────────────

  async getCustomer(id: string): Promise<CRMCustomer> {
    const { data } = await this.http.get(`/api/customers/${id}`)
    return data
  }

  async searchContacts(query: string): Promise<CRMCustomer[]> {
    const { data } = await this.http.get('/api/customers', { params: { search: query, limit: 10 } })
    return data?.data ?? data ?? []
  }

  async getContactByPhone(phone: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.get('/api/customers', { params: { phone, limit: 1 } })
      const list = data?.data ?? data ?? []
      return list[0] ?? null
    } catch { return null }
  }

  async getContactByEmail(email: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.get('/api/customers', { params: { email, limit: 1 } })
      const list = data?.data ?? data ?? []
      return list[0] ?? null
    } catch { return null }
  }

  // ── Leads ─────────────────────────────────────────────────────────

  async getLead(id: string): Promise<CRMLead> {
    const { data } = await this.http.get(`/api/leads/${id}`)
    return data
  }

  async searchLeads(query: string): Promise<CRMLead[]> {
    const { data } = await this.http.get('/api/leads', { params: { search: query, limit: 10 } })
    return data?.data ?? data ?? []
  }

  async updateLeadStage(id: string, stage: string): Promise<void> {
    await this.http.patch(`/api/leads/${id}`, { stage })
  }

  // ── Jobs ──────────────────────────────────────────────────────────

  async getJob(id: string): Promise<CRMJob> {
    const { data } = await this.http.get(`/api/jobs/${id}`)
    return data
  }

  async getJobsByCustomer(customerId: string): Promise<CRMJob[]> {
    try {
      const { data } = await this.http.get('/api/jobs', { params: { customer_id: customerId, limit: 5 } })
      return data?.data ?? data ?? []
    } catch { return [] }
  }

  // ── Proposals ─────────────────────────────────────────────────────

  async getProposal(id: string): Promise<CRMProposal> {
    const { data } = await this.http.get(`/api/proposals/${id}`)
    return data
  }

  async getProposalsByCustomer(customerId: string): Promise<CRMProposal[]> {
    try {
      const { data } = await this.http.get('/api/proposals', { params: { customer_id: customerId, limit: 5 } })
      return data?.data ?? data ?? []
    } catch { return [] }
  }

  // ── Notes ─────────────────────────────────────────────────────────

  async createNote(input: { content: string; customerId?: string; jobId?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/api/notes', input)
    return { id: data.id }
  }

  async getNoteHistory(customerId: string): Promise<CRMNote[]> {
    try {
      const { data } = await this.http.get('/api/notes', { params: { customer_id: customerId, limit: 5 } })
      return data?.data ?? data ?? []
    } catch { return [] }
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  async createTask(input: { title: string; description: string; jobId?: string; customerId?: string; dueDate?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/api/tasks', input)
    return { id: data.id }
  }

  // ── Materials ─────────────────────────────────────────────────────

  async getMaterialsList(jobId: string): Promise<CRMMaterial[]> {
    try {
      const { data } = await this.http.get(`/api/jobs/${jobId}/materials`)
      return data?.data ?? data ?? []
    } catch { return [] }
  }

  // ── Documents ─────────────────────────────────────────────────────

  async uploadDocument(input: { name: string; url: string; jobId?: string; customerId?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/api/documents', input)
    return { id: data.id }
  }

  // ── Generic update ────────────────────────────────────────────────

  async updateRecord(model: string, id: string, payload: Record<string, unknown>): Promise<void> {
    await this.http.patch(`/api/${model}/${id}`, payload)
  }

  // ── Stubs: roofing-specific tools not supported by Laravel connector ─
  async getJobCard(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async updateJobCard(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getChecklist(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async markChecklistItem(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async attachDocument(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getDocuments(): Promise<any[]> { return [] }
  async getJobFull(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getJobTimeline(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getDocumentsByType(): Promise<any[]> { return [] }
  async getFinancials(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getAvailableSlots(): Promise<any[]> { return [] }
  async bookAppointment(): Promise<any> { throw new Error('Not supported by Laravel connector') }
  async getCrewAvailability(): Promise<any[]> { return [] }
  async getAppointments(): Promise<any[]> { return [] }
}
