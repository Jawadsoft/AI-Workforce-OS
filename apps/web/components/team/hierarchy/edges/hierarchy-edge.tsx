'use client'

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { X } from 'lucide-react'

function DeleteButton({ labelX, labelY, edgeId }: { labelX: number; labelY: number; edgeId: string }) {
  const { setEdges, setNodes, getNodes } = useReactFlow()

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Find the edge to get the target node
    setEdges(eds => {
      const edge = eds.find(e => e.id === edgeId)
      if (edge) {
        // Clear relationship data on the target node
        setNodes(getNodes().map(n => {
          if (n.id !== edge.target) return n
          return { ...n, data: { ...n.data, managerId: undefined, supervisorUserId: undefined } }
        }))
      }
      return eds.filter(e => e.id !== edgeId)
    })
  }

  return (
    <EdgeLabelRenderer>
      <div
        style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
        className="absolute nodrag nopan group"
      >
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full bg-white border border-red-300 text-red-500 hover:bg-red-50 flex items-center justify-center shadow-sm transition-opacity"
          title="Delete connection"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
    </EdgeLabelRenderer>
  )
}

export const ReportsToEdge = memo((props: EdgeProps) => {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected } = props

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#3b82f6' : '#94a3b8',
          strokeWidth: selected ? 2.5 : 2,
        }}
      />
      <DeleteButton labelX={labelX} labelY={labelY} edgeId={id} />
    </>
  )
})

ReportsToEdge.displayName = 'ReportsToEdge'

export const SupervisesEdge = memo((props: EdgeProps) => {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected } = props

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#6d28d9' : '#7c3aed',
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: '6 3',
        }}
      />
      <DeleteButton labelX={labelX} labelY={labelY} edgeId={id} />
    </>
  )
})

SupervisesEdge.displayName = 'SupervisesEdge'
