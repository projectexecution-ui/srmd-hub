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
import type { LineRecord } from '@/lib/procurement'
import { formatAgeFriendly } from '@/lib/procurement/shared'
import { Download, Users, ClipboardList, AlertTriangle, FileSpreadsheet, Search } from 'lucide-react'
import { ChangeBadge } from './ChangeBadge'
import { SourceInspector } from './SourceInspector'

type GroupKey = 'supplier' | 'indent'
type AgeFilter = 'all' | '7' | '14' | '30'

const GROUP_KEY_STORAGE = 'ct-procurement-pending-groupby'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

// PRIMARY age = days since the INDENT was raised — that's the clock
// that matters to a project manager chasing a supplier. PO age is
// secondary context: "yes, indent is 230d old, but PO is only 30d
// old so the supplier isn't really late."
function indentAge(ln: LineRecord): number | null {
  return ln.indentAgeDays
}
function poAge(ln: LineRecord): number | null {
  return ln.oldestPoAgeDays
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
  'Supplier', 'PO No', 'PO Date', 'Days since PO',
  'Indent No', 'Indent Date', 'Days since indent',
  'Project / Block', 'Material', 'UOM',
  'Ordered', 'Received', 'Pending',
  'Pending Value (INR)',
]
function csvRow(ln: LineRecord) {
  const po = ln.pos[0]
  return [
    ln.supplier, po?.poNo ?? '', po?.poDate ?? '', poAge(ln) ?? '',
    ln.indentNo, ln.indentDate, indentAge(ln) ?? '',
    ln.block, ln.material, ln.uom,
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
  newLineIds,
  changedLineIds,
}: {
  lines: LineRecord[]
  projectName: string
  /** Line ids that didn't exist in the prior upload. Renders the green NEW pill. */
  newLineIds?: Set<string>
  /** Line ids that existed before but have changed. Renders the amber Updated pill. */
  changedLineIds?: Set<string>
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('supplier')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  // Line currently shown in the source-rows inspector modal (or null = closed).
  const [inspectingLine, setInspectingLine] = useState<LineRecord | null>(null)

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
    // Filter by INDENT age — matches the buckets bar above the list.
    return pending.filter(ln => (indentAge(ln) ?? 0) >= threshold)
  }, [pending, ageFilter])

  // Group + sort by INDENT age (oldest indent first within each group)
  // so the longest-outstanding requests bubble up.
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
      g.lines.sort((a, b) => (indentAge(b) ?? 0) - (indentAge(a) ?? 0))
    }
    // Sort groups by total pending value desc
    return Array.from(map.values()).sort((a, b) =>
      b.lines.reduce((s, l) => s + l.pendingValue, 0)
      - a.lines.reduce((s, l) => s + l.pendingValue, 0))
  }, [filtered, groupBy])

  // Top-level stats
  const totalPendingValue = filtered.reduce((s, l) => s + l.pendingValue, 0)
  const totalPendingLines = filtered.length

  // Aging buckets — based on INDENT age (days since the indent was raised).
  // That's the clock that matters to the project manager.
  const buckets = useMemo(() => {
    const out = { 'lt7': 0, '7to14': 0, '14to30': 0, '30plus': 0 }
    for (const ln of pending) {
      const a = indentAge(ln) ?? 0
      if (a < 7) out.lt7++
      else if (a < 14) out['7to14']++
      else if (a < 30) out['14to30']++
      else out['30plus']++
    }
    return out
  }, [pending])
  const bucketTotal = pending.length || 1

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

        {/* Aging buckets — click any segment to filter to that age range */}
        {pending.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">
              <span>Aging buckets — click to filter</span>
              <span>{pending.length} total pending</span>
            </div>
            <div className="flex h-7 w-full rounded-md overflow-hidden border border-stone-200">
              <button
                type="button" onClick={() => setAgeFilter('all')}
                style={{ width: `${(buckets.lt7 / bucketTotal) * 100}%` }}
                className="bg-stone-200 hover:bg-stone-300 text-[11px] font-medium text-stone-700 inline-flex items-center justify-center min-w-0 px-1"
                title={`${buckets.lt7} lines under 7 days`}
              >
                {buckets.lt7 > 0 && `<7d: ${buckets.lt7}`}
              </button>
              <button
                type="button" onClick={() => setAgeFilter('7')}
                style={{ width: `${(buckets['7to14'] / bucketTotal) * 100}%` }}
                className="bg-amber-300 hover:bg-amber-400 text-[11px] font-medium text-amber-900 inline-flex items-center justify-center min-w-0 px-1"
                title={`${buckets['7to14']} lines 7-14 days`}
              >
                {buckets['7to14'] > 0 && `7-14d: ${buckets['7to14']}`}
              </button>
              <button
                type="button" onClick={() => setAgeFilter('14')}
                style={{ width: `${(buckets['14to30'] / bucketTotal) * 100}%` }}
                className="bg-rose-400 hover:bg-rose-500 text-[11px] font-medium text-rose-900 inline-flex items-center justify-center min-w-0 px-1"
                title={`${buckets['14to30']} lines 14-30 days`}
              >
                {buckets['14to30'] > 0 && `14-30d: ${buckets['14to30']}`}
              </button>
              <button
                type="button" onClick={() => setAgeFilter('30')}
                style={{ width: `${(buckets['30plus'] / bucketTotal) * 100}%` }}
                className="bg-red-600 hover:bg-red-700 text-[11px] font-medium text-white inline-flex items-center justify-center min-w-0 px-1"
                title={`${buckets['30plus']} lines 30+ days`}
              >
                {buckets['30plus'] > 0 && `30+d: ${buckets['30plus']}`}
              </button>
            </div>
          </div>
        )}

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
            // "Oldest" in the group header = oldest indent age — same
            // anchor as the table sort + aging buckets, so the user
            // sees one consistent clock per group.
            const oldestAge = g.lines.reduce<number | null>((mx, l) => {
              const a = indentAge(l)
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
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Days since the indent was raised (your primary clock)">
                          Since indent
                        </th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Days since PO was raised — '—' if no PO yet">
                          Since PO
                        </th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Ordered</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Received</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Pending</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {g.lines.map(ln => {
                        const po = ln.pos[0]
                        const indentAg = indentAge(ln)
                        const poAg = poAge(ln)
                        const indentFmt = formatAgeFriendly(indentAg)
                        const poFmt = formatAgeFriendly(poAg)
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
                              <div className="flex items-start gap-1.5">
                                <ChangeBadge id={ln.id} newLineIds={newLineIds} changedLineIds={changedLineIds} />
                                <span className="line-clamp-2 flex-1" title={ln.material}>{ln.material}</span>
                                <button
                                  type="button"
                                  onClick={() => setInspectingLine(ln)}
                                  className="text-stone-400 hover:text-orange-700 flex-shrink-0 mt-0.5"
                                  title="Show the Excel rows that built this entry"
                                  aria-label="Inspect source rows"
                                >
                                  <Search className="h-3 w-3" />
                                </button>
                              </div>
                              <span className="text-[10px] text-stone-400">{ln.block}</span>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-stone-500 whitespace-nowrap" title={po?.poNo}>
                              {po?.poNo ? (
                                <span className="inline-flex items-center gap-1">
                                  {po.draft && (
                                    <span
                                      className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                                      title="DRAFT-PO/… — purchase team raised it but not yet finalised in IN4"
                                    >
                                      Draft
                                    </span>
                                  )}
                                  {po.inferred && (
                                    <span
                                      className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200"
                                      title="IN4 export dropped this PO's details on this row but the same PO appears on another material in the same indent. Inferred — verify in IN4."
                                    >
                                      Inferred
                                    </span>
                                  )}
                                  <span>
                                    {po.poNo
                                      .replace('DRAFT-PO/', '')
                                      .replace('PO/SRASSK/', '')
                                      .replace('PO/SRET/', '')}
                                  </span>
                                </span>
                              ) : '—'}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(indentAg)}`}
                              title={ln.indentDate ? `Indent date: ${ln.indentDate}` : 'Indent date unknown'}
                            >
                              <div>{indentFmt.short}</div>
                              {indentFmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{indentFmt.long}</div>
                              )}
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(poAg)}`}
                              title={po?.poDate ? `PO date: ${po.poDate}` : 'No PO yet'}
                            >
                              <div>{poFmt.short}</div>
                              {poFmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{poFmt.long}</div>
                              )}
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
      <SourceInspector line={inspectingLine} onClose={() => setInspectingLine(null)} />
    </div>
  )
}
