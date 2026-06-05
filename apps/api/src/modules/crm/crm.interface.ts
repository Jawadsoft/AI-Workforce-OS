// ── CRM Data Types ───────────────────────────────────────────────

export interface CRMCustomer {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  company?: string
  tags?: string[]
  createdAt?: string
  [key: string]: unknown
}

export interface CRMLead {
  id: string
  name: string
  email?: string
  phone?: string
  source?: string
  stage: string        // e.g. "New", "Contacted", "Qualified", "Proposal Sent"
  value?: number
  address?: string
  notes?: string
  assignedTo?: string
  createdAt?: string
  lastContactedAt?: string
  [key: string]: unknown
}

export interface CRMJob {
  id: string
  title: string
  status: string       // e.g. "Pending", "In Progress", "Completed"
  customerId: string
  address?: string
  description?: string
  scheduledDate?: string
  completedDate?: string
  assignedTo?: string
  value?: number
  [key: string]: unknown
}

export interface CRMProposal {
  id: string
  title: string
  status: string       // "Draft", "Sent", "Viewed", "Accepted", "Declined"
  customerId: string
  jobId?: string
  value?: number
  sentAt?: string
  expiresAt?: string
  lineItems?: { description: string; qty: number; price: number }[]
  [key: string]: unknown
}

export interface CRMNote {
  id: string
  content: string
  customerId?: string
  jobId?: string
  createdAt?: string
  createdBy?: string
  [key: string]: unknown
}

export interface CRMMaterial {
  id: string
  name: string
  quantity: number
  unit?: string
  unitPrice?: number
  supplier?: string
  status?: string      // "Ordered", "Delivered", "Pending"
  [key: string]: unknown
}

// ── Connector Interface ───────────────────────────────────────────

export interface CRMConnector {
  name: string

  // ── Customers ──────────────────────────────────────────
  getCustomer(id: string): Promise<CRMCustomer>
  searchContacts(query: string): Promise<CRMCustomer[]>
  getContactByPhone(phone: string): Promise<CRMCustomer | null>
  getContactByEmail(email: string): Promise<CRMCustomer | null>

  // ── Leads ───────────────────────────────────────────────
  getLead(id: string): Promise<CRMLead>
  searchLeads(query: string): Promise<CRMLead[]>
  updateLeadStage(id: string, stage: string): Promise<void>

  // ── Jobs ────────────────────────────────────────────────
  getJob(id: string): Promise<CRMJob>
  getJobsByCustomer(customerId: string): Promise<CRMJob[]>

  // ── Proposals ───────────────────────────────────────────
  getProposal(id: string): Promise<CRMProposal>
  getProposalsByCustomer(customerId: string): Promise<CRMProposal[]>

  // ── Notes ───────────────────────────────────────────────
  createNote(data: { content: string; customerId?: string; jobId?: string }): Promise<{ id: string }>
  getNoteHistory(customerId: string): Promise<CRMNote[]>

  // ── Tasks ───────────────────────────────────────────────
  createTask(data: { title: string; description: string; jobId?: string; customerId?: string; dueDate?: string }): Promise<{ id: string }>

  // ── Materials ───────────────────────────────────────────
  getMaterialsList(jobId: string): Promise<CRMMaterial[]>

  // ── Documents ───────────────────────────────────────────
  uploadDocument(data: { name: string; url: string; jobId?: string; customerId?: string }): Promise<{ id: string }>

  // ── Generic update ──────────────────────────────────────
  updateRecord(model: string, id: string, data: Record<string, unknown>): Promise<void>
}

// ── CRM Context (injected into agent prompt) ──────────────────────

export interface CRMContext {
  customer?: CRMCustomer | null
  lead?: CRMLead | null
  openJobs?: CRMJob[]
  recentNotes?: CRMNote[]
  pendingProposals?: CRMProposal[]
}

// ── Agent CRM Permissions ─────────────────────────────────────────

export const CRM_PERMISSIONS = {
  READ_LEADS: 'read_leads',
  UPDATE_LEADS: 'update_leads',
  READ_CUSTOMERS: 'read_customers',
  READ_JOBS: 'read_jobs',
  READ_PROPOSALS: 'read_proposals',
  READ_MATERIALS: 'read_materials',
  READ_NOTES: 'read_notes',
  WRITE_NOTES: 'write_notes',
  CREATE_TASKS: 'create_tasks',
  UPDATE_RECORDS: 'update_records',
} as const

// ── Industry → CRM defaults ───────────────────────────────────────
// When a tenant's Brain detects an industry, these defaults are applied
// to all agents of matching roles automatically.

export interface IndustryCRMDefaults {
  label: string
  recommendedCRM: string[]
  defaultTools: string[]
  agentRoleDefaults: Record<string, string[]>
  workflow: string
}

export const INDUSTRY_CRM_DEFAULTS: Record<string, IndustryCRMDefaults> = {
  ROOFING: {
    label: 'Roofing & Storm Damage',
    recommendedCRM: ['STORMBUDDI', 'JOBNIMBUS', 'CUSTOM'],
    defaultTools: ['crm_search_leads', 'crm_get_lead_stats', 'crm_get_jobs', 'crm_get_proposals', 'crm_create_note', 'crm_create_task', 'crm_update_lead', 'crm_update', 'crm_search_contacts'],
    workflow: 'Lead -> Inspection -> Estimate -> Insurance Claim -> Job -> Invoice',
    agentRoleDefaults: {
      'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
      'Inspector': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Insurance Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  HVAC: {
    label: 'HVAC & Home Services',
    recommendedCRM: ['JOBNIMBUS', 'LARAVEL', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_get_jobs', 'crm_create_task', 'crm_create_note', 'crm_update', 'crm_update_record'],
    workflow: 'Contact -> Quote -> Schedule -> Job -> Invoice -> Follow-up',
    agentRoleDefaults: {
      'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
    },
  },
  CLEANING: {
    label: 'Cleaning Services',
    recommendedCRM: ['LARAVEL', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_get_jobs', 'crm_create_task', 'crm_create_note', 'crm_update', 'crm_update_record'],
    workflow: 'Inquiry -> Quote -> Schedule -> Job -> Invoice -> Review',
    agentRoleDefaults: {
      'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Project Coordinator': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Executive Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  SECURITY: {
    label: 'Security Services',
    recommendedCRM: ['SALESFORCE', 'ZOHO', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_search_leads', 'crm_get_lead_stats', 'crm_get_proposals', 'crm_get_jobs', 'crm_create_note', 'crm_create_task', 'crm_update_lead', 'crm_update'],
    workflow: 'Lead -> Site Survey -> Proposal -> Contract -> Install -> Monitoring',
    agentRoleDefaults: {
      'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Inspector': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Insurance Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes'],
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes'],
    },
  },
  REAL_ESTATE: {
    label: 'Real Estate',
    recommendedCRM: ['HUBSPOT', 'SALESFORCE', 'CUSTOM'],
    defaultTools: ['crm_search_leads', 'crm_get_lead_stats', 'crm_update_lead', 'crm_get_proposals', 'crm_create_note', 'crm_create_task', 'crm_update'],
    workflow: 'Lead -> Qualify -> Property Show -> Offer -> Close -> Follow-up',
    agentRoleDefaults: {
      'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Lead Qualification Assistant': ['read_leads', 'update_leads', 'read_notes', 'write_notes', 'create_tasks'],
      'Receptionist': ['read_customers', 'read_leads', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  INSURANCE: {
    label: 'Insurance',
    recommendedCRM: ['SALESFORCE', 'HUBSPOT', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_get_jobs', 'crm_get_proposals', 'crm_create_note', 'crm_create_task', 'crm_update'],
    workflow: 'Claim -> Assessment -> Proposal -> Negotiation -> Settlement',
    agentRoleDefaults: {
      'Insurance Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
      'Executive Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  HUMAN_RESOURCES: {
    label: 'Human Resources & Staffing',
    recommendedCRM: ['HUBSPOT', 'ZOHO', 'CUSTOM'],
    defaultTools: ['crm_search_leads', 'crm_get_lead_stats', 'crm_search_contacts', 'crm_update_lead', 'crm_create_note', 'crm_create_task', 'crm_get_proposals'],
    workflow: 'Candidate -> Screen -> Interview -> Offer -> Place -> Invoice',
    agentRoleDefaults: {
      'Lead Qualification Assistant': ['read_leads', 'update_leads', 'read_notes', 'write_notes', 'create_tasks'],
      'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
      'Executive Assistant': ['read_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  LANDSCAPING: {
    label: 'Landscaping & Lawn Care',
    recommendedCRM: ['LARAVEL', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_get_jobs', 'crm_get_proposals', 'crm_create_task', 'crm_create_note', 'crm_update'],
    workflow: 'Quote -> Schedule -> Job -> Invoice -> Seasonal Renewal',
    agentRoleDefaults: {
      'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
      'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  PEST_CONTROL: {
    label: 'Pest Control',
    recommendedCRM: ['LARAVEL', 'CUSTOM'],
    defaultTools: ['crm_search_contacts', 'crm_get_jobs', 'crm_get_materials', 'crm_create_note', 'crm_create_task', 'crm_update'],
    workflow: 'Inquiry -> Inspection -> Treatment Plan -> Job -> Follow-up',
    agentRoleDefaults: {
      'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Inspector': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
      'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
  CONSTRUCTION: {
    label: 'Construction',
    recommendedCRM: ['JOBNIMBUS', 'SALESFORCE', 'CUSTOM'],
    defaultTools: ['crm_search_leads', 'crm_search_contacts', 'crm_get_jobs', 'crm_get_proposals', 'crm_get_materials', 'crm_create_note', 'crm_create_task', 'crm_update_lead', 'crm_update'],
    workflow: 'Lead -> Bid -> Contract -> Build -> Inspection -> Close',
    agentRoleDefaults: {
      'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
      'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
      'Inspector': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
      'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
    },
  },
}

// Default permissions per agent role
export const ROLE_CRM_PERMISSIONS: Record<string, string[]> = {
  'Receptionist': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
  'Sales Assistant': ['read_leads', 'update_leads', 'read_customers', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
  'Estimator': ['read_customers', 'read_jobs', 'read_proposals', 'read_materials', 'read_notes', 'write_notes'],
  'Inspector': ['read_customers', 'read_jobs', 'read_notes', 'write_notes', 'create_tasks'],
  'Insurance Assistant': ['read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
  'Executive Assistant': ['read_leads', 'read_customers', 'read_jobs', 'read_proposals', 'read_notes', 'write_notes', 'create_tasks'],
  'Lead Qualification Assistant': ['read_leads', 'update_leads', 'read_notes', 'write_notes', 'create_tasks'],
  'Marketing Assistant': ['read_leads', 'read_notes'],
  'Project Coordinator': ['read_customers', 'read_jobs', 'read_materials', 'read_notes', 'write_notes', 'create_tasks'],
  'Procurement Assistant': ['read_jobs', 'read_materials', 'create_tasks'],
}
