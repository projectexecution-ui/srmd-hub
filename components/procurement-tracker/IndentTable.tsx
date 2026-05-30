'use client'
import { useState, useMemo } from 'react'
import type { IndentRecord, IndentStatus } from '@/lib/procurement-tracker'
import { StatusBadge } from './StatusBadge'
import { ArrowUpDown, Download } from 'lucide-react'

const STATUS_FILTERS: { label: string; value: IndentStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'GRN Received', value: 'PO Done & GRN Received' },
  { label: 'GRN Pending', value: 'PO Raised – GRN Pending' },
  { label: 'No PO Yet', value: 'Indent Only – No PO' },
]

type SortKey =
  | 'indentNo' | 'indentDate' | 'ageDays' | 'block' | 'discipline'
  | 'supplier' | 'poValue' | 'status'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

function ageClass(r: IndentRecord) {
  if (r.status !== 'Indent Only – No PO' || r.ageDays == null) return 'text-stone-500'
  if (r.ageDays >= 14) return 'text-red-700 font-bold'
  if (r.ageDays >= 7) return 'text-amber-700 font-semibold'
  return 'text-stone-500'
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function IndentTable({ records, projectName }: { records: IndentRecord[]; projectName: string }) {
  const [statusFilter, setStatusFilter] = useState<IndentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('indentDate')
  const [sortDesc, setSortDesc] = useState(true)
  const PAGE_SIZE = 25

  const filtered = useMemo(() => {
    let out = records
    if (statusFilter !== 'all') out = out.filter(r => r.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      out = out.filter(r =>
        r.indentNo.toLowerCase().includes(q) ||
        r.material.toLowerCase().includes(q) ||
        r.supplier.toLowerCase().includes(q) ||
        r.discipline.toLowerCase().includes(q) ||
        r.poNos.toLowerCase().includes(q),
      )
    }
    return out
  }, [records, statusFilter, search])

  const sorted = useMemo(() => {
    const cmp = (a: IndentRecord, b: IndentRecord): number => {
      let x: string | number | null | undefined
      let y: string | number | null | undefined
      switch (sortKey) {
        case 'indentNo':   x = a.indentNo; y = b.indentNo; break
        case 'indentDate': x = a.indentDate; y = b.indentDate; break
        case 'ageDays':    x = a.ageDays ?? -1; y = b.ageDays ?? -1; break
        case 'block':      x = a.block; y = b.block; break
        case 'discipline': x = a.discipline; y = b.discipline; break
        case 'supplier':   x = a.supplier; y = b.supplier; break
        case 'poValue':    x = a.poValue; y = b.poValue; break
        case 'status':     x = a.status; y = b.status; break
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

  function exportCsv() {
    const header = [
      'Indent No', 'Date', 'Age (days)', 'Project / Block', 'Discipline', 'Material',
      'Indent Qty', 'UOM', 'Status', 'PO Count', 'PO Nos', 'Supplier',
      'GRN Count', 'GRN Qty', 'GRN Value (INR)', 'PO Value (INR)',
    ]
    const rows = sorted.map(r => [
      r.indentNo, r.indentDate, r.ageDays ?? '', r.block, r.discipline, r.material,
      r.indentQty, r.uom, r.status, r.poCount, r.poNos, r.supplier,
      r.hasGRN ? r.grnNos.split(',').length : 0, r.grnQty.toFixed(2), r.grnValue.toFixed(2), r.poValue.toFixed(2),
    ].map(csvEscape).join(','))
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/[^a-z0-9]+/gi, '-')}-procurement-${new Date().toISOString().slice(0, 10)}.csv`
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
      {/* Toolbar */}
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
                  {records.filter(r => r.status === f.value).length}
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
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
        <span className="text-xs text-stone-400 w-full sm:w-auto">{sorted.length} records</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-100">
            <tr>
              <SortableTh k="indentNo"   label="Indent no." />
              <SortableTh k="indentDate" label="Date" />
              <SortableTh k="ageDays"    label="Age" num />
              <SortableTh k="block"      label="Block" />
              <SortableTh k="discipline" label="Discipline" />
              <th className="px-4 py-2.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide text-left max-w-xs">Material · qty</th>
              <SortableTh k="status"     label="Status" />
              <th className="px-4 py-2.5 text-[11px] font-medium text-stone-500 uppercase tracking-wide text-left">Funnel</th>
              <SortableTh k="supplier"   label="Supplier" />
              <SortableTh k="poValue"    label="PO value" num />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {paged.map((r, i) => {
              const funnel = `PO ${r.hasPO ? r.poCount : 0} · GRN ${r.hasGRN ? r.grnNos.split(',').length : 0}`
              return (
                <tr
                  key={r.indentNo + i}
                  className={`hover:bg-stone-50 transition-colors ${
                    r.status === 'Indent Only – No PO' ? 'bg-red-50/30'
                    : r.status === 'PO Raised – GRN Pending' ? 'bg-amber-50/20' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-stone-700 whitespace-nowrap">
                    {r.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">{r.indentDate || '—'}</td>
                  <td className={`px-4 py-2.5 text-xs text-right tabular-nums whitespace-nowrap ${ageClass(r)}`}>
                    {r.ageDays != null ? `${r.ageDays}d` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[120px] truncate" title={r.block}>
                    {r.block || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[140px] truncate" title={r.discipline}>
                    {r.discipline}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-800 max-w-[220px]">
                    <span className="line-clamp-2" title={r.material}>{r.material}</span>
                    <span className="text-[11px] text-stone-400 block mt-0.5 tabular-nums">
                      {r.indentQty} {r.uom}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2.5 text-[11px] text-stone-500 whitespace-nowrap">{funnel}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[160px] truncate" title={r.supplier}>
                    {r.supplier
                      ? (r.vendorCount > 1 ? `${r.supplier} +${r.vendorCount - 1}` : r.supplier)
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right tabular-nums font-semibold text-stone-800 whitespace-nowrap">
                    {r.poValue > 0 ? fmtINR(r.poValue) : '—'}
                  </td>
                </tr>
              )
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-stone-400">
                  No records match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
