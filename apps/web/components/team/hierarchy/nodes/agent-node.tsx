'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Bot, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HierarchyNodeData } from '../use-hierarchy'

export const AgentNode = memo(({ data, selected }: NodeProps<HierarchyNodeData>) => {
  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-white shadow-lg w-52 transition-all select-none',
        selected ? 'border-violet-500 shadow-violet-200' : 'border-border hover:border-violet-300',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-400 !w-2.5 !h-2.5" />

      {/* Purple/violet gradient header for AI agents */}
      <div className="rounded-t-[10px] bg-gradient-to-r from-violet-600 to-purple-700 p-3 flex items-center gap-2">
        {data.avatar ? (
          <img src={data.avatar} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-white/50" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-xs truncate leading-tight">{data.label}</p>
          <p className="text-white/75 text-[10px] truncate leading-tight">{data.designation ?? data.role ?? 'AI Agent'}</p>
        </div>
        <Zap className="w-3.5 h-3.5 text-yellow-300 flex-shrink-0" />
      </div>

      {/* Body */}
      <div className="p-2.5 space-y-1.5">
        <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
          AI Agent
        </span>
        {data.supervisorUserId && (
          <p className="text-[9px] text-muted-foreground">Has human supervisor</p>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-violet-400 !w-2.5 !h-2.5" />
    </div>
  )
})

AgentNode.displayName = 'AgentNode'
