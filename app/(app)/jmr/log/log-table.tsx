'use client'
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Search, ImageIcon, User, ShieldCheck, CalendarDays } from 'lucide-react'
import { JmrEntryStatusPill } from '@/components/jmr/JmrEntryStatusPill'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import { formatDateTime } from '@/lib/utils'

export interface LogEntry {
  id: string
  entry_date: string
  quantity: number
  amount: number
  rate_snapshot: number
  status: string
  unit: string
  item_name: string
  project_label: string
  contractor_name: string
  work_description: string | null
  review_remarks: string | null
  logged_by: string
  logged_at: string
  approved_by: string | null
  approved_at: string | null
  photo_url: string | null
  has_photo: boolean
}

type Filter = 'all' | 'submitted' | 'pm_approved' | 'flagged'

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Pending' },
  { key: 'pm_approved', label: 'Approved' },
  { key: 'flagged', label: 'Flagged' },
]

export function JmrLogTable({ entries }: { entries: LogEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const counts = useMemo(() => ({
    all: entries.length,
    submitted: entries.filter(e => e.status === 'submitted').length,
    pm_approved: entries.filter(e => e.status === 'pm_approved').length,
    flagged: entries.filter(e => e.status === 'flagged').length,
  }), [entries])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter(e => {
      if (filter !== 'all' && e.status !== filter) return false
      if (!needle) return true
      return [
        e.item_name, e.contractor_name, e.project_label,
        e.logged_by, e.approved_by ?? '', e.review_remarks ?? '', e.work_description ?? '',
      ].some(v => v.toLowerCase().includes(needle))
    })
  }, [entries, filter, q])

  const shownTotal = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])

  return (
    <div className="space-y-3">
      {/* Interactive status chips + total */}
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map(c => {
          const active = filter === c.key
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {c.label}
              <span className={`tabular-nums ${active ? 'text-white/80' : 'text-gray-400'}`}>
                {counts[c.key]}
              </span>
            </button>
          )
        })}
        <span className="ml-auto text-xs text-gray-500">
          {rows.length} shown · <span className="font-semibold text-gray-700">{formatINR(shownTotal)}</span>
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search item, contractor, project, person, comment…"
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">
          No entries match — adjust the filter or search.
        </Card>
      ) : (
        <>
          {/* Mobile: one card per entry (no horizontal scroll) */}
          <div className="space-y-2 md:hidden">
            {rows.map(r => {
              const isFlagged = r.status === 'flagged'
              return (
                <Card key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{r.item_name}</div>
                      <div className="text-[11px] text-gray-500 truncate">{r.project_label} · {r.contractor_name}</div>
                    </div>
                    <JmrEntryStatusPill status={r.status} className="flex-shrink-0" />
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      <span className="font-mono">{r.quantity}</span> {r.unit}
                      <span className="text-gray-400"> @ {formatINR(r.rate_snapshot)}</span>
                    </span>
                    <span className="font-semibold text-emerald-700">{formatINR(r.amount)}</span>
                  </div>

                  {r.work_description && (
                    <div className="text-[11px] text-gray-500 italic mt-1">“{r.work_description}”</div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> {formatDateIN(r.entry_date)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> {r.logged_by}
                    </span>
                    {r.photo_url && (
                      <a
                        href={r.photo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-blue-700"
                      >
                        <ImageIcon className="h-3 w-3" /> Log sheet
                      </a>
                    )}
                  </div>

                  {r.approved_by ? (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                      <ShieldCheck className="h-3 w-3" /> {r.approved_by}
                      {r.approved_at && <span className="text-gray-400">· {formatDateTime(r.approved_at)}</span>}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-gray-400">not reviewed yet</div>
                  )}

                  {r.review_remarks && (
                    <div
                      className={`mt-1 rounded-md px-2 py-1 text-[11px] ${
                        isFlagged
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                          : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                      }`}
                    >
                      {r.review_remarks}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

          {/* Desktop: full audit table */}
          <Card className="overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">When</th>
                  <th className="px-3 py-2 text-left font-semibold">Work</th>
                  <th className="px-3 py-2 text-left font-semibold">Contractor</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold">Review</th>
                  <th className="px-3 py-2 text-center font-semibold">Sheet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const isFlagged = r.status === 'flagged'
                  return (
                    <tr key={r.id} className="align-top hover:bg-gray-50/60">
                      {/* When + who logged it */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-gray-900">{formatDateIN(r.entry_date)}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
                          <User className="h-3 w-3" /> {r.logged_by}
                        </div>
                        <div className="text-[10px] text-gray-400">logged {formatDateTime(r.logged_at)}</div>
                      </td>

                      {/* Work: item, project, qty@rate, engineer note */}
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <div className="font-medium text-gray-900">{r.item_name}</div>
                        <div className="text-[11px] text-gray-500">{r.project_label}</div>
                        <div className="text-[11px] text-gray-600 mt-0.5">
                          <span className="font-mono">{r.quantity}</span> {r.unit}
                          <span className="text-gray-400"> @ {formatINR(r.rate_snapshot)}</span>
                        </div>
                        {r.work_description && (
                          <div className="text-[11px] text-gray-500 italic mt-0.5">“{r.work_description}”</div>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-gray-700">{r.contractor_name}</td>

                      <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 whitespace-nowrap">
                        {formatINR(r.amount)}
                      </td>

                      {/* Review audit: status + reviewer + when + comment */}
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <JmrEntryStatusPill status={r.status} />
                        {r.approved_by ? (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                            <ShieldCheck className="h-3 w-3" /> {r.approved_by}
                            {r.approved_at && <span className="text-gray-400">· {formatDateTime(r.approved_at)}</span>}
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-gray-400">not reviewed yet</div>
                        )}
                        {r.review_remarks && (
                          <div
                            className={`mt-1 rounded-md px-2 py-1 text-[11px] ${
                              isFlagged
                                ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                            }`}
                          >
                            {r.review_remarks}
                          </div>
                        )}
                      </td>

                      {/* Log sheet photo */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {r.photo_url ? (
                          <a
                            href={r.photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
                          >
                            <ImageIcon className="h-3.5 w-3.5" /> View
                          </a>
                        ) : (
                          <span className="text-[11px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </Card>
        </>
      )}
    </div>
  )
}
