'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react'

export function ApprovalsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'PENDING' | 'HISTORY'>('PENDING')

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ['approvals', tab],
    queryFn: () =>
      api.get(`/approvals?status=${tab === 'HISTORY' ? 'APPROVED,REJECTED' : 'PENDING'}`).then((r) => r.data?.data ?? r.data ?? []),
    refetchInterval: 10000,
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.post(`/approvals/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })

  const pending = approvals.filter((a: any) => a.status === 'PENDING')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {tab === 'PENDING' ? `${pending.length} pending review` : 'Approval history'}
          </p>
        </div>
        {pending.length > 0 && tab === 'PENDING' && (
          <div className="flex items-center gap-1.5 bg-yellow-500/10 text-yellow-600 text-sm px-3 py-1.5 rounded-full">
            <AlertCircle className="w-4 h-4" />
            {pending.length} need your review
          </div>
        )}
      </div>

      <div className="flex border-b border-border">
        {(['PENDING', 'HISTORY'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'PENDING' ? 'Pending' : 'History'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-5 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <CheckCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {tab === 'PENDING' ? 'No pending approvals' : 'No approval history yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval: any) => (
            <div key={approval.id} className="rounded-lg border border-border bg-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      approval.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600' :
                      approval.status === 'APPROVED' ? 'bg-green-500/10 text-green-600' :
                      'bg-red-500/10 text-red-600'
                    }`}>
                      {approval.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{approval.type?.replace('_', ' ')}</span>
                  </div>
                  <p className="font-medium text-sm mt-2">{approval.title ?? approval.type}</p>
                  {approval.description && (
                    <p className="text-sm text-muted-foreground mt-1">{approval.description}</p>
                  )}
                  {approval.agent?.name && (
                    <p className="text-xs text-muted-foreground mt-2">Requested by {approval.agent.name}</p>
                  )}
                </div>
                {approval.status === 'PENDING' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => approveMutation.mutate({ id: approval.id, action: 'reject' })}
                      disabled={approveMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-md text-sm text-muted-foreground hover:bg-red-500/10 hover:text-red-600 hover:border-red-300 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                    <button
                      onClick={() => approveMutation.mutate({ id: approval.id, action: 'approve' })}
                      disabled={approveMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-md text-sm hover:bg-green-600 transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                  </div>
                )}
                {approval.status !== 'PENDING' && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    {approval.status === 'APPROVED'
                      ? <CheckCircle className="w-4 h-4 text-green-500" />
                      : <XCircle className="w-4 h-4 text-red-500" />}
                  </div>
                )}
              </div>

              {/* Payload preview */}
              {approval.payload && (
                <details className="text-xs">
                  <summary className="text-muted-foreground cursor-pointer hover:text-foreground">View details</summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
                    {JSON.stringify(approval.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
