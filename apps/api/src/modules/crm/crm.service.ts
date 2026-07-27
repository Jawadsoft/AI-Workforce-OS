import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { LaravelCRMConnector } from './connectors/laravel.connector'
import { HubSpotConnector } from './connectors/hubspot.connector'
import { StormBuddiConnector } from './connectors/stormbuddi.connector'
import type { CRMConnector } from './crm.interface'

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name)

  constructor(private readonly prisma: PrismaService) {}

  // ── Connections ──────────────────────────────────────────────────

  findAll(tenantId: string) {
    return this.prisma.cRMConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const conn = await this.prisma.cRMConnection.findFirst({ where: { id, tenantId } })
    if (!conn) throw new NotFoundException('CRM connection not found')
    return conn
  }

  create(tenantId: string, data: {
    provider: string
    name: string
    baseUrl?: string
    apiKey?: string
    config?: any
  }) {
    return this.prisma.cRMConnection.create({
      data: {
        tenantId,
        provider: data.provider as any,
        name: data.name,
        baseUrl: data.baseUrl,
        apiKey: data.apiKey,
        config: data.config ?? {},
        isActive: true,
      },
    })
  }

  update(tenantId: string, id: string, data: Partial<{
    name: string
    baseUrl: string
    apiKey: string
    config: any
    isActive: boolean
  }>) {
    return this.prisma.cRMConnection.updateMany({
      where: { id, tenantId },
      data: data as any,
    })
  }

  remove(tenantId: string, id: string) {
    return this.prisma.cRMConnection.deleteMany({ where: { id, tenantId } })
  }

  // ── Test Connection ───────────────────────────────────────────────

  async testConnection(tenantId: string, id: string): Promise<{ ok: boolean; message: string }> {
    const conn = await this.findOne(tenantId, id)
    try {
      const connector = this.getConnector(conn)
      // Use searchContacts with empty query — safe probe that never triggers ID validation errors
      await connector.searchContacts('').catch((e) => {
        // 404 or empty result means the API is reachable — that's fine
        if (e?.response?.status === 404) return
        throw e
      })
      return { ok: true, message: 'Connection successful' }
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? 'Unknown error'
      return { ok: false, message: `Connection failed: ${msg}` }
    }
  }

  // ── CRM Operations (used by agents) ──────────────────────────────

  async getActiveConnector(tenantId: string): Promise<CRMConnector> {
    const conn = await this.prisma.cRMConnection.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!conn) throw new BadRequestException('No active CRM connection found')
    return this.getConnector(conn)
  }

  async searchContacts(tenantId: string, query: string) {
    try {
      const connector = await this.getActiveConnector(tenantId)
      return (connector as any).searchContacts?.(query) ?? []
    } catch (err: any) {
      this.logger.warn(`CRM search failed: ${err.message}`)
      return []
    }
  }

  async getContact(tenantId: string, id: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getCustomer(id)
  }

  async createNote(tenantId: string, data: { content: string; customerId?: string; jobId?: string }) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.createNote(data)
  }

  async createCRMTask(tenantId: string, data: { title: string; description: string; jobId?: string }) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.createTask(data)
  }

  async updateRecord(tenantId: string, model: string, id: string, payload: Record<string, unknown>) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.updateRecord(model, id, payload)
  }

  // ── Agent Access ──────────────────────────────────────────────────

  async grantAgentAccess(connectionId: string, agentId: string, permissions: string[]) {
    return this.prisma.agentCRMAccess.upsert({
      where: { agentId_connectionId: { agentId, connectionId } },
      update: { permissions },
      create: { agentId, connectionId, permissions },
    })
  }

  async revokeAgentAccess(connectionId: string, agentId: string) {
    return this.prisma.agentCRMAccess.deleteMany({ where: { agentId, connectionId } })
  }

  // ── Private ───────────────────────────────────────────────────────

  // ── Extended CRM operations ───────────────────────────────────────

  async searchLeads(tenantId: string, query: string) {
    try {
      const connector = await this.getActiveConnector(tenantId)
      return connector.searchLeads(query)
    } catch (err: any) {
      this.logger.warn(`CRM searchLeads failed: ${err.message}`)
      return []
    }
  }

  async getJobsByCustomer(tenantId: string, customerId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getJobsByCustomer(customerId)
  }

  async getProposalsByCustomer(tenantId: string, customerId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getProposalsByCustomer(customerId)
  }

  async getNoteHistory(tenantId: string, customerId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getNoteHistory(customerId)
  }

  async getMaterialsList(tenantId: string, jobId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getMaterialsList(jobId)
  }

  async updateLeadStage(tenantId: string, leadId: string, stage: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.updateLeadStage(leadId, stage)
  }

  async getContactByPhone(tenantId: string, phone: string) {
    try {
      const connector = await this.getActiveConnector(tenantId)
      return connector.getContactByPhone(phone)
    } catch { return null }
  }

  async getContactByEmail(tenantId: string, email: string) {
    try {
      const connector = await this.getActiveConnector(tenantId)
      return connector.getContactByEmail(email)
    } catch { return null }
  }

  // ── Job card (full detail) ────────────────────────────────────────

  async getJobIdByLeadId(tenantId: string, leadId: string): Promise<string | null> {
    try {
      const connector = await this.getActiveConnector(tenantId)
      return (connector as any).getJobIdByLeadId?.(leadId) ?? null
    } catch { return null }
  }

  async getJobCard(tenantId: string, jobId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getJobCard(jobId)
  }

  async updateJobCard(tenantId: string, jobId: string, fields: Record<string, unknown>) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.updateJobCard(jobId, fields)
  }

  // ── Checklist ─────────────────────────────────────────────────────

  async getChecklist(tenantId: string, jobId: string, stageIndex: number) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getChecklist(jobId, stageIndex)
  }

  async markChecklistItem(tenantId: string, jobId: string, stageIndex: number, itemIndex: number, completed: boolean, completedBy?: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.markChecklistItem(jobId, stageIndex, itemIndex, completed, completedBy)
  }

  // ── Document management ───────────────────────────────────────────

  async attachDocument(tenantId: string, input: { jobId: string; documentType: string; fileName: string; fileUrl: string; uploadedBy?: string; stageIndex?: number; notes?: string }) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.attachDocument(input)
  }

  async getDocuments(tenantId: string, jobId: string, type?: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getDocuments(jobId, type)
  }

  // ── Extended job view ─────────────────────────────────────────────

  async getJobFull(tenantId: string, jobId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getJobFull(jobId)
  }

  async getJobTimeline(tenantId: string, jobId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getJobTimeline(jobId)
  }

  async getDocumentsByType(tenantId: string, jobId: string, type: string, includeBase64 = false) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getDocumentsByType(jobId, type, includeBase64)
  }

  async getFinancials(tenantId: string, jobId: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getFinancials(jobId)
  }

  // ── Appointments ──────────────────────────────────────────────────

  async getAvailableSlots(tenantId: string, jobId: string, opts?: { type?: string; from?: string; to?: string }) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getAvailableSlots(jobId, opts)
  }

  async bookAppointment(tenantId: string, jobId: string, data: { type: string; date: string; time: string; assignedTo?: string; title?: string; priority?: string; status?: string; endTime?: string; description?: string }) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.bookAppointment(jobId, data)
  }

  async getCrewAvailability(tenantId: string, jobId: string, startDate: string, endDate: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getCrewAvailability(jobId, startDate, endDate)
  }

  async getAppointments(tenantId: string, jobId: string, type?: string) {
    const connector = await this.getActiveConnector(tenantId)
    return connector.getAppointments(jobId, type)
  }

  // ── Private ───────────────────────────────────────────────────────

  private getConnector(conn: any): CRMConnector {
    switch (conn.provider) {
      case 'HUBSPOT':
        return new HubSpotConnector(conn.apiKey)
      case 'STORMBUDDI':
        return new StormBuddiConnector(conn.apiKey)
      case 'LARAVEL':
      default:
        return new LaravelCRMConnector(conn.baseUrl ?? '', conn.apiKey ?? '')
    }
  }
}
