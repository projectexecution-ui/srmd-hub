'use client'
import { useState, useMemo, useEffect, Fragment } from 'react'
import type { IndentRollup, IndentStatus, LineRecord, ReportFormat } from '@/lib/procurement'
import { StatusBadge, LineStatusBadge } from './StatusBadge'
import { ArrowUpDown, Download, ChevronRight, ChevronDown, Sparkles } from 'lucide-react'

const STATUS_FILTERS: { label: string; value: IndentStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'GRN Received', value: 'PO Done & GRN Received' },
  { label: 'GRN Pending', value: 'PO Raised – GRN Pending' },
  { label: 'No PO Yet', value: 'Indent Only – No PO' },
]

type SortKey = 'indentNo' | 'indentDate' | 'worstAgeDays' | 'block' | 'pendingValue' | 'status'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

function ageClass(r: IndentRollup) {
  if (r.status !== 'Indent Only – No PO' || r.worstAgeDays == null) return 'text-stone-500'
  if (r.worstAgeDays >= 14) return 'text-red-700 font-bold'
  if (r.worstAgeDays >= 7) return 'text-amber-700 font-semibold'
  return 'text-stone-500'
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function IndentTable({
  indents, lines, projectName, format,
  changedIndents,
  externalStatusFilter,
  onExternalStatusFilterChange,
}: {
  indents: IndentRollup[]
  lines: LineRecord[]
  projectName: string
  format?: ReportFormat
  /** Indents whose status changed since the last upload — get a ✨ marker. */
  changedIndents?: Set<string>
  /** Optional controlled filter so SummaryCards / FunnelBand can set it. */
  externalStatusFilter?: IndentStatus | 'all'
  onExternalStatusFilterChange?: (v: IndentStatus | 'all') => void
}) {
  const [internalStatusFilter, setInternalStatusFilter] = useState<IndentStatus | 'all'>('all')
  const statusFilter = externalStatusFilter ?? internalStatusFilter
  const setStatusFilter = (v: IndentStatus | 'all') => {
    setInternalStatusFilter(v)
    onExternalStatusFilterChange?.(v)
  }
  useEffect(() => { if (externalStatusFilter != null) setInternalStatusFilter(externalStatusFilter) }, [externalStatusFilter])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('indentDate')
  const [sortDesc, setSortDesc] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 25
  const showInvoiceColumn = format === 'flat'

  const linesByIndent = useMemo(() => {
    const m = new Map<string, LineRecord[]>()
    for (const ln of lines) {
      let arr = m.get(ln.indentNo)
      if (!arr) { arr = []; m.set(ln.indentNo, arr) }
      arr.push(ln)
    }
    return m
  }, [lines])

  const filtered = useMemo(() => {
    let out = indents
    if (statusFilter !== 'all') out = out.filter(r => r.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(r => {
        if (r.indentNo.toLowerCase().includes(q)) return true
        if (r.suppliers.some(s => s.toLowerCase().includes(q))) return true
        if (r.poNos.some(p => p.toLowerCase().includes(q))) return true
        const memberLines = linesByIndent.get(r.indentNo) ?? []
        return memberLines.some(ln =>
          ln.material.toLowerCase().includes(q) ||
          ln.discipline.toLowerCase().includes(q),
        )
      })
    }
    return out
  }, [indents, lines, linesByIndent, statusFilter, search])

  const sorted = useMemo(() => {
    const cmp = (a: IndentRollup, b: IndentRollup): number => {
      let x: string | number | null | undefined
      let y: string | number | null | undefined
      switch (sortKey) {
        case 'indentNo':      x = a.indentNo; y = b.indentNo; break
        case 'indentDate':    x = a.indentDate; y = b.indentDate; break
        case 'worstAgeDays':  x = a.worstAgeDays ?? -1; y = b.worstAgeDays ?? -1; break
        case 'block':         x = a.block; y = b.block; break
        case 'pendingValue':  x = a.pendingValue; y = b.pendingValue; break
        case 'status':        x = a.status; y = b.status; break
      }
      const xn = x ?? '', yn = y ?? ''
      if (xn < yn) return sortDesc ? 1 : -1
      if (xn > yn) return sortDesc ? -1 : 1
      return 0
    }
    return [...filtered].sort(cmp)
  }, [filtered, sortKey, sortDesc])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  function toggle(indentNo: string) {
    setExpanded(s => {
      const next = new Set(s)
      if (next.has(indentNo)) next.delete(indentNo); else next.add(indentNo)
      return next
    })
  }

  function exportCsv() {
    const header = [
      'Indent No', 'Indent Date', 'Block', 'Material', 'UOM',
      'Ordered Qty', 'Received Qty', 'Pending Qty',
      'Suppliers', 'PO Nos', 'GRN Count',
      'Pending Value (INR)', 'GRN Value (INR)', 'Line Status',
    ]
    const rows: string[] = []
    for (const r of sorted) {
      const memberLines = linesByIndent.get(r.indentNo) ?? []
      for (const ln of memberLines) {
        rows.push([
          ln.indentNo, ln.indentDate, ln.block, ln.material, ln.uom,
          ln.orderedQty, ln.receivedQty, ln.pendingQty,
          ln.pos.map(p => p.supplier).filter(Boolean).join('; '),
          ln.pos.map(p => p.poNo).join('; '),
          ln.grns.length,
          ln.pendingValue.toFixed(2), ln.grnValue.toFixed(2), ln.status,
        ].map(csvEscape).join(','))
      }
    }
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/[^a-z0-9]+/gi, '-')}-procurement-lines-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortableTh = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => (
    <th
      onClick={() => handleSort(k)}
      className={`px-4 py-2.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide cursor-pointer hover:text-stone-800 ${num ? 'text-right' : 'text-left'}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === k ? 'text-stone-700' : 'text-stone-300'}`} />
      </span>
    </th>
  )

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-stone-100">
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {f.label}
              {f.value !== 'all' && (
                <span className="ml-1.5 opacity-70">
                  {indents.filter(r => r.status === f.value).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search indent, material, supplier, PO…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="ml-auto text-sm border border-stone-200 rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-stone-800 text-white px-3 py-1.5 rounded-lg hover:bg-stone-700"
        >
          <Download className="h-3.5 w-3.5" /> Export lines CSV
        </button>
        <span className="text-xs text-stone-400 w-full sm:w-auto">{sorted.length} indents · {lines.length} lines total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-100">
            <tr>
              <th className="w-8"></th>
              <SortableTh k="indentNo"     label="Indent no." />
              <SortableTh k="indentDate"   label="Date" />
              <SortableTh k="worstAgeDays" label="Age" num />
              <SortableTh k="block"        label="Block" />
              <th className="px-4 py-2.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide text-left">Lines</th>
              <SortableTh k="status"       label="Status" />
              <th className="px-4 py-2.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide text-left">Funnel</th>
              <SortableTh k="pendingValue" label="Pending value" num />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {paged.map((r) => {
              const isOpen = expanded.has(r.indentNo)
              const memberLines = linesByIndent.get(r.indentNo) ?? []
              return (
                <Fragment key={r.indentNo}>
                  <tr
                    className={`hover:bg-stone-50 transition-colors cursor-pointer ${
                      r.status === 'Indent Only – No PO' ? 'bg-red-50/30'
                      : r.status === 'PO Raised – GRN Pending' ? 'bg-amber-50/20' : ''
                    }`}
                    onClick={() => toggle(r.indentNo)}
                  >
                    <td className="px-2 py-2.5 text-stone-400">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-700 whitespace-nowrap">
                      {r.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                      {changedIndents?.has(r.indentNo) && (
                        <span title="Changed since last upload" className="ml-1.5 inline-flex items-center text-amber-600">
                          <Sparkles className="h-3 w-3" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{r.indentDate || '—'}</td>
                    <td className={`px-4 py-2.5 text-xs text-right tabular-nums whitespace-nowrap ${ageClass(r)}`}>
                      {r.worstAgeDays != null ? `${r.worstAgeDays}d` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[140px] truncate" title={r.block}>
                      {r.block || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-600 tabular-nums">{r.totalLines}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-[11px] text-stone-600 whitespace-nowrap tabular-nums">
                      PO <b className="text-stone-800">{r.linesWithPo}</b>/{r.totalLines} ·{' '}
                      GRN <b className="text-stone-800">{r.linesReceived}</b>/{r.totalLines}
                      {showInvoiceColumn && <> · Inv <b className="text-indigo-700">{r.linesInvoiced}</b>/{r.totalLines}</>}
                      {r.linesPartial > 0 && <span className="text-amber-700"> · {r.linesPartial} part.</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-right tabular-nums font-semibold text-amber-700 whitespace-nowrap">
                      {r.pendingValue > 0 ? fmtINR(r.pendingValue) : '—'}
                    </td>
                  </tr>

                  {/* Expanded line breakdown */}
                  {isOpen && (
                    <tr className="bg-stone-50/50">
                      <td colSpan={9} className="p-0">
                        <div className="px-4 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                                <th className="text-left py-1.5 pr-3">Material</th>
                                <th className="text-right py-1.5 px-2">Ordered</th>
                                <th className="text-right py-1.5 px-2">Received</th>
                                <th className="text-right py-1.5 px-2">Pending</th>
                                <th className="text-left py-1.5 px-2">Supplier(s)</th>
                                <th className="text-left py-1.5 px-2">PO / GRN</th>
                                <th className="text-left py-1.5 pl-2">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {memberLines.map(ln => (
                                <tr key={ln.id}>
                                  <td className="py-1.5 pr-3 text-stone-800 max-w-[260px] line-clamp-2" title={ln.material}>
                                    {ln.material || '—'}
                                    <span className="text-stone-400 ml-1">({ln.uom})</span>
                                  </td>
                                  <td className="text-right tabular-nums text-stone-700 py-1.5 px-2">{ln.orderedQty.toLocaleString('en-IN')}</td>
                                  <td className="text-right tabular-nums text-emerald-700 py-1.5 px-2">{ln.receivedQty.toLocaleString('en-IN')}</td>
                                  <td className={`text-right tabular-nums py-1.5 px-2 ${ln.pendingQty > 0 ? 'text-amber-700 font-semibold' : 'text-stone-400'}`}>
                                    {ln.pendingQty.toLocaleString('en-IN')}
                                  </td>
                                  <td className="py-1.5 px-2 text-stone-600 max-w-[160px] truncate" title={ln.pos.map(p => p.supplier).join(', ')}>
                                    {ln.supplier || '—'}{ln.vendorCount > 1 ? ` +${ln.vendorCount - 1}` : ''}
                                  </td>
                                  <td className="py-1.5 px-2 text-[10px] text-stone-500 font-mono whitespace-nowrap">
                                    {ln.pos.length} PO · {ln.grns.length} GRN
                                  </td>
                                  <td className="py-1.5 pl-2">
                                    <LineStatusBadge status={ln.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-stone-400">
                  No records match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
          <span className="text-xs text-stone-400">
            Page {page} of {totalPages} · showing {paged.length} of {sorted.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs rounded-lg bg-stone-100 text-stone-600 disabled:opacity-40 hover:bg-stone-200"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs rounded-lg bg-stone-100 text-stone-600 disabled:opacity-40 hover:bg-stone-200"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
