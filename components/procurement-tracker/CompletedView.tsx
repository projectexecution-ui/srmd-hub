'use client'
// Completed-cycle analyzer.
//
// Shows every material line where the GRN has fully closed the PO
// (status === 'received'). For each, we surface:
//   - Procurement lag : days from indent date → first PO date
//                       (how long the purchase team took to act)
//   - Delivery lag    : days from first PO date → last GRN date
//                       (how long the vendor took to deliver)
//   - Total cycle     : days from indent date → last GRN date
//
// At the top: rollup stats so Aksha can see at a glance which stage
// (and which vendor) is the bottleneck.

import { useMemo, useState } from 'react'
import type { LineRecord } from '@/lib/procurement'
import { daysBetween } from '@/lib/procurement/shared'
import { Download, Search, Users, Layers, CheckCircle2, FileSpreadsheet, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { SourceInspector } from './SourceInspector'
import { CardField } from './CardField'

type GroupKey = 'vendor' | 'project' | 'none'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

/** Days from indent date to first PO date. Null if either is unknown. */
function procurementLag(ln: LineRecord): number | null {
  const firstPoDate = ln.pos[0]?.poDate
  if (!firstPoDate || !ln.indentDate) return null
  return daysBetween(ln.indentDate, firstPoDate)
}

/** Days from first PO date to last GRN date. Null if either is unknown. */
function deliveryLag(ln: LineRecord): number | null {
  const firstPoDate = ln.pos[0]?.poDate
  // Last GRN by date — sort string dates descending
  const grnsByDate = [...ln.grns].filter(g => g.grnDate).sort((a, b) => {
    const ta = new Date(a.grnDate).getTime()
    const tb = new Date(b.grnDate).getTime()
    return tb - ta
  })
  const lastGrnDate = grnsByDate[0]?.grnDate
  if (!firstPoDate || !lastGrnDate) return null
  return daysBetween(firstPoDate, lastGrnDate)
}

/** Days from indent date to last GRN date. */
function totalCycle(ln: LineRecord): number | null {
  const grnsByDate = [...ln.grns].filter(g => g.grnDate).sort((a, b) => {
    const ta = new Date(a.grnDate).getTime()
    const tb = new Date(b.grnDate).getTime()
    return tb - ta
  })
  const lastGrnDate = grnsByDate[0]?.grnDate
  if (!ln.indentDate || !lastGrnDate) return null
  return daysBetween(ln.indentDate, lastGrnDate)
}

function lagClass(days: number | null) {
  if (days == null) return 'text-stone-400'
  if (days <= 7)   return 'text-emerald-700 font-semibold'
  if (days <= 21)  return 'text-amber-700 font-medium'
  if (days <= 60)  return 'text-rose-600 font-semibold'
  return 'text-red-700 font-bold'
}

function lastGrnDate(ln: LineRecord): string {
  const dates = [...ln.grns].map(g => g.grnDate).filter(Boolean)
  if (dates.length === 0) return ''
  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const CSV_HEADER = [
  'Indent No', 'Indent Date', 'Material', 'Block', 'Project',
  'Vendor', 'PO No', 'PO Date', 'Last GRN Date',
  'Procurement lag (days)', 'Delivery lag (days)', 'Total cycle (days)',
  'Ordered Qty', 'Received Qty', 'GRN Value (INR)',
]
function csvRow(ln: LineRecord) {
  const po = ln.pos[0]
  return [
    ln.indentNo, ln.indentDate, ln.material, ln.block, ln.project,
    ln.supplier, po?.poNo ?? '', po?.poDate ?? '', lastGrnDate(ln),
    procurementLag(ln) ?? '', deliveryLag(ln) ?? '', totalCycle(ln) ?? '',
    ln.orderedQty, ln.receivedQty, ln.grnValue.toFixed(2),
  ].map(csvEscape).join(',')
}
function downloadCsv(fileName: string, rows: LineRecord[]) {
  const csv = [CSV_HEADER.join(','), ...rows.map(csvRow)].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'completed'
}

function avg(nums: number[]): number | null {
  const valid = nums.filter(n => Number.isFinite(n))
  if (valid.length === 0) return null
  return Math.round(valid.reduce((s, n) => s + n, 0) / valid.length)
}

export function CompletedView({
  lines,
  projectName,
}: {
  lines: LineRecord[]
  projectName: string
}) {
  const [groupBy, setGroupBy] = useState<GroupKey>('vendor')
  const [search, setSearch] = useState('')
  const [inspectingLine, setInspectingLine] = useState<LineRecord | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleCollapsed = (key: string) => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Only completed lines (PO raised AND fully received)
  const completed = useMemo(
    () => lines.filter(l => l.status === 'received' && l.pos.length > 0 && l.grns.length > 0),
    [lines],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return completed
    return completed.filter(l =>
      l.material.toLowerCase().includes(q) ||
      l.supplier.toLowerCase().includes(q) ||
      l.indentNo.toLowerCase().includes(q) ||
      (l.pos[0]?.poNo ?? '').toLowerCase().includes(q),
    )
  }, [completed, search])

  // ─── Rollup stats — Aksha's "where to focus" answer ─────────────
  const stats = useMemo(() => {
    const procurement = filtered.map(procurementLag).filter((n): n is number => n != null)
    const delivery   = filtered.map(deliveryLag).filter((n): n is number => n != null)
    const cycle      = filtered.map(totalCycle).filter((n): n is number => n != null)
    return {
      count: filtered.length,
      avgProcurement: avg(procurement),
      avgDelivery: avg(delivery),
      avgCycle: avg(cycle),
      totalValue: filtered.reduce((s, l) => s + l.grnValue, 0),
      // Worst proc lag entries (top 3) → who's slow at raising POs
      worstProcurement: [...filtered]
        .filter(l => procurementLag(l) != null)
        .sort((a, b) => (procurementLag(b) ?? 0) - (procurementLag(a) ?? 0))
        .slice(0, 3),
      // Worst delivery lag entries → which vendors are slow
      worstDelivery: [...filtered]
        .filter(l => deliveryLag(l) != null)
        .sort((a, b) => (deliveryLag(b) ?? 0) - (deliveryLag(a) ?? 0))
        .slice(0, 3),
    }
  }, [filtered])

  // ─── Group rows by vendor / project / no grouping ───────────────
  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: `All ${filtered.length} completed lines`, lines: filtered }]
    }
    const map = new Map<string, { key: string; label: string; lines: LineRecord[] }>()
    for (const ln of filtered) {
      const key = groupBy === 'vendor' ? (ln.supplier || '— Unknown vendor —') : (ln.project || 'Unknown')
      let g = map.get(key)
      if (!g) { g = { key, label: key, lines: [] }; map.set(key, g) }
      g.lines.push(ln)
    }
    // Sort groups by SLOWEST avg total cycle (so worst bottlenecks bubble up)
    return Array.from(map.values()).sort((a, b) => {
      const ca = avg(a.lines.map(totalCycle).filter((n): n is number => n != null)) ?? 0
      const cb = avg(b.lines.map(totalCycle).filter((n): n is number => n != null)) ?? 0
      return cb - ca
    })
  }, [filtered, groupBy])

  if (completed.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
        <CheckCircle2 className="h-8 w-8 text-stone-300 mx-auto mb-2" />
        <p className="text-stone-700 font-medium">No completed deliveries yet.</p>
        <p className="text-stone-500 text-sm">Once a PO is raised AND fully received, it shows up here with the full-cycle time.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Top stats: avg cycle time per stage ──────────────────── */}
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-stone-800">Completed deliveries</h3>
            <p className="text-xs text-stone-500 mt-0.5">
              <b className="text-stone-800">{stats.count}</b> material line{stats.count === 1 ? '' : 's'} fully delivered · <b className="text-emerald-700">{fmtINR(stats.totalValue)}</b> received value
            </p>
          </div>
          <button
            onClick={() => downloadCsv(`${safe(projectName)}-completed-${new Date().toISOString().slice(0, 10)}.csv`, filtered)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download all ({filtered.length})
          </button>
        </div>

        {/* Three-stage cycle stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatTile
            label="Procurement lag"
            value={stats.avgProcurement}
            sub="avg · indent → PO"
            hint="your purchase team's speed"
          />
          <StatTile
            label="Delivery lag"
            value={stats.avgDelivery}
            sub="avg · PO → last GRN"
            hint="vendor's speed"
          />
          <StatTile
            label="Total cycle"
            value={stats.avgCycle}
            sub="avg · indent → received"
            hint="end-to-end"
            emphasized
          />
        </div>

        {/* Where to focus — worst-offender callouts */}
        {(stats.worstProcurement.length > 0 || stats.worstDelivery.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-stone-100">
            {stats.worstProcurement.length > 0 && (
              <div className="bg-rose-50/40 rounded-lg p-3 border border-rose-100">
                <p className="text-[10px] uppercase tracking-wider font-bold text-rose-700 inline-flex items-center gap-1 mb-1.5">
                  <AlertTriangle className="h-3 w-3" /> Slowest indent → PO
                </p>
                <p className="text-[11px] text-stone-500 mb-1">Push your purchase team to act faster on these:</p>
                <ul className="text-xs space-y-1">
                  {stats.worstProcurement.map((l, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className={`font-bold tabular-nums ${lagClass(procurementLag(l))}`}>{procurementLag(l)}d</span>
                      <span className="text-stone-700 truncate" title={`${l.indentNo} · ${l.material}`}>
                        {l.material.slice(0, 50)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stats.worstDelivery.length > 0 && (
              <div className="bg-amber-50/40 rounded-lg p-3 border border-amber-100">
                <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700 inline-flex items-center gap-1 mb-1.5">
                  <AlertTriangle className="h-3 w-3" /> Slowest PO → delivery
                </p>
                <p className="text-[11px] text-stone-500 mb-1">Vendors who delivered slowest:</p>
                <ul className="text-xs space-y-1">
                  {stats.worstDelivery.map((l, i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className={`font-bold tabular-nums ${lagClass(deliveryLag(l))}`}>{deliveryLag(l)}d</span>
                      <span className="text-stone-700 truncate" title={`${l.supplier} · ${l.material}`}>
                        {l.supplier || '—'} · {l.material.slice(0, 35)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 pt-3">
          <div className="flex w-full sm:w-auto sm:inline-flex bg-stone-100 rounded-lg p-0.5">
            <button onClick={() => setGroupBy('vendor')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'vendor' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}>
              <Users className="h-3 w-3 flex-shrink-0" /> By vendor
            </button>
            <button onClick={() => setGroupBy('project')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'project' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}>
              <Layers className="h-3 w-3 flex-shrink-0" /> By project
            </button>
            <button onClick={() => setGroupBy('none')}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                groupBy === 'none' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'
              }`}>
              Flat list
            </button>
          </div>

          <div className="relative w-full sm:w-auto">
            <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search material / vendor / indent…"
              className="text-sm bg-white border border-stone-300 rounded-lg pl-7 pr-3 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300 w-full sm:w-auto sm:min-w-[240px]"
            />
          </div>

          {groups.length > 1 && (
            <div className="flex w-full sm:w-auto sm:ml-auto gap-1 justify-end">
              <button
                onClick={() => setCollapsed(new Set(groups.map(g => g.key)))}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1"
                title="Collapse every group"
              >
                <ChevronRight className="h-3 w-3" /> Collapse all
              </button>
              <button
                onClick={() => setCollapsed(new Set())}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1"
                title="Expand every group"
              >
                <ChevronDown className="h-3 w-3" /> Expand all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Grouped table — each line shows the three-stage cycle ──── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-10 text-center">
          <FileSpreadsheet className="h-7 w-7 text-stone-300 mx-auto mb-2" />
          <p className="text-stone-500 text-sm">No matches.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(g => {
            const groupCycle = avg(g.lines.map(totalCycle).filter((n): n is number => n != null))
            const groupValue = g.lines.reduce((s, l) => s + l.grnValue, 0)
            const isCollapsed = collapsed.has(g.key)
            return (
              <div key={g.key} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                {/* Group header — click anywhere except CSV to toggle */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(g.key)}
                    className="flex items-baseline gap-2 min-w-0 flex-1 text-left hover:opacity-80 flex-wrap"
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-stone-400 flex-shrink-0 self-center" />
                      : <ChevronDown  className="h-4 w-4 text-stone-400 flex-shrink-0 self-center" />}
                    <span className="font-semibold text-stone-800 truncate" title={g.label}>{g.label}</span>
                    <span className="text-[11px] text-stone-500">
                      {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {fmtINR(groupValue)} received
                    </span>
                    {groupCycle != null && (
                      <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${lagClass(groupCycle)} bg-white border border-stone-200`}>
                        avg {groupCycle}d total
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => downloadCsv(`${safe(g.label)}-completed-${new Date().toISOString().slice(0, 10)}.csv`, g.lines)}
                    className="inline-flex items-center justify-center gap-1 text-[11px] font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 h-8 w-8 sm:w-auto sm:px-2 rounded-md flex-shrink-0"
                    title={`Download just ${g.label}`}
                  >
                    <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">CSV</span>
                  </button>
                </div>
                {!isCollapsed && (
                <>
                {/* Desktop: full table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-stone-100">
                      <tr>
                        {groupBy !== 'vendor' && <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Vendor</th>}
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Material</th>
                        <th className="text-left px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Indent → PO → GRN</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Indent date → PO date">Proc lag</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="PO date → last GRN date">Deliv lag</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide" title="Indent date → last GRN date">Total</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Qty</th>
                        <th className="text-right px-4 py-2 text-[10px] font-medium text-stone-500 uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {[...g.lines]
                        .sort((a, b) => (totalCycle(b) ?? 0) - (totalCycle(a) ?? 0))
                        .map(ln => {
                          const po = ln.pos[0]
                          const grnEnd = lastGrnDate(ln)
                          const proc = procurementLag(ln)
                          const deliv = deliveryLag(ln)
                          const total = totalCycle(ln)
                          return (
                            <tr key={ln.id} className="hover:bg-stone-50">
                              {groupBy !== 'vendor' && (
                                <td className="px-4 py-2 text-xs text-stone-700 max-w-[160px] truncate" title={ln.supplier}>{ln.supplier || '—'}</td>
                              )}
                              <td className="px-4 py-2 text-xs text-stone-800 max-w-[240px]">
                                <div className="flex items-start gap-1.5">
                                  <span className="line-clamp-2 flex-1" title={ln.material}>{ln.material}</span>
                                  <button type="button" onClick={() => setInspectingLine(ln)}
                                    className="text-stone-400 hover:text-orange-700 flex-shrink-0 mt-0.5"
                                    title="Show source Excel rows">
                                    <Search className="h-3 w-3" />
                                  </button>
                                </div>
                                <span className="text-[10px] text-stone-400">{ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')} · {ln.block}</span>
                              </td>
                              <td className="px-4 py-2 text-[10px] text-stone-500 whitespace-nowrap font-mono">
                                <div>{ln.indentDate || '—'}</div>
                                <div className="text-stone-400">↓ {po?.poDate || '—'}</div>
                                <div className="text-stone-400">↓ {grnEnd || '—'}</div>
                              </td>
                              <td className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${lagClass(proc)}`}>
                                {proc != null ? `${proc}d` : '—'}
                              </td>
                              <td className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${lagClass(deliv)}`}>
                                {deliv != null ? `${deliv}d` : '—'}
                              </td>
                              <td className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap ${lagClass(total)}`}>
                                {total != null ? `${total}d` : '—'}
                              </td>
                              <td className="px-4 py-2 text-right text-xs tabular-nums text-stone-700 whitespace-nowrap">
                                {ln.receivedQty.toLocaleString('en-IN')} <span className="text-stone-400 text-[10px]">{ln.uom}</span>
                              </td>
                              <td className="px-4 py-2 text-right text-xs tabular-nums font-semibold text-stone-800 whitespace-nowrap">
                                {ln.grnValue > 0 ? fmtINR(ln.grnValue) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: stacked cards (no horizontal scroll) */}
                <div className="md:hidden divide-y divide-stone-100">
                  {[...g.lines]
                    .sort((a, b) => (totalCycle(b) ?? 0) - (totalCycle(a) ?? 0))
                    .map(ln => {
                      const proc = procurementLag(ln)
                      const deliv = deliveryLag(ln)
                      const total = totalCycle(ln)
                      return (
                        <div key={ln.id} onClick={() => setInspectingLine(ln)}
                          className="p-3 cursor-pointer active:bg-stone-50">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-stone-800 line-clamp-2" title={ln.material}>{ln.material}</p>
                              <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                                {groupBy !== 'vendor' && ln.supplier ? `${ln.supplier} · ` : ''}
                                {ln.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}{ln.block ? ` · ${ln.block}` : ''}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-stone-300 flex-shrink-0 mt-0.5" />
                          </div>
                          <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
                            <CardField label="Proc lag" className={lagClass(proc)}>{proc != null ? `${proc}d` : '—'}</CardField>
                            <CardField label="Deliv lag" className={lagClass(deliv)}>{deliv != null ? `${deliv}d` : '—'}</CardField>
                            <CardField label="Total" className={lagClass(total)}>{total != null ? `${total}d` : '—'}</CardField>
                            <CardField label="Qty" className="text-stone-700">{ln.receivedQty.toLocaleString('en-IN')} {ln.uom}</CardField>
                            <CardField label="Value" className="text-stone-800 font-semibold">{ln.grnValue > 0 ? fmtINR(ln.grnValue) : '—'}</CardField>
                          </div>
                        </div>
                      )
                    })}
                </div>
                </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <SourceInspector line={inspectingLine} onClose={() => setInspectingLine(null)} />
    </div>
  )
}

function StatTile({
  label, value, sub, hint, emphasized,
}: { label: string; value: number | null; sub: string; hint?: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${
      emphasized ? 'bg-orange-50/60 border-orange-200' : 'bg-stone-50 border-stone-100'
    }`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-stone-500" title={hint}>{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${
        emphasized ? 'text-orange-900' : value != null && value > 30 ? 'text-rose-700' : 'text-stone-800'
      }`}>
        {value != null ? `${value}d` : '—'}
      </p>
      <p className="text-[11px] text-stone-500 leading-tight mt-0.5">{sub}</p>
    </div>
  )
}
