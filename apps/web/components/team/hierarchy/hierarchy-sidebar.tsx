'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Bot, User } from 'lucide-react'
import type { Node } from '@xyflow/react'
import type { HierarchyNodeData, EscalationRule } from './use-hierarchy'

interface SidebarProps {
  node: Node<HierarchyNodeData> | null
  allNodes: Node<HierarchyNodeData>[]
  escalationRules: EscalationRule[]
  onClose: () => void
  onUpdateNode: (id: string, patch: Partial<HierarchyNodeData>) => void
  onUpdateEscalations: (rules: EscalationRule[]) => void
}

export function HierarchySidebar({
  node,
  allNodes,
  escalationRules,
  onClose,
  onUpdateNode,
  onUpdateEscalations,
}: SidebarProps) {
  const [designation, setDesignation] = useState('')
  const [department, setDepartment] = useState('')
  const [phone, setPhone] = useState('')
  const [agentRules, setAgentRules] = useState<EscalationRule[]>([])

  useEffect(() => {
    if (!node) return
    setDesignation((node.data.designation as string) ?? '')
    setDepartment((node.data.department as string) ?? '')
    setPhone((node.data.phone as string) ?? '')
    if (node.data.type === 'agent') {
      setAgentRules(escalationRules.filter(r => r.agentId === node.id))
    }
  }, [node, escalationRules])

  if (!node) return null

  const isAgent = node.data.type === 'agent'
  const staffNodes = allNodes.filter(n => n.data.type === 'staff')

  const addRule = () => {
    setAgentRules(prev => [...prev, {
      agentId: node.id,
      trigger: '',
      triggerLabel: '',
      action: 'notify',
      targetUserId: '',
      urgency: 'NORMAL',
    }])
  }

  const removeRule = (idx: number) => {
    setAgentRules(prev => prev.filter((_, i) => i !== idx))
  }

  const updateRule = (idx: number, patch: Partial<EscalationRule>) => {
    setAgentRules(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const save = () => {
    onUpdateNode(node.id, { designation, department, ...(phone ? { phone } : {}) })
    if (isAgent) {
      const other = escalationRules.filter(r => r.agentId !== node.id)
      onUpdateEscalations([...other, ...agentRules])
    }
    onClose()
  }

  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-card border-l border-border shadow-2xl z-10 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          {isAgent
            ? <Bot className="w-4 h-4 text-violet-600" />
            : <User className="w-4 h-4 text-blue-600" />
          }
          <span className="font-semibold text-sm truncate">{node.data.label as string}</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-accent rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Basic info */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</h3>
          <div>
            <label className="text-xs font-medium">Job Title / Designation</label>
            <input
              value={designation}
              onChange={e => setDesignation(e.target.value)}
              placeholder="e.g. Sales Manager"
              className="w-full mt-1 text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {!isAgent && (
            <div>
              <label className="text-xs font-medium">Department</label>
              <input
                value={department}
                onChange={e => setDepartment(e.target.value)}
                placeholder="e.g. Operations"
                className="w-full mt-1 text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          {!isAgent && (
            <div>
              <label className="text-xs font-medium">Contact Phone</label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                className="w-full mt-1 text-sm rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>

        {/* Escalation rules for agents */}
        {isAgent && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Escalation Rules</h3>
              <button onClick={addRule} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80">
                <Plus className="w-3 h-3" /> Add rule
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Define when this agent should contact a human.</p>

            {agentRules.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No escalation rules yet.</p>
            )}

            {agentRules.map((rule, idx) => (
              <div key={idx} className="border border-border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-muted-foreground">Rule {idx + 1}</span>
                  <button onClick={() => removeRule(idx)} className="p-0.5 hover:bg-destructive/10 text-destructive rounded">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div>
                  <label className="text-[10px] font-medium">Trigger</label>
                  <select
                    value={rule.triggerLabel}
                    onChange={e => {
                      const val = e.target.value
                      updateRule(idx, { triggerLabel: val, trigger: val.toLowerCase().replace(/[^a-z0-9]+/g, '_') })
                    }}
                    className="w-full mt-0.5 text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none"
                  >
                    <option value="">— choose trigger —</option>
                    <option value="Property damage reported">Property damage reported</option>
                    <option value="Urgent repair request">Urgent repair request</option>
                    <option value="Customer complaint">Customer complaint</option>
                    <option value="Quote over £500">Quote over £500</option>
                    <option value="Safety hazard reported">Safety hazard reported</option>
                    <option value="Customer requests manager">Customer requests manager</option>
                    <option value="Scheduling conflict">Scheduling conflict</option>
                    <option value="Legal or billing dispute">Legal or billing dispute</option>
                    <option value="Staff performance issue">Staff performance issue</option>
                    <option value="New lead high value">New lead high value</option>
                    <option value="Custom…">Custom…</option>
                  </select>
                  {rule.triggerLabel === 'Custom…' && (
                    <input
                      placeholder="Type custom trigger…"
                      className="w-full mt-1 text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                      onChange={e => updateRule(idx, { triggerLabel: e.target.value, trigger: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })}
                    />
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-medium">Contact staff member</label>
                  <select
                    value={rule.targetUserId ?? ''}
                    onChange={e => updateRule(idx, { targetUserId: e.target.value })}
                    className="w-full mt-0.5 text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none"
                  >
                    <option value="">— select staff —</option>
                    {staffNodes.map(n => (
                      <option key={n.id} value={n.id}>{n.data.label as string}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-medium">Action</label>
                    <select
                      value={rule.action ?? 'notify'}
                      onChange={e => updateRule(idx, { action: e.target.value })}
                      className="w-full mt-0.5 text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none"
                    >
                      <option value="notify">Notify</option>
                      <option value="handoff">Handoff</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-medium">Urgency</label>
                    <select
                      value={rule.urgency ?? 'NORMAL'}
                      onChange={e => updateRule(idx, { urgency: e.target.value })}
                      className="w-full mt-0.5 text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none"
                    >
                      <option value="NORMAL">Normal</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <button
          onClick={save}
          className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Save Changes
        </button>
      </div>
    </div>
  )
}
