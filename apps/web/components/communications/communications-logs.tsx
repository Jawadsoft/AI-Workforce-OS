'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

interface CommLog {
  id: string
  channel: 'SMS' | 'WHATSAPP' | 'VOICE'
  direction: 'INBOUND' | 'OUTBOUND'
  from: string
  to: string
  body?: string
  status: string
  twilioSid?: string
  durationSec?: number
  createdAt: string
}

const CHANNEL_ICONS: Record<string, string> = {
  SMS: '💬',
  WHATSAPP: '📱',
  VOICE: '📞',
}

const CHANNEL_COLORS: Record<string, string> = {
  SMS: 'bg-blue-100 text-blue-700',
  WHATSAPP: 'bg-green-100 text-green-700',
  VOICE: 'bg-purple-100 text-purple-700',
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-green-50 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  received: 'bg-gray-100 text-gray-700',
  failed: 'bg-red-100 text-red-700',
  queued: 'bg-yellow-100 text-yellow-700',
  'in-progress': 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
}

export function CommunicationsLogs() {
  const [logs, setLogs] = useState<CommLog[]>([])
  const [total, setTotal] = useState(0)
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const fetchLogs = () => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: PAGE_SIZE.toString(),
      skip: (page * PAGE_SIZE).toString(),
    })
    if (channel) params.set('channel', channel)
    api
      .get(`/communications/logs?${params}`)
      .then((r) => {
        setLogs(r.data.logs || [])
        setTotal(r.data.total || 0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchLogs()
  }, [channel, page])

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {['', 'SMS', 'WHATSAPP', 'VOICE'].map((ch) => (
            <button
              key={ch}
              onClick={() => { setChannel(ch); setPage(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                channel === ch
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {ch || 'All'} {ch && CHANNEL_ICONS[ch]}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{total} total messages</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">Messages will appear here once your Twilio numbers are configured</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${CHANNEL_COLORS[log.channel]}`}>
                      {CHANNEL_ICONS[log.channel]} {log.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1 text-xs ${log.direction === 'INBOUND' ? 'text-green-600' : 'text-blue-600'}`}>
                      {log.direction === 'INBOUND' ? '↙ In' : '↗ Out'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.from.replace('whatsapp:', '')}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{log.to.replace('whatsapp:', '')}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                    {log.channel === 'VOICE'
                      ? `📞 Call${log.durationSec ? ` (${log.durationSec}s)` : ''}`
                      : (log.body || <span className="text-gray-300 italic">no body</span>)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[log.status] || 'bg-gray-100 text-gray-600'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
