'use client'
// Sister of PendingReceiptsView. Shows material lines where the purchase
// team has NOT raised a PO yet (line.status === 'no_po'). Grouped by
// indent (default) or by block, sorted oldest indent first. Same UX
// language as PendingReceiptsView — same age filter chips, same per-
// group CSV export, same look.
//
// Why per-LINE and not per-indent? Because in real exports an indent
// often has 10 materials and only 7 are PO'd — the other 3 still need
// chasing. A pure indent-status filter would miss them.

import { useEffect, useMemo, useState } from 'react'
import type { LineRecord } from '@/lib/procurement'
import { formatAgeFriendly } from '@/lib/procurement/shared'
import { Download, ClipboardList, Layers, AlertTriangle, FileSpreadsheet, CheckCircle2, Search } from 'lucide-react'
import { ChangeBadge } from './ChangeBadge'
import { SourceInspector } from './SourceInspector'

type GroupKey = 'indent' | 'block'
type AgeFilter = 'all' | '7' | '14' | '30'

const GROUP_KEY_STORAGE = 'ct-procurement-needspo-groupby'

function ageDays(ln: LineRecord): number | null {
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
  'Indent No', 'Indent Date', 'Days waiting', 'Project / Block',
  'Material', 'UOM', 'Indent Qty',
]
function csvRow(ln: LineRecord) {
  return [
    ln.indentNo, ln.indentDate, ageDays(ln) ?? '',
    ln.block, ln.material, ln.uom, ln.indentQty,
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

export function IndentsNeedingPoView({
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
  const [groupBy, setGroupBy] = useState<GroupKey>('indent')
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('all')
  const [inspectingLine, setInspectingLine] = useState<LineRecord | null>(null)

  // Restore preference
  useEffect(() => {
    try {
      const v = localStorage.getItem(GROUP_KEY_STORAGE)
      if (v === 'indent' || v === 'block') setGroupBy(v)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(GROUP_KEY_STORAGE, groupBy) } catch { /* ignore */ }
  }, [groupBy])

  // Only no-PO lines
  const needsPo = useMemo(() => {
    return lines.filter(ln => ln.status === 'no_po')
  }, [lines])

  const filtered = useMemo(() => {
    const threshold = ageFilter === 'all' ? null : Number(ageFilter)
    if (threshold == null) return needsPo
    return needsPo.filter(ln => (ageDays(ln) ?? 0) >= threshold)
  }, [needsPo, ageFilter])

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; subLabel: string; lines: LineRecord[] }>()
    for (const ln of filtered) {
      const key = groupBy === 'indent' ? ln.indentNo : (ln.block || '— Unknown block —')
      const label = groupBy === 'indent'
        ? ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')
        : (ln.block || '— Unknown block —')
      const subLabel = groupBy === 'indent' ? `${ln.block} · ${ln.indentDate}` : ''
      let g = map.get(key)
      if (!g) { g = { key, label, subLabel, lines: [] }; map.set(key, g) }
      g.lines.push(ln)
    }
    for (const g of map.values()) {
      g.lines.sort((a, b) => (ageDays(b) ?? 0) - (ageDays(a) ?? 0))
    }
    // Sort groups by oldest waiting line desc (most urgent first)
    return Array.from(map.values()).sort((a, b) => {
      const ageA = Math.max(0, ...a.lines.map(l => ageDays(l) ?? 0))
      const ageB = Math.max(0, ...b.lines.map(l => ageDays(l) ?? 0))
      return ageB - ageA
    })
  }, [filtered, groupBy])

  const totalLines = filtered.length
  const uniqueIndents = new Set(filtered.map(l => l.indentNo)).size

  // Aging buckets across the full no-PO set
  const buckets = useMemo(() => {
    const out = { 'lt7': 0, '7to14': 0, '14to30': 0, '30plus': 0 }
    for (const ln of needsPo) {
      const a = ageDays(ln) ?? 0
      if (a < 7) out.lt7++
      else if (a < 14) out['7to14']++
      else if (a < 30) out['14to30']++
      else out['30plus']++
    }
    return out
  }, [needsPo])
  const bucketTotal = needsPo.length || 1

  if (lines.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <FileSpreadsheet className="h-8 w-8 text-stone-300 mx-auto mb-2" />
        <p className="text-stone-500 text-sm">No data — upload a report first.</p>
      </div>
    )
  }
  if (needsPo.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
        <p className="text-stone-700 font-medium">Every material has a PO.</p>
        <p className="text-stone-500 text-sm">Nothing waiting on your purchase team.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top stats + controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-stone-800">Indents needing PO</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              <b className="text-stone-800">{totalLines}</b> material line{totalLines === 1 ? '' : 's'} waiting on purchase team
              {' · '}across <b className="text-stone-800">{uniqueIndents}</b> indent{uniqueIndents === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={() => downloadCsv(`${safe(projectName)}-needs-po-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download all ({filtered.length})
          </button>
        </div>

        {/* Aging buckets */}
        {needsPo.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">
              <span>Aging buckets — click to filter</span>
              <span>{needsPo.length} total waiting</span>
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
              onClick={() => setGroupBy('indent')}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'indent' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <ClipboardList className="h-3 w-3" /> Group by indent
            </button>
            <button
              onClick={() => setGroupBy('block')}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'block' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <Layers className="h-3 w-3" /> Group by block
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
          <p className="text-stone-500 text-sm">Nothing waiting at this threshold.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
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
                        {g.lines.length} line{g.lines.length === 1 ? '' : 's'} waiting
                        {g.subLabel ? ` · ${g.subLabel}` : ''}
                      </span>
                      {oldestAge != null && oldestAge >= 7 && (
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${ageClass(oldestAge)} bg-white border border-stone-200`}>
                          {oldestAge}d
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => downloadCsv(`${safe(g.label)}-needs-po-${new Date().toISOString().slice(0, 10)}.csv`, g.lines)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 px-2 py-1 rounded-md flex-shrink-0"
                    title={`Download just ${g.label}`}
                  >
                    <Download className="h-3 w-3" /> CSV
                  </button>
                </div>

                {/* Lines */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-stone-100">
                      <tr>
                        {groupBy === 'block' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Indent</th>}
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Material</th>
                        {groupBy === 'indent' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Block</th>}
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Qty needed</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Days waiting</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {g.lines.map(ln => {
                        const age = ageDays(ln)
                        const fmt = formatAgeFriendly(age)
                        return (
                          <tr key={ln.id} className="hover:bg-stone-50">
                            {groupBy === 'block' && (
                              <td className="px-4 py-2 font-mono text-[11px] text-stone-700 whitespace-nowrap" title={ln.indentNo}>
                                {ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                              </td>
                            )}
                            <td className="px-4 py-2 text-xs text-stone-800 max-w-[320px]">
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
                            </td>
                            {groupBy === 'indent' && (
                              <td className="px-4 py-2 text-[11px] text-stone-500">{ln.block || '—'}</td>
                            )}
                            <td className="px-4 py-2 text-right text-xs tabular-nums font-bold text-amber-700">
                              {ln.indentQty.toLocaleString('en-IN')} <span className="text-stone-400 text-[10px] font-normal">{ln.uom}</span>
                            </td>
                            <td
                              className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${ageClass(age)}`}
                              title={ln.indentDate ? `Indent date: ${ln.indentDate}` : 'Indent date unknown'}
                            >
                              <div>{fmt.short}</div>
                              {fmt.long && (
                                <div className="text-[10px] font-normal text-stone-400 leading-tight">{fmt.long}</div>
                              )}
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
