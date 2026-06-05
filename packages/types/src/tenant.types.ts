export type UserRole = 'SUPER_ADMIN' | 'TENANT_OWNER' | 'TENANT_ADMIN' | 'MANAGER' | 'USER' | 'VIEWER'

export interface Tenant {
  id: string
  name: string
  slug: string
  industry?: string
  createdAt: string
}

export interface User {
  id: string
  tenantId: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  createdAt: string
}
