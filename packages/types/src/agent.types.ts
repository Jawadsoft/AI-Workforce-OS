export type AgentStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT'

export type Industry =
  | 'ROOFING'
  | 'CAR_DEALERSHIP'
  | 'CLEANING'
  | 'SECURITY'
  | 'PROPERTY_MANAGEMENT'
  | 'HEALTHCARE'
  | 'CONSTRUCTION'
  | 'REAL_ESTATE'
  | 'OTHER'

export interface Agent {
  id: string
  tenantId: string
  name: string
  role: string
  industry: Industry
  avatar?: string
  prompt: string
  status: AgentStatus
  permissions: string[]
  tools: string[]
  createdAt: string
  updatedAt: string
}

export interface AgentTemplate {
  id: string
  name: string
  role: string
  industry: Industry[]
  description: string
  defaultPrompt: string
  tools: string[]
}
