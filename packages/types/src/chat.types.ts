export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM'

export interface ChatMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface Conversation {
  id: string
  tenantId: string
  agentId: string
  userId: string
  messages: ChatMessage[]
  createdAt: string
}
