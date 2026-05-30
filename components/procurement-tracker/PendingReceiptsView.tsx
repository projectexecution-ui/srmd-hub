'use client'
// The "Pending Receipts" view — the screen the user actually came for.
// Lists every material line where pendingQty > 0 (ordered but not yet
// received), grouped by Supplier (default) or Indent. Comes with age
// filters and TWO CSV export modes:
//   1. "Download all" — full filtered list across every group.
//   2. Per-group icon — just that vendor's or indent's pending lines.
// Both produce identical column schemas so the user's purchase team can
// paste either into the same template.
//
// Group-by choice is persisted in localStorage so it sticks across
// reloads.

import { useEffect, useMemo, useState } from 'react'
import type { LineRecord } from '@/lib/procurement-tracker'
import { Download, Users, ClipboardList, AlertTriangle, FileSpreadsheet } from 'lucide-react'

type GroupKey = 'supplier' | 'indent'
type AgeFilter = 'all' | '7' | '14' | '30'

const GROUP_KEY_STORAGE = 'ct-procurement-pending-groupby'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

function ageDays(ln: LineRecord): number | null {
  // Prefer oldest PO age (relevant for "how long has my supplier been late")
  if (ln.oldestPoAgeDays != null) return ln.oldestPoAgeDays
  return ln.indentAgeDays
}

function ageClass(age: number | null) {
  if (age == null) return 'text-stone-500'
  if (age >= 30) return 'text-red-700 font-bold'
  if (age >= 14) return 'text-rose-600 font-semibold'
  if (age >= 7) return 'text-amber-700 font-medium'
  return 'text-stone-500'
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADER = [
  'Supplier', 'PO No', 'PO Date', 'Age (days)',
  'Indent No', 'Indent Date', 'Project / Block', 'Material', 'UOM',
  'Ordered', 'Received', 'Pending',
  'Pending Value (INR)',
]
function csvRow(ln: LineRecord) {
  const po = ln.pos[0]
  return [
    ln.supplier, po?.poNo ?? '', po?.poDate ?? '', ageDays(ln) ?? '',
    ln.indentNo, ln.indentDate, ln.block, ln.material, ln.uom,
    ln.orderedQty, ln.receivedQty, ln.pendingQty,
    ln.pendingValue.toFixed(2),
  ].map(csvEscape).join(',')
}

function downloadCsv(filename: string, rows: LineRecord[]) {
  const csv = [CSV_HEADER.join(','), ...rows.map(csvRow)].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export'
}

export function PendingReceiptsView({
  lines,
  projectName,
}: {
  lines: LineRecord[]
  projectName: string
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('supplier')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')

  // Restore the group-by choice from localStorage on mount
  useEffect(() => {
    try {
      const v = localStorage.getItem(GROUP_KEY_STORAGE)
      if (v === 'supplier' || v === 'indent') setGroupBy(v)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(GROUP_KEY_STORAGE, groupBy) } catch { /* ignore */ }
  }, [groupBy])

  // Only PENDING lines (ordered but not yet received)
  const pending = useMemo(() => {
    return lines.filter(ln => ln.pendingQty > 0)
  }, [lines])

  const filtered = useMemo(() => {
    const threshold = ageFilter === 'all' ? null : Number(ageFilter)
    if (threshold == null) return pending
    return pending.filter(ln => (ageDays(ln) ?? 0) >= threshold)
  }, [pending, ageFilter])

  // Group + sort by age (oldest first within each group)
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; lines: LineRecord[] }>()
    for (const ln of filtered) {
      const key = groupBy === 'supplier' ? (ln.supplier || '— Unknown vendor —') : ln.indentNo
      const label = groupBy === 'supplier' ? key : ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')
      let g = map.get(key)
      if (!g) { g = { key, label, lines: [] }; map.set(key, g) }
      g.lines.push(ln)
    }
    for (const g of map.values()) {
      g.lines.sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0))
    }
    // Sort groups by total pending value desc
    return Array.from(map.values()).sort((a, b) =>
      b.lines.reduce((s, l) => s + l.pendingValue, 0)
      - a.lines.reduce((s, l) => s + l.pendingValue, 0))
  }, [filtered, groupBy])

  // Top-level stats
  const totalPendingValue = filtered.reduce((s, l) => s + l.pendingValue, 0)
  const totalPendingLines = filtered.length

  if (lines.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <FileSpreadsheet className="h-8 w-8 text-stone-300 mx-auto mb-2" />
        <p className="text-stone-500 text-sm">No data — upload a report first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top stats + controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-stone-800">Pending receipts</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              <b className="text-stone-800">{totalPendingLines}</b> material line{totalPendingLines === 1 ? '' : 's'} ordered but not yet received
              {totalPendingValue > 0 && <> · <b className="text-amber-700">{fmtINR(totalPendingValue)}</b> outstanding</>}
            </p>
          </div>
          <button
            onClick={() => downloadCsv(`${safe(projectName)}-pending-receipts-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download all ({filtered.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Group-by toggle */}
          <div className="inline-flex bg-stone-100 rounded-lg p-0.5">
            <button
              onClick={() => setGroupBy('supplier')}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'supplier' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <Users className="h-3 w-3" /> Group by supplier
            </button>
            <button
              onClick={() => setGroupBy('indent')}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'indent' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <ClipboardList className="h-3 w-3" /> Group by indent
            </button>
          </div>

          {/* Age filter */}
          <div className="inline-flex gap-1 ml-auto flex-wrap">
            {([
              { v: 'all',  label: 'All' },
              { v: '7',    label: '≥ 7 days' },
              { v: '14',   label: '≥ 14 days' },
              { v: '30',   label: '≥ 30 days' },
            ] as const).map(o => (
              <button
                key={o.v}
                onClick={() => setAgeFilter(o.v)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md ${
                  ageFilter === o.v ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
          <AlertTriangle className="h-7 w-7 text-emerald-500 mx-auto mb-2" />
          <p className="text-stone-700 font-medium">All clear in this filter.</p>
          <p className="text-stone-500 text-sm">Nothing pending receipt at this threshold.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
            const groupPendingValue = g.lines.reduce((s, l) => s + l.pendingValue, 0)
            const oldestAge = g.lines.reduce<number | null>((mx, l) => {
              const a = ageDays(l)
              if (a == null) return mx
              return mx == null ? a : Math.max(mx, a)
            }, null)
            return (
              <div key={g.key} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                {/* Group header */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-stone-800 truncate" title={g.label}>{g.label}</span>
                      <span className="text-[11px] text-stone-500">
                        {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {fmtINR(groupPendingValue)} pending
                      </span>
                      {oldestAge != null && oldestAge >= 7 && (
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${ageClass(oldestAge)} bg-white border border-stone-200`}>
                          {oldestAge}d
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => downloadCsv(`${safe(groupBy === 'supplier' ? g.key : g.label)}-pending-${new Date().toISOString().slice(0, 10)}.csv`, g.lines)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 px-2 py-1 rounded-md flex-shrink-0"
                    title={`Download just ${g.label}'s pending lines`}
                  >
                    <Download className="h-3 w-3" /> CSV
                  </button>
                </div>

                {/* Lines */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-stone-100">
                      <tr>
                        {groupBy === 'supplier' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Indent</th>}
                        {groupBy === 'indent'   && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Supplier</th>}
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Material</th>
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">PO</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Age</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Ordered</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Received</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Pending</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {g.lines.map(ln => {
                        const po = ln.pos[0]
                        const age = ageDays(ln)
                        return (
                          <tr key={ln.id} className="hover:bg-stone-50">
                            {groupBy === 'supplier' && (
                              <td className="px-4 py-2 font-mono text-[11px] text-stone-700 whitespace-nowrap" title={ln.indentNo}>
                                {ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                              </td>
                            )}
                            {groupBy === 'indent' && (
                              <td className="px-4 py-2 text-xs text-stone-700 max-w-[180px] truncate" title={ln.supplier}>
                                {ln.supplier || '—'}
                              </td>
                            )}
                            <td className="px-4 py-2 text-xs text-stone-800 max-w-[260px]">
                              <span className="line-clamp-2" title={ln.material}>{ln.material}</span>
                              <span className="text-[10px] text-stone-400">{ln.block}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-stone-500 whitespace-nowrap" title={po?.poNo}>
                              {po?.poNo ? po.poNo.replace('PO/SRASSK/', '').replace('PO/SRET/', '') : '—'}
                            </td>
                            <td className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(age)}`}>
                              {age != null ? `${age}d` : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums text-stone-700">
                              {ln.orderedQty.toLocaleString('en-IN')} <span className="text-stone-400 text-[10px]">{ln.uom}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums text-emerald-700">
                              {ln.receivedQty.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-bold text-amber-700">
                              {ln.pendingQty.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-semibold text-stone-800">
                              {ln.pendingValue > 0 ? fmtINR(ln.pendingValue) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
