'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Zap, RefreshCw, Play, MessageSquare, Clock, CheckCircle, XCircle, Copy, CheckCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

const EVENT_TYPES = [
  { value: 'lead.created', label: 'Lead Created', description: 'New lead added to CRM' },
  { value: 'lead.updated', label: 'Lead Updated', description: 'Lead stage or data changed' },
  { value: 'job.created', label: 'Job Created', description: 'New job or work order created' },
  { value: 'job.scheduled', label: 'Job Scheduled', description: 'Job assigned a date' },
  { value: 'job.completed', label: 'Job Completed', description: 'Job marked as done' },
  { value: 'proposal.sent', label: 'Proposal Sent', description: 'Estimate sent to customer' },
  { value: 'proposal.accepted', label: 'Proposal Accepted', description: 'Customer approved estimate' },
  { value: 'proposal.declined', label: 'Proposal Declined', description: 'Customer rejected estimate' },
  { value: 'invoice.overdue', label: 'Invoice Overdue', description: 'Payment not received' },
  { value: 'message.received', label: 'Message Received', description: 'New inbound message' },
  { value: 'appointment.booked', label: 'Appointment Booked', description: 'New appointment scheduled' },
]

const EVENT_AGENT_MAP: Record<string, string> = {
  'lead.created': 'Lead Qual / Sales Assistant',
  'lead.updated': 'Sales Assistant',
  'job.created': 'Estimator / Project Coordinator',
  'job.scheduled': 'Project Coordinator',
  'job.completed': 'Executive Assistant',
  'proposal.sent': 'Sales Assistant',
  'proposal.accepted': 'Executive Assistant',
  'proposal.declined': 'Sales Assistant',
  'invoice.overdue': 'Executive Assistant',
  'message.received': 'Receptionist',
  'appointment.booked': 'Receptionist',
}

export function WebhooksPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [testing, setTesting] = useState(false)
  const [testEvent, setTestEvent] = useState('lead.created')
  const [testData, setTestData] = useState('{\n  "name": "John Smith",\n  "email": "john@example.com",\n  "phone": "555-1234",\n  "source": "Website"\n}')
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Get tenant ID from profile
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  })

  // Recent webhook conversations
  const { data: webhookConvos = [], refetch } = useQuery({
    queryKey: ['webhook-conversations'],
    queryFn: () => api.get('/webhooks/conversations').then(r => r.data?.data ?? r.data ?? []),
    refetchInterval: 10000,
  })

  const triggerMutation = useMutation({
    mutationFn: (payload: any) => api.post('/webhooks/trigger', payload),
    onSuccess: (res) => {
      if (res.data.handled) {
        toast({ title: `Event triggered — agent: ${res.data.agentName}` })
      } else {
        toast({ title: 'No matching agent found for this event', variant: 'destructive' })
      }
      qc.invalidateQueries({ queryKey: ['webhook-conversations'] })
    },
    onError: () => toast({ title: 'Failed to trigger event', variant: 'destructive' }),
  })

  const tenantId = profile?.tenantId ?? 'YOUR_TENANT_ID'
  const webhookBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/crm/${tenantId}`
    : `https://yourapp.com/api/webhooks/crm/${tenantId}`

  const handleTest = async () => {
    setTesting(true)
    try {
      const parsed = JSON.parse(testData)
      await triggerMutation.mutateAsync({ event: testEvent, data: parsed })
    } catch (e: any) {
      toast({ title: `Invalid JSON: ${e.message}`, variant: 'destructive' })
    } finally {
      setTesting(false)
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-orange-500" /> Webhooks & Automation
        </h1>
        <p className="text-muted-foreground mt-1">
          CRM events automatically trigger your AI agents — no manual intervention needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Webhook URL Card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm">Your Webhook URL</h2>
          <p className="text-xs text-muted-foreground">
            Configure your CRM to POST events to this URL. The system will automatically route each event to the correct agent.
          </p>
          <div className="space-y-2">
            {EVENT_TYPES.slice(0, 3).map(e => (
              <div key={e.value} className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{e.value}</span>
                <div className="flex items-center gap-1 bg-muted rounded px-2 py-1 flex-1 min-w-0">
                  <code className="text-xs truncate flex-1">POST {webhookBaseUrl}/{e.value}</code>
                  <button onClick={() => copyUrl(`${webhookBaseUrl}/${e.value}`)} className="flex-shrink-0">
                    <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">...and {EVENT_TYPES.length - 3} more event types</p>
          </div>

          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs font-semibold mb-1">Base URL pattern:</p>
            <div className="flex items-center gap-2 bg-background rounded border border-border px-2 py-1.5">
              <code className="text-xs flex-1 text-blue-600 break-all">{webhookBaseUrl}/{'{event}'}</code>
              <button onClick={() => copyUrl(webhookBaseUrl)} className="flex-shrink-0">
                {copiedUrl ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />}
              </button>
            </div>
          </div>
        </div>

        {/* Event → Agent Routing Map */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm">Event Routing Map</h2>
          <p className="text-xs text-muted-foreground">Each event type is automatically routed to the best available agent.</p>
          <div className="space-y-1.5">
            {EVENT_TYPES.map(e => (
              <div key={e.value} className="flex items-center justify-between gap-2 py-1 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground truncate">{e.value}</span>
                </div>
                <Badge variant="outline" className="text-xs flex-shrink-0">{EVENT_AGENT_MAP[e.value]}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Test Event Trigger */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Play className="h-4 w-4 text-green-500" /> Test Webhook
        </h2>
        <p className="text-xs text-muted-foreground">
          Send a simulated CRM event to see which agent fires and what response is generated.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium block mb-1.5">Event Type</label>
            <select
              value={testEvent}
              onChange={e => setTestEvent(e.target.value)}
              className="w-full text-sm rounded border border-border bg-background px-2 py-2 focus:outline-none"
            >
              {EVENT_TYPES.map(e => (
                <option key={e.value} value={e.value}>{e.label} — {e.description}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Will trigger: <strong>{EVENT_AGENT_MAP[testEvent]}</strong>
            </p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5">Payload (JSON)</label>
            <textarea
              value={testData}
              onChange={e => setTestData(e.target.value)}
              rows={6}
              className="w-full text-xs font-mono rounded border border-border bg-background px-2 py-2 focus:outline-none resize-none"
            />
          </div>
        </div>
        <Button onClick={handleTest} disabled={testing || triggerMutation.isPending} className="flex items-center gap-2">
          {testing ? <Loader2Spin /> : <Play className="h-4 w-4" />}
          {testing ? 'Triggering...' : 'Trigger Test Event'}
        </Button>
      </div>

      {/* Recent Webhook Conversations */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Recent Webhook Conversations
          </h2>
          <button onClick={() => refetch()} className="p-1 hover:bg-accent rounded transition-colors">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {webhookConvos.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Zap className="h-8 w-8 text-gray-300 mx-auto" />
            <p className="text-sm text-muted-foreground">No webhook events received yet</p>
            <p className="text-xs text-muted-foreground">Use the test tool above to simulate one</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {webhookConvos.map((conv: any) => {
              const meta = conv.metadata ?? {}
              const firstMsg = conv.messages?.[0]
              const agentMsg = conv.messages?.[1]
              return (
                <div key={conv.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0 mt-1" />
                      <div>
                        <p className="text-sm font-medium">{conv.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-xs">{conv.agent?.name ?? 'Agent'}</Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(conv.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 flex-shrink-0">
                      {meta.webhookEvent ?? 'webhook'}
                    </Badge>
                  </div>
                  {agentMsg && (
                    <div className="bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground line-clamp-2">
                      <strong className="text-foreground">{conv.agent?.name}: </strong>
                      {agentMsg.content}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Loader2Spin() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
