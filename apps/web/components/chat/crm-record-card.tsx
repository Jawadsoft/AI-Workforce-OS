'use client'

import { useState } from 'react'
import { Building2, Phone, Mail, MapPin, Briefcase, FileText, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

interface CRMJob {
  id: string
  title: string
  status: string
  value?: number
  address?: string
  scheduledDate?: string
}

interface CRMProposal {
  id: string
  title: string
  status: string
  value?: number
  sentAt?: string
}

interface CRMNote {
  id: string
  content: string
  createdAt?: string
}

interface CRMCustomer {
  id: string
  name: string
  email?: string
  phone?: string
  address?: string
  company?: string
}

interface CRMRecordCardProps {
  customer?: CRMCustomer | null
  compact?: boolean
  tenantId?: string
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-700',
  won: 'bg-green-100 text-green-800',
  lost: 'bg-red-100 text-red-800',
  sent: 'bg-blue-100 text-blue-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
}

function statusColor(status?: string) {
  return STATUS_COLORS[status?.toLowerCase() ?? ''] ?? 'bg-gray-100 text-gray-600'
}

export function CRMRecordCard({ customer, compact = false, tenantId }: CRMRecordCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [jobs, setJobs] = useState<CRMJob[]>([])
  const [proposals, setProposals] = useState<CRMProposal[]>([])
  const [notes, setNotes] = useState<CRMNote[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!customer) return null

  const loadDetails = async () => {
    if (loaded) { setExpanded(e => !e); return }
    setLoading(true)
    try {
      const [jobsRes, proposalsRes, notesRes] = await Promise.allSettled([
        api.get(`/crm/contacts/${customer.id}/jobs`),
        api.get(`/crm/contacts/${customer.id}/proposals`),
        api.get(`/crm/contacts/${customer.id}/notes`),
      ])
      if (jobsRes.status === 'fulfilled') setJobs(jobsRes.value.data ?? [])
      if (proposalsRes.status === 'fulfilled') setProposals(proposalsRes.value.data ?? [])
      if (notesRes.status === 'fulfilled') setNotes(notesRes.value.data ?? [])
      setLoaded(true)
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden text-sm mb-3">
      {/* Header */}
      <div className="flex items-start gap-3 p-3">
        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-xs flex-shrink-0 mt-0.5">
          {customer.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-blue-900 truncate">{customer.name}</span>
            <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 px-1.5 py-0">CRM</Badge>
          </div>
          {customer.company && (
            <div className="text-blue-700 text-xs flex items-center gap-1 mt-0.5">
              <Building2 className="h-3 w-3" />
              {customer.company}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="text-blue-700 text-xs flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" /> {customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={`mailto:${customer.email}`} className="text-blue-700 text-xs flex items-center gap-1 hover:underline">
                <Mail className="h-3 w-3" /> {customer.email}
              </a>
            )}
            {customer.address && !compact && (
              <span className="text-blue-600 text-xs flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {customer.address}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-blue-700 hover:bg-blue-100 flex-shrink-0"
          onClick={loadDetails}
        >
          {loading ? (
            <span className="text-xs">...</span>
          ) : expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-blue-200 px-3 pb-3 space-y-3 pt-2">
          {/* Jobs */}
          {jobs.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-800 flex items-center gap-1 mb-1.5">
                <Briefcase className="h-3 w-3" /> Open Jobs ({jobs.length})
              </div>
              <div className="space-y-1">
                {jobs.map(j => (
                  <div key={j.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-2 py-1.5">
                    <span className="text-blue-900 text-xs truncate">{j.title}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {j.value ? <span className="text-xs text-green-700 font-medium">${j.value.toLocaleString()}</span> : null}
                      <Badge className={cn('text-xs px-1.5 py-0', statusColor(j.status))}>{j.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proposals */}
          {proposals.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-800 flex items-center gap-1 mb-1.5">
                <FileText className="h-3 w-3" /> Proposals ({proposals.length})
              </div>
              <div className="space-y-1">
                {proposals.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-2 py-1.5">
                    <span className="text-blue-900 text-xs truncate">{p.title}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {p.value ? <span className="text-xs text-green-700 font-medium">${p.value.toLocaleString()}</span> : null}
                      <Badge className={cn('text-xs px-1.5 py-0', statusColor(p.status))}>{p.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Notes */}
          {notes.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-blue-800 mb-1.5">Recent Notes</div>
              <div className="space-y-1">
                {notes.slice(0, 3).map(n => (
                  <div key={n.id} className="bg-white rounded-lg px-2 py-1.5">
                    <p className="text-xs text-gray-700 line-clamp-2">{n.content}</p>
                    {n.createdAt && (
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobs.length === 0 && proposals.length === 0 && notes.length === 0 && (
            <p className="text-xs text-blue-600 text-center py-1">No additional CRM data found</p>
          )}
        </div>
      )}
    </div>
  )
}
