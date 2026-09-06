'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ArrowUpDown, X } from 'lucide-react'

/**
 * One table for every Masters screen: search, sort, sticky header inside its
 * own scroll box (page-level sticky does not work in this app — see AGENTS.md),
 * and the same rows as cards on a phone.
 *
 * Data in, plain: the server pages stay server components and hand this plain
 * strings, so nothing about the queries moves to the client.
 */

export type CellTone = 'default' | 'muted' | 'missing' | 'strong' | 'good' | 'warn'

export interface Cell {
  text: string
  tone?: CellTone
  mono?: boolean
  /** Small second line under the value — a code, a date, a reason. */
  sub?: string
}

export interface MasterColumn {
  key: string
  label: string
  align?: 'left' | 'right'
  width?: string
  /** Hidden on mobile cards — for columns that only make sense in a table. */
  desktopOnly?: boolean
}

export interface MasterRow {
  id: string
  cells: Record<string, Cell>
  tone?: 'warn' | 'info'
  href?: string
  /** Rendered at the end of the row (desktop) / card (mobile). */
  action?: React.ReactNode
}

const TONE: Record<CellTone, string> = {
  default: 'text-gray-800',
  muted: 'text-gray-500',
  missing: 'text-rose-300 italic',
  strong: 'font-semibold text-gray-900',
  good: 'font-semibold text-emerald-700',
  warn: 'font-semibold text-amber-700',
}

export type Filter = { key: string; label: string; test: (r: MasterRow) => boolean }

export function MasterTable({
  columns, rows, searchPlaceholder = 'Search…', emptyMessage = 'Nothing here.',
  sortableKeys = [], filters = [], defaultFilter,
}: {
  columns: MasterColumn[]
  rows: MasterRow[]
  searchPlaceholder?: string
  emptyMessage?: string
  sortableKeys?: string[]
  /** Quick chips above the table, e.g. "Only unmatched". */
  filters?: Filter[]
  defaultFilter?: string
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [filter, setFilter] = useState<string | null>(defaultFilter ?? null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = rows
    const f = filters.find(x => x.key === filter)
    if (f) out = out.filter(f.test)
    if (needle) {
      out = out.filter(r => Object.values(r.cells).some(c => (c.text + ' ' + (c.sub ?? '')).toLowerCase().includes(needle)))
    }
    if (sort) {
      const val = (r: MasterRow) => r.cells[sort.key]?.text ?? ''
      const asNum = (s: string) => Number(s.replace(/[^0-9.-]/g, ''))
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b)
        const nx = asNum(x), ny = asNum(y)
        const bothNum = x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)
        return (bothNum ? nx - ny : x.localeCompare(y)) * sort.dir
      })
    }
    return out
  }, [rows, q, sort, filter, filters])

  function toggleSort(key: string) {
    setSort(s => s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 })
  }

  const hasAction = rows.some(r => r.action)

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
            className="w-full min-h-[44px] rounded-lg border border-gray-300 bg-white pl-9 pr-9 text-sm"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {filters.length > 0 && (
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
            <Chip active={filter === null} onClick={() => setFilter(null)}>All</Chip>
            {filters.map(f => <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(filter === f.key ? null : f.key)}>{f.label} <span className="tabular-nums opacity-70">{rows.filter(f.test).length}</span></Chip>)}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-500 tabular-nums">
        {filtered.length === rows.length ? `${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'}` : `${filtered.length.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')}`}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
          {q || filter ? 'Nothing matches.' : emptyMessage}
        </p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {columns.map(c => {
                      const canSort = sortableKeys.includes(c.key)
                      return (
                        <th key={c.key} className={['sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600', c.align === 'right' ? 'text-right' : '', c.width ?? ''].join(' ')}>
                          {canSort ? (
                            <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-900">
                              {c.label}
                              <ArrowUpDown className={`h-3 w-3 ${sort?.key === c.key ? 'text-indigo-600' : 'text-gray-300'}`} />
                            </button>
                          ) : c.label}
                        </th>
                      )
                    })}
                    {hasAction && <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className={`border-t border-gray-100 hover:bg-gray-50/60 ${r.tone === 'warn' ? 'bg-amber-50/40' : r.tone === 'info' ? 'bg-blue-50/30' : ''}`}>
                      {columns.map((c, i) => {
                        const cell = r.cells[c.key] ?? { text: '' }
                        const body = (
                          <>
                            <span className={[TONE[cell.tone ?? 'default'], cell.mono ? 'font-mono text-[11px]' : ''].join(' ')}>{cell.text || '—'}</span>
                            {cell.sub && <span className="block text-[11px] text-gray-400">{cell.sub}</span>}
                          </>
                        )
                        return (
                          <td key={c.key} className={`px-3 py-2 align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                            {i === 0 && r.href ? <Link href={r.href} className="hover:underline">{body}</Link> : body}
                          </td>
                        )
                      })}
                      {hasAction && <td className="px-3 py-1.5 align-top text-right">{r.action}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile — the same rows as cards. */}
          <div className="md:hidden rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-auto max-h-[65vh]">
            {filtered.map(r => {
              const [first, ...rest] = columns
              const head = r.cells[first.key] ?? { text: '' }
              const inner = (
                <>
                  <p className={`text-sm ${TONE[head.tone ?? 'strong']}`}>{head.text || '—'}</p>
                  {head.sub && <p className="text-[11px] text-gray-400">{head.sub}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {rest.filter(c => !c.desktopOnly).map(c => {
                      const cell = r.cells[c.key]
                      if (!cell?.text) return null
                      return <span key={c.key} className="text-[11px] text-gray-500">{c.label} <span className={TONE[cell.tone ?? 'default']}>{cell.text}</span></span>
                    })}
                  </div>
                </>
              )
              return (
                <div key={r.id} className={`px-4 py-3 ${r.tone === 'warn' ? 'bg-amber-50/40' : r.tone === 'info' ? 'bg-blue-50/30' : ''}`}>
                  {r.href ? <Link href={r.href} className="block">{inner}</Link> : inner}
                  {r.action && <div className="mt-2">{r.action}</div>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`whitespace-nowrap rounded-full border px-3 min-h-[44px] sm:min-h-[36px] text-xs font-medium ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'}`}>
      {children}
    </button>
  )
}
