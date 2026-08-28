'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Node, Edge } from '@xyflow/react'

export interface HierarchyNodeData extends Record<string, unknown> {
  type: 'staff' | 'agent'
  label: string
  designation?: string
  department?: string
  avatar?: string
  role?: string
  managerId?: string
  supervisorUserId?: string
}

export interface EscalationRule {
  id?: string
  agentId: string
  agentName?: string
  trigger: string
  triggerLabel: string
  action?: string
  targetUserId?: string
  targetAgentId?: string
  urgency?: string
}

export interface HierarchyResponse {
  layout: {
    nodes: Array<{
      id: string
      type: 'staff' | 'agent'
      label: string
      designation?: string
      department?: string
      avatar?: string
      role?: string
      managerId?: string
      supervisorUserId?: string
      position?: { x: number; y: number }
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      type: 'reports-to' | 'supervises' | 'escalates-to'
    }>
  }
  savedLayout: { nodes: Node[]; edges: Edge[] } | null
  escalationRules: EscalationRule[]
}

export function useHierarchy() {
  return useQuery<HierarchyResponse>({
    queryKey: ['hierarchy'],
    queryFn: () => api.get('/hierarchy').then(r => r.data),
  })
}

export function useSaveHierarchy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      layout: { nodes: Node<HierarchyNodeData>[]; edges: Edge[] }
      nodeUpdates: Array<{
        id: string
        type: 'staff' | 'agent'
        managerId?: string | null
        supervisorUserId?: string | null
        designation?: string
        department?: string
        phone?: string
        position?: { x: number; y: number }
      }>
      escalationRules?: EscalationRule[]
    }) => api.put('/hierarchy', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy'] })
    },
  })
}

export interface AiSuggestResponse {
  reasoning: string
  staffRelationships: Array<{ userId: string; managerId: string | null }>
  agentRelationships: Array<{ agentId: string; supervisorUserId: string }>
  escalationRules: Array<{
    agentId: string
    trigger: string
    triggerLabel: string
    action: string
    targetUserId: string
    urgency: string
  }>
}

export function useAiSuggestHierarchy() {
  return useMutation({
    mutationFn: (customInstructions?: string): Promise<{ data: AiSuggestResponse }> =>
      api.post('/hierarchy/ai-suggest', { customInstructions }),
  })
}

export interface AiRefineResponse {
  summary: string
  staffRelationships: Array<{ userId: string; managerId: string | null }>
  agentRelationships: Array<{ agentId: string; supervisorUserId: string }>
  escalationRules: any[]
}

export function useAiRefineHierarchy() {
  return useMutation({
    mutationFn: (body: {
      instruction: string
      currentNodes: Array<{ id: string; type: string; label: string; designation?: string; managerId?: string; supervisorUserId?: string }>
      currentEdges: Array<{ source: string; target: string; type: string }>
    }): Promise<{ data: AiRefineResponse }> => api.post('/hierarchy/ai-refine', body),
  })
}
