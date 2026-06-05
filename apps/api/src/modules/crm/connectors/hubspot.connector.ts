import axios, { AxiosInstance } from 'axios'
import type { CRMConnector, CRMCustomer, CRMLead, CRMJob, CRMProposal, CRMNote, CRMMaterial } from '../crm.interface'

export class HubSpotConnector implements CRMConnector {
  name = 'HubSpot'
  private http: AxiosInstance

  constructor(apiKey: string) {
    this.http = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
  }

  // ── Customers ────────────────────────────────────────────────────

  async getCustomer(id: string): Promise<CRMCustomer> {
    const { data } = await this.http.get(`/crm/v3/objects/contacts/${id}`, {
      params: { properties: 'firstname,lastname,email,phone,address,company' },
    })
    return this.mapContact(data)
  }

  async searchContacts(query: string): Promise<CRMCustomer[]> {
    const { data } = await this.http.post('/crm/v3/objects/contacts/search', {
      query,
      limit: 10,
      properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'company'],
    })
    return (data.results ?? []).map((r: any) => this.mapContact(r))
  }

  async getContactByPhone(phone: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/contacts/search', {
        filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'company'],
        limit: 1,
      })
      if (!data.results?.length) return null
      return this.mapContact(data.results[0])
    } catch { return null }
  }

  async getContactByEmail(email: string): Promise<CRMCustomer | null> {
    try {
      const { data } = await this.http.post('/crm/v3/objects/contacts/search', {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'address', 'company'],
        limit: 1,
      })
      if (!data.results?.length) return null
      return this.mapContact(data.results[0])
    } catch { return null }
  }

  // ── Leads (HubSpot = Contacts with lifecycle stage) ──────────────

  async getLead(id: string): Promise<CRMLead> {
    const { data } = await this.http.get(`/crm/v3/objects/contacts/${id}`, {
      params: { properties: 'firstname,lastname,email,phone,hs_lead_status,lifecyclestage,amount,hs_analytics_source,notes_last_updated' },
    })
    return this.mapLead(data)
  }

  async searchLeads(query: string): Promise<CRMLead[]> {
    const { data } = await this.http.post('/crm/v3/objects/contacts/search', {
      query,
      filters: [{ propertyName: 'lifecyclestage', operator: 'IN', values: ['lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity'] }],
      properties: ['firstname', 'lastname', 'email', 'phone', 'hs_lead_status', 'lifecyclestage', 'amount', 'hs_analytics_source'],
      limit: 10,
    })
    return (data.results ?? []).map((r: any) => this.mapLead(r))
  }

  async updateLeadStage(id: string, stage: string): Promise<void> {
    await this.http.patch(`/crm/v3/objects/contacts/${id}`, {
      properties: { lifecyclestage: stage.toLowerCase(), hs_lead_status: stage },
    })
  }

  // ── Jobs (HubSpot = Deals) ────────────────────────────────────────

  async getJob(id: string): Promise<CRMJob> {
    const { data } = await this.http.get(`/crm/v3/objects/deals/${id}`, {
      params: { properties: 'dealname,dealstage,amount,closedate,description,hs_deal_stage_probability' },
    })
    return this.mapJob(data)
  }

  async getJobsByCustomer(customerId: string): Promise<CRMJob[]> {
    try {
      const { data } = await this.http.get(`/crm/v3/objects/contacts/${customerId}/associations/deals`)
      const dealIds: string[] = (data.results ?? []).map((r: any) => r.id)
      if (!dealIds.length) return []
      const deals = await Promise.all(dealIds.slice(0, 5).map((id) => this.getJob(id).catch(() => null)))
      return deals.filter(Boolean) as CRMJob[]
    } catch { return [] }
  }

  // ── Proposals (HubSpot = Deals with proposal stage) ──────────────

  async getProposal(id: string): Promise<CRMProposal> {
    const { data } = await this.http.get(`/crm/v3/objects/deals/${id}`, {
      params: { properties: 'dealname,dealstage,amount,closedate,hs_date_entered_proposalmade' },
    })
    return {
      id: data.id,
      title: data.properties.dealname,
      status: data.properties.dealstage,
      customerId: '',
      value: parseFloat(data.properties.amount ?? 0),
      sentAt: data.properties.hs_date_entered_proposalmade,
      expiresAt: data.properties.closedate,
    }
  }

  async getProposalsByCustomer(customerId: string): Promise<CRMProposal[]> {
    try {
      const jobs = await this.getJobsByCustomer(customerId)
      return jobs
        .filter(j => ['proposal', 'presentationscheduled', 'proposalmade', 'contractsent'].some(s => j.status?.toLowerCase().includes(s)))
        .map(j => ({
          id: j.id,
          title: j.title,
          status: j.status,
          customerId,
          value: j.value,
        }))
    } catch { return [] }
  }

  // ── Notes ─────────────────────────────────────────────────────────

  async createNote(input: { content: string; customerId?: string; jobId?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/crm/v3/objects/notes', {
      properties: { hs_note_body: input.content, hs_timestamp: new Date().toISOString() },
    })
    // Associate with contact if provided
    if (input.customerId) {
      await this.http.put(`/crm/v3/objects/notes/${data.id}/associations/contacts/${input.customerId}/202`).catch(() => {})
    }
    return { id: data.id }
  }

  async getNoteHistory(customerId: string): Promise<CRMNote[]> {
    try {
      const { data } = await this.http.get(`/crm/v3/objects/contacts/${customerId}/associations/notes`)
      const noteIds: string[] = (data.results ?? []).map((r: any) => r.id).slice(0, 5)
      if (!noteIds.length) return []
      const notes = await Promise.all(noteIds.map(async (id) => {
        const { data: n } = await this.http.get(`/crm/v3/objects/notes/${id}`, {
          params: { properties: 'hs_note_body,hs_timestamp,hs_created_by' },
        })
        return {
          id: n.id,
          content: n.properties.hs_note_body ?? '',
          customerId,
          createdAt: n.properties.hs_timestamp,
          createdBy: n.properties.hs_created_by,
        } as CRMNote
      }))
      return notes.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    } catch { return [] }
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  async createTask(input: { title: string; description: string; jobId?: string; customerId?: string; dueDate?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/crm/v3/objects/tasks', {
      properties: {
        hs_task_subject: input.title,
        hs_task_body: input.description,
        hs_task_status: 'NOT_STARTED',
        hs_task_type: 'TODO',
        hs_timestamp: input.dueDate ?? new Date(Date.now() + 86400000).toISOString(),
      },
    })
    if (input.customerId) {
      await this.http.put(`/crm/v3/objects/tasks/${data.id}/associations/contacts/${input.customerId}/216`).catch(() => {})
    }
    return { id: data.id }
  }

  // ── Materials (HubSpot = Line Items on deals) ─────────────────────

  async getMaterialsList(jobId: string): Promise<CRMMaterial[]> {
    try {
      const { data } = await this.http.get(`/crm/v3/objects/deals/${jobId}/associations/line_items`)
      const ids: string[] = (data.results ?? []).map((r: any) => r.id).slice(0, 20)
      if (!ids.length) return []
      const items = await Promise.all(ids.map(async (id) => {
        const { data: li } = await this.http.get(`/crm/v3/objects/line_items/${id}`, {
          params: { properties: 'name,quantity,price,hs_sku,description' },
        })
        return {
          id: li.id,
          name: li.properties.name ?? '',
          quantity: parseFloat(li.properties.quantity ?? 1),
          unitPrice: parseFloat(li.properties.price ?? 0),
          unit: 'unit',
        } as CRMMaterial
      }))
      return items
    } catch { return [] }
  }

  // ── Documents ─────────────────────────────────────────────────────

  async uploadDocument(input: { name: string; url: string; jobId?: string; customerId?: string }): Promise<{ id: string }> {
    const { data } = await this.http.post('/crm/v3/objects/notes', {
      properties: {
        hs_note_body: `Document: ${input.name}\n${input.url}`,
        hs_timestamp: new Date().toISOString(),
      },
    })
    return { id: data.id }
  }

  // ── Generic update ────────────────────────────────────────────────

  async updateRecord(model: string, id: string, payload: Record<string, unknown>): Promise<void> {
    await this.http.patch(`/crm/v3/objects/${model}/${id}`, { properties: payload })
  }

  // ── Private mappers ───────────────────────────────────────────────

  private mapContact(r: any): CRMCustomer {
    return {
      id: r.id,
      name: `${r.properties?.firstname ?? ''} ${r.properties?.lastname ?? ''}`.trim() || r.properties?.email,
      email: r.properties?.email,
      phone: r.properties?.phone,
      address: r.properties?.address,
      company: r.properties?.company,
    }
  }

  private mapLead(r: any): CRMLead {
    return {
      id: r.id,
      name: `${r.properties?.firstname ?? ''} ${r.properties?.lastname ?? ''}`.trim(),
      email: r.properties?.email,
      phone: r.properties?.phone,
      stage: r.properties?.hs_lead_status ?? r.properties?.lifecyclestage ?? 'New',
      source: r.properties?.hs_analytics_source,
      lastContactedAt: r.properties?.notes_last_updated,
    }
  }

  private mapJob(r: any): CRMJob {
    return {
      id: r.id,
      title: r.properties?.dealname ?? 'Unnamed deal',
      status: r.properties?.dealstage ?? 'unknown',
      customerId: '',
      value: parseFloat(r.properties?.amount ?? 0),
      scheduledDate: r.properties?.closedate,
      description: r.properties?.description,
    }
  }
}
