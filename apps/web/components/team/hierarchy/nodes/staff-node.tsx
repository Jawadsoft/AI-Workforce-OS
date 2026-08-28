'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { User, Crown, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HierarchyNodeData } from '../use-hierarchy'

const ROLE_COLORS: Record<string, string> = {
  TENANT_OWNER: 'from-purple-500 to-purple-600',
  TENANT_ADMIN: 'from-blue-500 to-blue-600',
  SUPER_ADMIN: 'from-red-500 to-red-600',
  MANAGER: 'from-amber-500 to-amber-600',
  USER: 'from-slate-500 to-slate-600',
  VIEWER: 'from-green-500 to-green-600',
}

const ROLE_BADGE: Record<string, string> = {
  TENANT_OWNER: 'bg-purple-100 text-purple-700',
  TENANT_ADMIN: 'bg-blue-100 text-blue-700',
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-amber-100 text-amber-700',
  USER: 'bg-slate-100 text-slate-600',
  VIEWER: 'bg-green-100 text-green-700',
}

export const StaffNode = memo(({ data: rawData, selected }: NodeProps) => {
  const data = rawData as HierarchyNodeData
  const gradient = ROLE_COLORS[data.role ?? 'USER'] ?? 'from-slate-500 to-slate-600'
  const badge = ROLE_BADGE[data.role ?? 'USER'] ?? 'bg-slate-100 text-slate-600'
  const isOwner = data.role === 'TENANT_OWNER' || data.role === 'SUPER_ADMIN'
  const isAdmin = data.role === 'TENANT_ADMIN'

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-white shadow-lg w-52 transition-all select-none',
        selected ? 'border-blue-500 shadow-blue-200' : 'border-border hover:border-blue-300',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2.5 !h-2.5" />

      {/* Gradient header */}
      <div className={cn('rounded-t-[10px] bg-gradient-to-r p-3 flex items-center gap-2', gradient)}>
        {data.avatar ? (
          <img src={data.avatar} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-white/50" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-xs truncate leading-tight">{data.label}</p>
          <p className="text-white/75 text-[10px] truncate leading-tight">{data.designation ?? data.role}</p>
        </div>
        {isOwner && <Crown className="w-3.5 h-3.5 text-yellow-300 flex-shrink-0" />}
        {isAdmin && !isOwner && <Shield className="w-3.5 h-3.5 text-white/80 flex-shrink-0" />}
      </div>

      {/* Body */}
      <div className="p-2.5 space-y-1.5">
        {data.department && (
          <p className="text-[10px] text-muted-foreground truncate">
            {data.department}
          </p>
        )}
        <span className={cn('inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full', badge)}>
          {(data.role ?? 'Staff').replace('_', ' ')}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2.5 !h-2.5" />
    </div>
  )
})

StaffNode.displayName = 'StaffNode'
