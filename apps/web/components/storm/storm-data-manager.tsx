'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  CloudLightning, RefreshCw, Download, Calendar, MapPin,
  Tornado, Wind, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

type FetchMode = 'yesterday' | 'single' | 'range'

const STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function HailBadge({ size }: { size: number }) {
  const color = size >= 2 ? 'bg-red-100 text-red-700' :
    size >= 1.5 ? 'bg-orange-100 text-orange-700' :
    size >= 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
  return <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', color)}>{size.toFixed(2)}"</span>
}

export function StormDataManager() {
  const qc = useQueryClient()

  // ── Fetch form state ──────────────────────────────────────────
  const [mode, setMode] = useState<FetchMode>('yesterday')
  const [singleDate, setSingleDate] = useState('')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [loading, setLoading] = useState(false)

  // ── Report filter state ───────────────────────────────────────
  const [filterType, setFilterType] = useState<string>('all')
  const [filterState, setFilterState] = useState<string>('')
  const [filterDays, setFilterDays] = useState<number>(60)
  const [filterDate, setFilterDate] = useState<string>('')   // specific date filter for table
  const [showFilters, setShowFilters] = useState(false)

  // ── Fetch stored reports ──────────────────────────────────────
  const { data: reports = [], isLoading: reportsLoading, refetch } = useQuery({
    queryKey: ['storm-reports', filterType, filterState, filterDays, filterDate],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filterType !== 'all') params.set('type', filterType)
      if (filterState) params.set('state', filterState)
      if (filterDate) {
        params.set('date', filterDate)
      } else {
        params.set('days', String(filterDays))
      }
      return api.get(`/storm/reports?${params}`).then(r => r.data ?? [])
    },
  })

  // ── Trigger scrape ────────────────────────────────────────────
  async function triggerFetch() {
    setLoading(true)
    try {
      if (mode === 'yesterday') {
        await api.post('/storm/trigger')
        toast.success('Yesterday\'s storm data loaded successfully')
        setFilterDays(7)
      } else if (mode === 'single') {
        if (!singleDate) { toast.error('Please select a date'); return }
        await api.post(`/storm/trigger?date=${singleDate}`)
        toast.success(`Storm data loaded for ${formatDate(singleDate)}`)
        // Auto-filter table to show exactly this date
        setFilterDate(singleDate)
      } else if (mode === 'range') {
        if (!rangeFrom || !rangeTo) { toast.error('Please select both start and end dates'); return }
        const from = new Date(rangeFrom)
        const to = new Date(rangeTo)
        if (from > to) { toast.error('Start date must be before end date'); return }
        // Fetch each day in the range sequentially
        const days: string[] = []
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          days.push(d.toISOString().split('T')[0])
        }
        if (days.length > 30) { toast.error('Max 30 days per fetch. Please use a smaller range.'); return }
        toast.info(`Fetching ${days.length} days from NOAA...`)
        let done = 0
        for (const day of days) {
          await api.post(`/storm/trigger?date=${day}`).catch(() => null)
          done++
        }
        toast.success(`Loaded ${done} days of storm data`)
        // Show full range in table
        setFilterDate('')
        const daysAgo = Math.ceil((Date.now() - new Date(rangeFrom).getTime()) / 86400000) + 2
        setFilterDays(Math.max(daysAgo, 7))
      }
      await refetch()
      qc.invalidateQueries({ queryKey: ['storm-reports'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to fetch storm data')
    } finally {
      setLoading(false)
    }
  }

  // ── Stats ─────────────────────────────────────────────────────
  const hailReports = reports.filter((r: any) => r.type === 'hail')
  const tornadoReports = reports.filter((r: any) => r.type === 'tornado')
  const windReports = reports.filter((r: any) => r.type === 'wind')
  const largestHail = hailReports.reduce((max: number, r: any) => Math.max(max, r.size ?? 0), 0)
  const uniqueStates = [...new Set(reports.map((r: any) => r.state))].sort()

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <CloudLightning className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Storm Data Manager</h1>
            <p className="text-sm text-gray-500">Load NOAA SPC storm reports into the system database</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Fetch Panel */}
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <Download className="w-4 h-4 text-blue-600" /> Fetch Storm Data from NOAA
        </h2>

        {/* Mode selector */}
        <div className="flex gap-2">
          {(['yesterday', 'single', 'range'] as FetchMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'px-4 py-2 text-sm rounded-lg font-medium border transition-all',
                mode === m
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              {m === 'yesterday' ? 'Yesterday' : m === 'single' ? 'Specific Date' : 'Date Range'}
            </button>
          ))}
        </div>

        {/* Date inputs */}
        <div className="flex items-end gap-3 flex-wrap">
          {mode === 'single' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Date</label>
              <input
                type="date"
                value={singleDate}
                onChange={e => setSingleDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          {mode === 'range' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">From</label>
                <input
                  type="date"
                  value={rangeFrom}
                  onChange={e => setRangeFrom(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">To</label>
                <input
                  type="date"
                  value={rangeTo}
                  onChange={e => setRangeTo(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {rangeFrom && rangeTo && (
                <span className="text-xs text-gray-500 pb-2">
                  {Math.round((new Date(rangeTo).getTime() - new Date(rangeFrom).getTime()) / 86400000) + 1} days
                </span>
              )}
            </>
          )}
          {mode === 'yesterday' && (
            <p className="text-sm text-gray-500 pb-1">
              Loads <strong>yesterday's</strong> NOAA SPC preliminary storm reports (hail, tornado, wind)
            </p>
          )}

          <button
            onClick={triggerFetch}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {loading ? 'Fetching from NOAA...' : 'Fetch Data'}
          </button>
        </div>

        {mode === 'range' && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Max 30 days per fetch. NOAA data available for last ~60 days.
          </p>
        )}
      </div>

      {/* Stats */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{hailReports.length}</p>
            <p className="text-xs text-gray-500 mt-1">Hail Events</p>
            {largestHail > 0 && <p className="text-xs text-gray-400">Largest: {largestHail.toFixed(2)}"</p>}
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{tornadoReports.length}</p>
            <p className="text-xs text-gray-500 mt-1">Tornado Events</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{windReports.length}</p>
            <p className="text-xs text-gray-500 mt-1">Wind Events</p>
          </div>
          <div className="bg-white border rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gray-700">{uniqueStates.length}</p>
            <p className="text-xs text-gray-500 mt-1">States Affected</p>
            {uniqueStates.length > 0 && (
              <p className="text-xs text-gray-400 truncate">{uniqueStates.slice(0, 5).join(', ')}</p>
            )}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border rounded-xl">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl"
        >
          <span className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            Filter Reports
            {(filterType !== 'all' || filterState || filterDays !== 7) && (
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">Active</span>
            )}
          </span>
          {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showFilters && (
          <div className="px-5 pb-4 pt-1 border-t flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Specific Date</label>
              <input
                type="date"
                value={filterDate}
                onChange={e => { setFilterDate(e.target.value) }}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {!filterDate && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 font-medium">Days Back</label>
                <select
                  value={filterDays}
                  onChange={e => setFilterDays(Number(e.target.value))}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={1}>Today</option>
                  <option value={3}>Last 3 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days (default)</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Event Type</label>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Types</option>
                <option value="hail">Hail</option>
                <option value="tornado">Tornado</option>
                <option value="wind">Wind</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">State</label>
              <select
                value={filterState}
                onChange={e => setFilterState(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All States</option>
                {STATE_CODES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button
              onClick={() => { setFilterType('all'); setFilterState(''); setFilterDays(60); setFilterDate('') }}
              className="text-xs text-gray-400 hover:text-gray-600 pb-2"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Reports table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">Storm Reports in Database</span>
            {filterDate && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                <Calendar className="w-3 h-3" />
                {formatDate(filterDate)}
                <button onClick={() => setFilterDate('')} className="ml-1 hover:text-blue-900">×</button>
              </span>
            )}
            {filterState && (
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {filterState}
                <button onClick={() => setFilterState('')} className="ml-1 hover:text-gray-900">×</button>
              </span>
            )}
            {filterType !== 'all' && (
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {filterType}
                <button onClick={() => setFilterType('all')} className="ml-1 hover:text-gray-900">×</button>
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400">{reports.length} records</span>
        </div>

        {reportsLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
            <CloudLightning className="w-10 h-10 opacity-30" />
            <p className="text-sm">No storm data in the database yet.</p>
            <p className="text-xs">Use the fetch panel above to load NOAA data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">Size / Speed</th>
                  <th className="text-left px-4 py-2 font-medium">Location</th>
                  <th className="text-left px-4 py-2 font-medium">County</th>
                  <th className="text-left px-4 py-2 font-medium">State</th>
                  <th className="text-left px-4 py-2 font-medium">Time</th>
                  <th className="text-left px-4 py-2 font-medium">Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reports.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {formatDate(r.reportDate)}
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                        r.type === 'hail' ? 'bg-yellow-100 text-yellow-700' :
                        r.type === 'tornado' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      )}>
                        {r.type === 'hail' ? '🌨' : r.type === 'tornado' ? '🌪' : '💨'}
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {r.size != null
                        ? r.type === 'hail'
                          ? <HailBadge size={r.size} />
                          : <span className="text-xs text-gray-600">{r.size} mph</span>
                        : <span className="text-xs text-gray-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-2 text-gray-700">{r.location || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.county || '—'}</td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.state}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 font-mono text-xs">{r.time || '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate" title={r.comments}>
                      {r.comments || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
