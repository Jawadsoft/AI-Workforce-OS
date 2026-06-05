export type TaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'REQUIRES_APPROVAL'
  | 'APPROVED'
  | 'COMPLETED'
  | 'FAILED'

export interface Task {
  id: string
  tenantId: string
  agentId: string
  title: string
  description?: string
  status: TaskStatus
  intent: string
  result?: unknown
  requiresApproval: boolean
  approvedBy?: string
  createdAt: string
  updatedAt: string
}

export interface Approval {
  id: string
  tenantId: string
  taskId: string
  task: Task
  requestedBy: string
  reviewedBy?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  notes?: string
  createdAt: string
}
