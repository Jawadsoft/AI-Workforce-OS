export type CRMProvider = 'LARAVEL' | 'HUBSPOT' | 'SALESFORCE' | 'ZOHO' | 'JOBNIMBUS' | 'CUSTOM'

export interface CRMConnection {
  id: string
  tenantId: string
  provider: CRMProvider
  name: string
  baseUrl?: string
  isActive: boolean
  createdAt: string
}
