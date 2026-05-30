'use client'
import { useState, useMemo } from 'react'
import type { IndentRecord, IndentStatus } from '@/lib/procurement-tracker'
import { StatusBadge } from './StatusBadge'

const STATUS_FILTERS: { label: string; value: IndentStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'GRN Received', value: 'PO Done & GRN Received' },
  { label: 'GRN Pending', value: 'PO Raised – GRN Pending' },
  { label: 'No PO Yet', value: 'Indent Only – No PO' },
]

export function IndentTable({ records }: { records: IndentRecord[] }) {
  const [statusFilter, setStatusFilter] = useState<IndentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          r.indentNo.toLowerCase().includes(q) ||
          r.material.toLowerCase().includes(q) ||
          r.supplier.toLowerCase().includes(q) ||
          r.discipline.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [records, statusFilter, search])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleFilterChange = (v: IndentStatus | 'all') => {
    setStatusFilter(v)
    setPage(1)
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-stone-100">
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => handleFilterChange(f.value)}
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
          placeholder="Search indent, material, supplier…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="ml-auto text-sm border border-stone-200 rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
        <span className="text-xs text-stone-400">{filtered.length} records</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Indent no.</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Date</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Discipline</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500 max-w-xs">Material</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Qty</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Supplier</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">PO no.</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-stone-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {paged.map((r, i) => (
              <tr
                key={r.indentNo + i}
                className={`hover:bg-stone-50 transition-colors ${
                  r.status === 'Indent Only – No PO'
                    ? 'bg-red-50/30'
                    : r.status === 'PO Raised – GRN Pending'
                    ? 'bg-amber-50/30'
                    : ''
                }`}
              >
                <td className="px-4 py-2.5 font-mono text-xs text-stone-500 whitespace-nowrap">
                  {r.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
                </td>
                <td className="px-4 py-2.5 text-xs text-stone-500 whitespace-nowrap">
                  {r.indentDate}
                </td>
                <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[140px] truncate" title={r.discipline}>
                  {r.discipline}
                </td>
                <td className="px-4 py-2.5 text-xs text-stone-800 max-w-[200px]">
                  <span className="line-clamp-2" title={r.material}>{r.material}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-stone-600 whitespace-nowrap">
                  {r.indentQty} {r.uom}
                </td>
                <td className="px-4 py-2.5 text-xs text-stone-600 max-w-[140px] truncate" title={r.supplier}>
                  {r.supplier || '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-stone-400 whitespace-nowrap">
                  {r.poNos
                    ? r.poNos.replace(/PO\/SRASSK\//g, '').replace(/PO\/SRET\//g, '').slice(0, 30)
                    : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-stone-400">
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
            Page {page} of {totalPages}
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
