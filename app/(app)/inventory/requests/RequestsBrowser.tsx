'use client'
// Client-side search + status filter over the requests list. The server hands
// us the latest N rows; this makes them findable (a store_manager who sees
// every site's requests couldn't otherwise answer "show me everything to issue").

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { RequestStatusPill } from '@/components/inventory/RequestStatusPill'
import { formatDate } from '@/lib/utils'
import { Search } from 'lucide-react'

type Row = {
  id: string; request_no: string; status: string; urgency: string
  purpose: string | null; created_at: string | null
  projects: { code: string; name: string } | { code: string; name: string }[] | null
  inv_warehouses: { code: string } | { code: string }[] | null
}

const STATUS_GROUPS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'all',      label: 'All statuses',       match: () => true },
  { key: 'open',     label: 'Open (in progress)', match: s => ['PENDING_HOP', 'APPROVED', 'EMERGENCY_ISSUED', 'ISSUED'].includes(s) },
  { key: 'to_issue', label: 'To issue',           match: s => ['APPROVED', 'EMERGENCY_ISSUED'].includes(s) },
  { key: 'pending',  label: 'Awaiting approval',  match: s => s === 'PENDING_HOP' },
  { key: 'issued',   label: 'Issued',             match: s => s === 'ISSUED' },
  { key: 'closed',   label: 'Closed',             match: s => s === 'CLOSED' },
  { key: 'rejected', label: 'Rejected / cancelled', match: s => ['REJECTED_HOP', 'REJECTED_BACKOFFICE', 'CANCELLED_BY_ENGINEER'].includes(s) },
]

export function RequestsBrowser({ rows, capped }: { rows: Row[]; capped: boolean }) {
  const [q, setQ] = useState('')
  const [statusKey, setStatusKey] = useState('all')
  const group = STATUS_GROUPS.find(g => g.key === statusKey) ?? STATUS_GROUPS[0]

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (!group.match(r.status)) return false
      if (!needle) return true
      const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
      return (r.request_no ?? '').toLowerCase().includes(needle)
        || (r.purpose ?? '').toLowerCase().includes(needle)
        || (proj?.code ?? '').toLowerCase().includes(needle)
        || (proj?.name ?? '').toLowerCase().includes(needle)
    })
  }, [rows, q, group])

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            aria-label="Search requests"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search request no, project, purpose…"
            className="h-10 w-full rounded-xl border border-gray-300 bg-white pl-9 pr-3 text-sm"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={statusKey}
          onChange={e => setStatusKey(e.target.value)}
          className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm"
        >
          {STATUS_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
      </div>

      <p className="text-xs text-gray-500">
        Showing <b>{filtered.length}</b> of {rows.length}{capped ? ' (latest 300 — narrow the search for older ones)' : ''}
      </p>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">No requests yet.</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">Nothing matches your search.</Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {filtered.map(r => {
            const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
            const wh = Array.isArray(r.inv_warehouses) ? r.inv_warehouses[0] : r.inv_warehouses
            return (
              <Link key={r.id} href={`/inventory/requests/${r.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-blue-700">{r.request_no}</span>
                    <RequestStatusPill status={r.status} />
                    {r.urgency !== 'normal' && (
                      <span className={`text-[10px] uppercase font-bold ${r.urgency === 'emergency' ? 'text-rose-700' : 'text-amber-700'}`}>
                        {r.urgency}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {proj?.code ?? '—'}{wh?.code ? ` · ${wh.code}` : ''} · {formatDate(r.created_at ?? '')}
                  </p>
                  {r.purpose && <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.purpose}</p>}
                </div>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}
