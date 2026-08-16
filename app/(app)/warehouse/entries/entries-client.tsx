'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { formatQty } from '@/lib/warehouse/format'
import type { EntryRow } from '@/lib/warehouse/admin-data'
import { ArrowDownLeft, ArrowUpRight, Search, Undo2 } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 pl-8 pr-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'in', label: 'IN' },
  { key: 'out', label: 'OUT' },
  { key: 'outstanding', label: 'Still out on loan' },
  { key: 'voided', label: 'Voided' },
] as const

export function EntriesClient({ rows }: { rows: EntryRow[] }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'in' && r.kind !== 'in') return false
      if (filter === 'out' && r.kind !== 'out') return false
      if (filter === 'outstanding' && r.outstanding <= 0) return false
      if (filter === 'voided' && !r.voided) return false
      if (!needle) return true
      return r.entryNo.toLowerCase().includes(needle)
        || r.who.toLowerCase().includes(needle)
        || r.storeName.toLowerCase().includes(needle)
    })
  }, [rows, q, filter])

  const counts = useMemo(() => ({
    all: rows.length,
    in: rows.filter(r => r.kind === 'in').length,
    out: rows.filter(r => r.kind === 'out').length,
    outstanding: rows.filter(r => r.outstanding > 0).length,
    voided: rows.filter(r => r.voided).length,
  }), [rows])

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input className={inputCls} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Entry number, supplier, project or store" aria-label="Search the register" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-lg px-2.5 py-1.5 min-h-[34px] text-[12px] font-bold border-2 ${
                filter === f.key
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              {f.label} <span className="font-normal text-slate-400">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card className="p-6 shadow-sm text-center text-[13px] text-slate-500">
          {rows.length === 0
            ? 'Nothing has come through the gate yet.'
            : 'No entry matches that. Try a shorter search, or a different filter.'}
        </Card>
      ) : (
        <Card className="p-0 shadow-sm overflow-hidden divide-y divide-slate-100">
          {shown.map(r => (
            <Link key={`${r.kind}-${r.id}`} href={`/warehouse/entries/${r.kind}/${r.id}`}
              className="flex items-center gap-3 px-3 py-2.5 min-h-[56px] hover:bg-slate-50">
              <span className={`flex-shrink-0 h-7 w-7 rounded-lg grid place-items-center ${
                r.kind === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
                {r.kind === 'in'
                  ? <ArrowDownLeft className="h-3.5 w-3.5" />
                  : <ArrowUpRight className="h-3.5 w-3.5" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-bold text-slate-800 truncate ${
                  r.voided ? 'line-through text-slate-400' : ''}`}>
                  {r.who}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">
                  <span className="font-mono">{r.entryNo}</span> · {formatDate(r.day)} · {r.storeName}
                </span>
                {r.voided && (
                  <span className="block text-[11px] text-rose-700 font-semibold truncate mt-0.5">
                    <Undo2 className="inline h-3 w-3 mr-0.5" />
                    Voided{r.voidReason ? ` — ${r.voidReason}` : ''}
                  </span>
                )}
              </span>

              <span className="text-right flex-shrink-0">
                <span className={`block text-[12.5px] font-bold tabular-nums ${
                  r.voided ? 'text-slate-300 line-through' : 'text-slate-700'}`}>
                  {formatQty(r.qty)}
                </span>
                <span className="block text-[10.5px] text-slate-400">
                  {r.lines} {r.lines === 1 ? 'item' : 'items'}
                </span>
                {r.outstanding > 0 && (
                  <span className="block text-[10.5px] font-bold text-amber-700 whitespace-nowrap">
                    {formatQty(r.outstanding)} still out
                  </span>
                )}
              </span>
            </Link>
          ))}
        </Card>
      )}

      <p className="text-[11px] text-slate-500 px-0.5">
        The 120 most recent entries. For a full period, a supplier or a project, use the registers
        under <Link href="/warehouse/reports" className="font-semibold text-emerald-700 hover:underline">Reports</Link>.
      </p>
    </div>
  )
}
