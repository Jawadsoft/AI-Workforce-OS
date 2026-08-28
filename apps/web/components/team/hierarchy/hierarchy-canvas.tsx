'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { Loader2, Save, LayoutGrid, RefreshCw, Sparkles, X, Send, Bot, ChevronDown, ChevronUp } from 'lucide-react'
import { StaffNode } from './nodes/staff-node'
import { AgentNode } from './nodes/agent-node'
import { ReportsToEdge, SupervisesEdge } from './edges/hierarchy-edge'
import { HierarchySidebar } from './hierarchy-sidebar'
import { useHierarchy, useSaveHierarchy, useAiSuggestHierarchy, useAiRefineHierarchy } from './use-hierarchy'
import type { HierarchyNodeData, EscalationRule, AiSuggestResponse } from './use-hierarchy'

const nodeTypes = { staff: StaffNode, agent: AgentNode }
const edgeTypes = { 'reports-to': ReportsToEdge, supervises: SupervisesEdge }

const NODE_WIDTH = 220
const NODE_HEIGHT = 100

function layoutWithDagre(nodes: Node<HierarchyNodeData>[], edges: Edge[]): Node<HierarchyNodeData>[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } }
  })
}

function buildInitialGraph(data: ReturnType<typeof useHierarchy>['data']): {
  nodes: Node<HierarchyNodeData>[]
  edges: Edge[]
} {
  if (!data) return { nodes: [], edges: [] }

  // If we have a saved full canvas layout, use it directly
  if (data.savedLayout && (data.savedLayout as any).nodes?.length) {
    const saved = data.savedLayout as any
    return {
      nodes: saved.nodes as Node<HierarchyNodeData>[],
      edges: saved.edges as Edge[],
    }
  }

  // Otherwise build from server hierarchy and auto-layout
  const nodes: Node<HierarchyNodeData>[] = data.layout.nodes.map(n => ({
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 0, y: 0 },
    data: {
      type: n.type,
      label: n.label,
      designation: n.designation,
      department: n.department,
      avatar: n.avatar,
      role: n.role,
      managerId: n.managerId,
      supervisorUserId: n.supervisorUserId,
    },
  }))

  const edges: Edge[] = data.layout.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type === 'supervises' ? 'supervises' : 'reports-to',
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    animated: e.type === 'supervises',
  }))

  const laidOut = layoutWithDagre(nodes, edges)
  return { nodes: laidOut, edges }
}

interface HierarchyCanvasProps {
  members: any[]
}

function HierarchyCanvasInner({ members }: HierarchyCanvasProps) {
  const { data, isLoading } = useHierarchy()
  const saveMutation = useSaveHierarchy()
  const aiSuggestMutation = useAiSuggestHierarchy()
  const aiRefineMutation = useAiRefineHierarchy()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<HierarchyNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNode, setSelectedNode] = useState<Node<HierarchyNodeData> | null>(null)
  const [escalationRules, setEscalationRules] = useState<EscalationRule[]>([])
  const [initialized, setInitialized] = useState(false)
  const [aiPreview, setAiPreview] = useState<AiSuggestResponse | null>(null)
  const [showAiPrompt, setShowAiPrompt] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [refineInput, setRefineInput] = useState('')
  const [refineOpen, setRefineOpen] = useState(true)
  const [refineHistory, setRefineHistory] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([{
    role: 'ai',
    text: 'Hierarchy ready. Tell me any corrections — e.g. "Move Brian under Waleed" or "Put all agents under the CEO".',
  }])

  useEffect(() => {
    if (data && !initialized) {
      const { nodes: n, edges: e } = buildInitialGraph(data)
      setNodes(n)
      setEdges(e)
      setEscalationRules(data.escalationRules ?? [])
      setInitialized(true)
    }
  }, [data, initialized, setNodes, setEdges])

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find(n => n.id === connection.source)
      const targetNode = nodes.find(n => n.id === connection.target)
      if (!sourceNode || !targetNode) return

      const edgeType = targetNode.data.type === 'agent' ? 'supervises' : 'reports-to'
      const newEdge: Edge = {
        id: `e-${connection.source}-${connection.target}`,
        source: connection.source!,
        target: connection.target!,
        type: edgeType,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        animated: edgeType === 'supervises',
      }
      setEdges(eds => addEdge(newEdge, eds))

      // Update data relationship
      if (edgeType === 'reports-to') {
        setNodes(nds => nds.map(n => n.id === connection.target
          ? { ...n, data: { ...n.data, managerId: connection.source! } }
          : n,
        ))
      } else {
        setNodes(nds => nds.map(n => n.id === connection.target
          ? { ...n, data: { ...n.data, supervisorUserId: connection.source! } }
          : n,
        ))
      }
    },
    [nodes, setEdges, setNodes],
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<HierarchyNodeData>) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // When edges are deleted (via Delete/Backspace key or × button),
  // also clear the managerId / supervisorUserId on the target node
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    setNodes(nds => nds.map(n => {
      const wasTarget = deleted.some(e => e.target === n.id)
      if (!wasTarget) return n
      return {
        ...n,
        data: {
          ...n.data,
          managerId: undefined,
          supervisorUserId: undefined,
        },
      }
    }))
  }, [setNodes])

  const onUpdateNode = useCallback((id: string, patch: Partial<HierarchyNodeData>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  }, [setNodes])

  const autoLayout = useCallback(() => {
    const laidOut = layoutWithDagre(nodes, edges)
    setNodes(laidOut)
    toast.success('Layout applied')
  }, [nodes, edges, setNodes])

  const applyAiSuggestion = useCallback((suggestion: AiSuggestResponse) => {
    setNodes(nds => nds.map(n => {
      if (n.data.type === 'staff') {
        const rel = suggestion.staffRelationships.find(r => r.userId === n.id)
        if (rel) return { ...n, data: { ...n.data, managerId: rel.managerId ?? undefined } }
      } else {
        const rel = suggestion.agentRelationships.find(r => r.agentId === n.id)
        if (rel) return { ...n, data: { ...n.data, supervisorUserId: rel.supervisorUserId } }
      }
      return n
    }))

    // Rebuild edges from suggestion
    const newEdges: Edge[] = [
      ...suggestion.staffRelationships
        .filter(r => r.managerId)
        .map(r => ({
          id: `e-${r.managerId}-${r.userId}`,
          source: r.managerId!,
          target: r.userId,
          type: 'reports-to' as const,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          animated: false,
        })),
      ...suggestion.agentRelationships.map(r => ({
        id: `e-${r.supervisorUserId}-${r.agentId}`,
        source: r.supervisorUserId,
        target: r.agentId,
        type: 'supervises' as const,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        animated: true,
      })),
    ]
    setEdges(newEdges)
    setEscalationRules(suggestion.escalationRules as EscalationRule[])
    setAiPreview(null)

    // Auto-layout after applying — run after React re-renders the new edges
    setTimeout(() => {
      setNodes(nds => layoutWithDagre(nds, newEdges))
    }, 50)

    toast.success('AI hierarchy applied — review then save')
  }, [setNodes, setEdges])

  const handleAiSuggest = useCallback(async (customInstructions?: string) => {
    setShowAiPrompt(false)
    try {
      const res = await aiSuggestMutation.mutateAsync(customInstructions?.trim() || undefined)
      setAiPreview(res.data)
    } catch {
      toast.error('AI suggestion failed — check API key or try again')
    }
  }, [aiSuggestMutation])

  const handleRefine = useCallback(async () => {
    const instruction = refineInput.trim()
    if (!instruction) return

    setRefineInput('')
    setRefineHistory(h => [...h, { role: 'user', text: instruction }])

    const currentNodes = nodes.map(n => ({
      id: n.id,
      type: n.data.type as string,
      label: n.data.label as string,
      designation: n.data.designation as string | undefined,
      managerId: n.data.managerId as string | undefined,
      supervisorUserId: n.data.supervisorUserId as string | undefined,
    }))
    const currentEdges = edges.map(e => ({
      source: e.source,
      target: e.target,
      type: (e.type as string) ?? 'reports-to',
    }))

    try {
      const res = await aiRefineMutation.mutateAsync({ instruction, currentNodes, currentEdges })
      const result = res.data

      // Apply changes — same logic as applyAiSuggestion but only for changed nodes
      setNodes(nds => nds.map(n => {
        if (n.data.type === 'staff') {
          const rel = result.staffRelationships.find(r => r.userId === n.id)
          if (rel) return { ...n, data: { ...n.data, managerId: rel.managerId ?? undefined } }
        } else {
          const rel = result.agentRelationships.find(r => r.agentId === n.id)
          if (rel) return { ...n, data: { ...n.data, supervisorUserId: rel.supervisorUserId } }
        }
        return n
      }))

      // Rebuild only the changed edges — compute locally so the setTimeout below
      // uses the same reference (avoids the stale-closure layout bug)
      let newEdges = [...edges]
      for (const rel of result.staffRelationships) {
        newEdges = newEdges.filter(e => e.target !== rel.userId)
        if (rel.managerId) {
          newEdges.push({
            id: `e-${rel.managerId}-${rel.userId}`,
            source: rel.managerId,
            target: rel.userId,
            type: 'reports-to',
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            animated: false,
          })
        }
      }
      for (const rel of result.agentRelationships) {
        newEdges = newEdges.filter(e => e.target !== rel.agentId)
        if (rel.supervisorUserId) {
          newEdges.push({
            id: `e-${rel.supervisorUserId}-${rel.agentId}`,
            source: rel.supervisorUserId,
            target: rel.agentId,
            type: 'supervises',
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            animated: true,
          })
        }
      }
      setEdges(newEdges)

      // Re-run layout using the freshly computed edges (not the stale closure)
      setTimeout(() => setNodes(nds => layoutWithDagre(nds, newEdges)), 80)

      setRefineHistory(h => [...h, { role: 'ai', text: result.summary || 'Done — hierarchy updated.' }])
    } catch {
      setRefineHistory(h => [...h, { role: 'ai', text: 'Sorry, something went wrong. Please try again.' }])
    }
  }, [refineInput, nodes, edges, aiRefineMutation, setNodes, setEdges])

  const handleSave = useCallback(async () => {
    const nodeUpdates = nodes.map(n => ({
      id: n.id,
      type: n.data.type as 'staff' | 'agent',
      managerId: n.data.managerId ?? null,
      supervisorUserId: n.data.supervisorUserId ?? null,
      designation: n.data.designation,
      department: n.data.department,
      position: n.position,
    }))

    const cleanLayout = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        markerEnd: e.markerEnd,
        animated: e.animated,
      })),
    }

    try {
      await saveMutation.mutateAsync({
        layout: cleanLayout as any,
        nodeUpdates,
        escalationRules,
      })
      toast.success('Hierarchy saved')
    } catch (err: any) {
      const msg = err?.response?.data?.message
      const detail = Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Unknown error')
      toast.error(`Failed to save: ${detail}`)
      console.error('[HierarchySave]', err?.response?.data ?? err)
    }
  }, [nodes, edges, escalationRules, saveMutation])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px] text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading hierarchy...
      </div>
    )
  }

  return (
    <div className="relative w-full h-[700px] rounded-xl border border-border overflow-hidden bg-muted/10">
      {/* Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-card border border-border rounded-xl shadow-md px-3 py-2">
        <button
          onClick={() => { setShowAiPrompt(true); setAiPrompt('') }}
          disabled={aiSuggestMutation.isPending}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
          title="Let AI suggest the org hierarchy based on designations"
        >
          {aiSuggestMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />
          }
          {aiSuggestMutation.isPending ? 'Thinking...' : 'AI Arrange'}
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={autoLayout}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg hover:bg-accent transition-colors"
          title="Auto-arrange layout"
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Auto-layout
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={() => { setInitialized(false) }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg hover:bg-accent transition-colors"
          title="Reload from server"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reload
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Save className="w-3.5 h-3.5" />
          }
          Save
        </button>
      </div>

      {/* AI Prompt dialog */}
      {showAiPrompt && (
        <div className="absolute inset-0 bg-black/40 z-30 flex items-center justify-center">
          <div className="w-[500px] bg-card border border-violet-200 rounded-2xl shadow-2xl p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">AI Hierarchy Arrangement</p>
                  <p className="text-[10px] text-muted-foreground">Describe any specific requirements</p>
                </div>
              </div>
              <button onClick={() => setShowAiPrompt(false)} className="p-1 hover:bg-accent rounded text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Prompt input */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Custom instructions (optional)</label>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="e.g. Put Brian Smith at the same level as Waleed Nizam, both reporting directly to the CEO. Make Sophie report to Waleed. Assign the Sales AI agent to Brian Smith..."
                rows={4}
                className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none placeholder:text-muted-foreground/60"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAiSuggest(aiPrompt) }}
              />
              <p className="text-[10px] text-muted-foreground">Press ⌘Enter to generate · Leave blank to let AI decide automatically</p>
            </div>

            {/* Example suggestions */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground">Quick examples:</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Place all managers directly under the CEO',
                  'Group agents with their department managers',
                  'Make operations team report to Waleed',
                  'Put finance roles under the accounts executive',
                ].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setAiPrompt(ex)}
                    className="text-[10px] px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowAiPrompt(false)}
                className="flex-1 text-sm py-2 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAiSuggest(aiPrompt)}
                disabled={aiSuggestMutation.isPending}
                className="flex-1 text-sm py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-2"
              >
                {aiSuggestMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Thinking...</>
                  : <><Sparkles className="w-4 h-4" /> Generate Hierarchy</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Preview panel — shows reasoning + confirm/discard */}
      {aiPreview && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 w-[480px] bg-card border border-violet-300 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0" />
              <p className="text-sm font-semibold text-violet-700">AI Hierarchy Suggestion</p>
            </div>
            <button onClick={() => setAiPreview(null)} className="p-0.5 hover:bg-accent rounded text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{aiPreview.reasoning}</p>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-center">
            <div className="bg-muted rounded-lg p-2">
              <p className="font-bold text-lg text-foreground">{aiPreview.staffRelationships.filter(r => r.managerId).length}</p>
              <p className="text-muted-foreground">Staff links</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="font-bold text-lg text-foreground">{aiPreview.agentRelationships.length}</p>
              <p className="text-muted-foreground">Agent links</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="font-bold text-lg text-foreground">{aiPreview.escalationRules.length}</p>
              <p className="text-muted-foreground">Escalation rules</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setAiPreview(null)}
              className="flex-1 text-xs py-2 border border-border rounded-lg hover:bg-accent transition-colors"
            >
              Discard
            </button>
            <button
              onClick={() => applyAiSuggestion(aiPreview)}
              className="flex-1 text-xs py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
            >
              Apply & Auto-layout
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 bg-card border border-border rounded-lg shadow px-3 py-2 space-y-1.5 text-[10px]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-slate-400" />
          <span className="text-muted-foreground">Reports to (staff)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-violet-500 border-dashed border-t border-violet-500" style={{ borderStyle: 'dashed' }} />
          <span className="text-muted-foreground">Supervises (agent)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-slate-500 to-slate-600" />
          <span className="text-muted-foreground">Human staff</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-violet-600 to-purple-700" />
          <span className="text-muted-foreground">AI agent</span>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgesDelete={onEdgesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          deletable: true,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={n => (n.type === 'agent' ? '#7c3aed' : '#64748b')}
          maskColor="rgba(0,0,0,0.05)"
        />
      </ReactFlow>

      {/* AI Refine chat bar — bottom left */}
      <div className={`absolute bottom-3 left-3 z-10 w-80 bg-card border border-border rounded-xl shadow-xl transition-all ${refineOpen ? '' : 'w-auto'}`}>
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
          onClick={() => setRefineOpen(o => !o)}
        >
          <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center flex-shrink-0">
            <Bot className="w-3.5 h-3.5 text-violet-600" />
          </div>
          <span className="text-xs font-semibold flex-1">AI Refine</span>
          {aiRefineMutation.isPending && <Loader2 className="w-3 h-3 animate-spin text-violet-500" />}
          {refineOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>

        {refineOpen && (
          <>
            {/* Message history */}
            <div className="max-h-48 overflow-y-auto px-3 pb-2 space-y-2 border-t border-border">
              {refineHistory.map((msg, i) => (
                <div key={i} className={`flex gap-2 mt-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'ai' && (
                    <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Sparkles className="w-2.5 h-2.5 text-violet-600" />
                    </div>
                  )}
                  <div className={`text-[11px] leading-relaxed px-2.5 py-1.5 rounded-xl max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-none'
                      : 'bg-muted text-foreground rounded-tl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {aiRefineMutation.isPending && (
                <div className="flex gap-2 mt-2">
                  <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-2.5 h-2.5 text-violet-600" />
                  </div>
                  <div className="bg-muted rounded-xl rounded-tl-none px-2.5 py-1.5 flex items-center gap-1">
                    <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1 border-t border-border">
              <input
                value={refineInput}
                onChange={e => setRefineInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRefine() } }}
                placeholder="Move Brian under Waleed..."
                disabled={aiRefineMutation.isPending}
                className="flex-1 text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
              />
              <button
                onClick={handleRefine}
                disabled={!refineInput.trim() || aiRefineMutation.isPending}
                className="w-7 h-7 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Node edit sidebar */}
      {selectedNode && (
        <HierarchySidebar
          node={selectedNode}
          allNodes={nodes}
          escalationRules={escalationRules}
          onClose={() => setSelectedNode(null)}
          onUpdateNode={onUpdateNode}
          onUpdateEscalations={setEscalationRules}
        />
      )}
    </div>
  )
}

export function HierarchyCanvas(props: HierarchyCanvasProps) {
  return (
    <ReactFlowProvider>
      <HierarchyCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
