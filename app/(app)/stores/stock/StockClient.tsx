'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronRight, Download, Printer, Package, Warehouse, Search } from 'lucide-react'
import { fmtQty } from '@/lib/stores/core'
import {
  searchStock, groupStockByDiscipline, groupStockByStore, stockWorth,
  type StockLine,
} from '@/lib/stores/desk'
import { formatDate, formatINR, formatNumber } from '@/lib/utils'
import { Empty, th, thNum, td, tdNum } from '../ui'

/**
 * What we hold, and where — readable.
 *
 * Aksha, 16 Sep 2026: "A stock page you can read". It was 670 rows in one
 * table with no search, no grouping and no way to tell a shelf that moved this
 * morning from one untouched since the Odoo count. Four things fix that:
 *
 *   · grouped by discipline and COLLAPSED — Electrical alone is 425 items,
 *     which is a wall of rows and one line respectively
 *   · a search box, because the way to find an item is to type its name
 *   · a store filter and a By-store view, for somebody standing in one
 *   · when each shelf last moved, so dead stock is visible as dead
 *
 * Both views are built from ONE filtered list (lib/stores/desk.ts), so a
 * search narrows them identically and they can never disagree about a figure.
 *
 * Desktop gets the table; a phone gets cards. Same data, same order — see
 * AGENTS.md: a change to one that misses the other is an incomplete change.
 */
export function StockClient({
  lines, places, period, scopeNote,
}: {
  lines: StockLine[]
  places: Array<{ id: string; label: string }>
  /** "Right now" or "As on 31 Aug 2026" — printed on the export. */
  period: string
  /** Why a scoped reader may be seeing less than everything. */
  scopeNote?: string | null
}) {
  const [q, setQ] = useState('')
  const [placeId, setPlaceId] = useState('')
  const [view, setView] = useState<'item' | 'store'>('item')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => {
    const byPlace = placeId ? lines.filter(l => l.locationId === placeId) : lines
    return searchStock(byPlace, q)
  }, [lines, placeId, q])

  const itemGroups = useMemo(() => groupStockByDiscipline(shown), [shown])
  const storeGroups = useMemo(() => groupStockByStore(shown), [shown])
  const worth = useMemo(() => stockWorth(shown), [shown])

  // A search is a question, and the answer should be on screen — so searching
  // opens every group that matched rather than leaving them all shut.
  const searching = q.trim().length > 0 || !!placeId
  const isOpen = (label: string) => searching || open.has(label)
  const toggle = (label: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label); else next.add(label)
    return next
  })

  const groups = view === 'item' ? itemGroups : storeGroups
  const notes = [
    q.trim() ? `Search: ${q.trim()}` : null,
    placeId ? `Store: ${places.find(p => p.id === placeId)?.label ?? ''}` : null,
  ].filter(Boolean) as string[]

  const download = async (as: 'xlsx' | 'pdf') => {
    setBusy(true)
    try {
      const { exportStock } = await import('@/lib/stores/export')
      await exportStock(as, {
        title: view === 'item' ? 'Stock by item' : 'Stock by store',
        period,
        notes,
        groups: groups.map(g => ({
          label: g.label, rows: g.rows, items: g.items, value: g.value, unpriced: g.unpriced,
        })),
        grand: {
          lines: shown.length,
          items: new Set(shown.map(l => l.itemId)).size,
          value: worth.value,
          unpriced: worth.unpriced > 0,
        },
      })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {/* ── the toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[190px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder={`Find one of ${formatNumber(new Set(lines.map(l => l.itemId)).size, 0)} items`}
            aria-label="Find an item"
            className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-[13px] min-h-[44px]
              focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
        </label>

        {places.length > 1 && (
          <select
            value={placeId} onChange={e => setPlaceId(e.target.value)}
            aria-label="Which store"
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[13px] min-h-[44px] max-w-[220px]"
          >
            <option value="">Every store</option>
            {places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}

        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          {(['item', 'store'] as const).map(v => (
            <button
              key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-3 min-h-[44px] text-[12.5px] font-semibold inline-flex items-center gap-1.5 ${
                view === v ? 'bg-indigo-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {v === 'item' ? <Package className="h-3.5 w-3.5" /> : <Warehouse className="h-3.5 w-3.5" />}
              By {v}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <button
            type="button" onClick={() => download('xlsx')} disabled={busy || shown.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px] disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
          <button
            type="button" onClick={() => download('pdf')} disabled={busy || shown.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-800 min-h-[44px] disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {/* ── what it is worth, and why that figure is low ──────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-50/70 px-3.5 py-2.5">
        <p className="text-[13px] font-bold text-gray-900 tabular-nums">{formatINR(worth.value)}</p>
        <p className="text-[12px] text-gray-500 tabular-nums">
          {formatNumber(new Set(shown.map(l => l.itemId)).size, 0)} items · {formatNumber(shown.length, 0)} lines
        </p>
        {worth.unpriced > 0 && (
          <p className="text-[12px] text-amber-800">
            Understated — {formatNumber(worth.unpriced, 0)} line{worth.unpriced === 1 ? '' : 's'} with no rate
          </p>
        )}
        {scopeNote && <p className="text-[12px] text-gray-500">{scopeNote}</p>}
      </div>

      {shown.length === 0 ? (
        <Empty
          title={searching ? 'Nothing matches that' : 'Nothing in stock yet'}
          hint={searching
            ? 'Try fewer letters, or clear the store filter. An item with none left still shows — it just has a zero against it.'
            : 'Stock arrives two ways: through the gate, or as an opening balance below.'}
        />
      ) : (
        <div className="space-y-2">
          {groups.map(g => {
            const shownGroup = isOpen(g.label)
            return (
              <section key={g.label} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(g.label)}
                  aria-expanded={shownGroup}
                  className="flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-left min-h-[44px] hover:bg-gray-50"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none ${shownGroup ? 'rotate-90' : ''}`}
                  />
                  <span className="text-[13.5px] font-bold text-gray-900">{g.label}</span>
                  <span className="text-[12px] text-gray-500 tabular-nums">
                    {formatNumber(g.items, 0)} item{g.items === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto flex items-baseline gap-2 text-[12px] tabular-nums">
                    {g.value > 0 && <span className="font-semibold text-gray-900">{formatINR(g.value)}</span>}
                    {g.unpriced && <span className="text-amber-700">understated</span>}
                  </span>
                </button>

                {shownGroup && (
                  <>
                    {/* Desktop: the table. */}
                    <div className="hidden md:block overflow-x-auto border-t border-gray-100">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className={th}>Item</th>
                            <th className={th}>Where</th>
                            <th className={thNum}>In hand</th>
                            <th className={th}>Unit</th>
                            <th className={th}>Last moved</th>
                            <th className={thNum}>Last rate</th>
                            <th className={thNum}>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map(r => (
                            <tr key={`${r.itemId}-${r.locationId}`} className={r.qty <= 0 ? 'opacity-55' : ''}>
                              <td className={td}>
                                <Link href={`/stores/stock/${r.itemId}`} className="font-medium text-indigo-700 hover:underline">
                                  {r.name}
                                </Link>
                              </td>
                              <td className={td}>{r.where}</td>
                              <td className={`${tdNum} font-semibold ${r.qty < 0 ? 'text-rose-700' : ''}`}>{fmtQty(r.qty)}</td>
                              <td className={td}>{r.unit}</td>
                              <td className={`${td} whitespace-nowrap text-gray-500`}>
                                {r.lastMovedAt ? formatDate(r.lastMovedAt) : '—'}
                              </td>
                              <td className={tdNum}>{r.lastRate == null ? '—' : formatINR(r.lastRate)}</td>
                              <td className={tdNum}>{r.value == null ? '—' : formatINR(r.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Phone: one card per line. The table would scroll
                        sideways, which is how the storekeeper stops using it. */}
                    <ul className="md:hidden divide-y divide-gray-100 border-t border-gray-100">
                      {g.rows.map(r => (
                        <li key={`${r.itemId}-${r.locationId}`} className={r.qty <= 0 ? 'opacity-55' : ''}>
                          <Link href={`/stores/stock/${r.itemId}`} className="block px-4 py-2.5 min-h-[44px] hover:bg-gray-50">
                            <div className="flex items-baseline gap-2">
                              <span className="flex-1 text-[13px] font-medium text-gray-900">{r.name}</span>
                              <span className={`shrink-0 text-[13px] font-bold tabular-nums ${r.qty < 0 ? 'text-rose-700' : 'text-gray-900'}`}>
                                {fmtQty(r.qty)} <span className="font-normal text-gray-400">{r.unit}</span>
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-gray-500">
                              <span>{r.where}</span>
                              {r.lastMovedAt && <span>· moved {formatDate(r.lastMovedAt)}</span>}
                              <span className="ml-auto tabular-nums">
                                {r.value == null ? <span className="text-gray-300">no rate</span> : formatINR(r.value)}
                              </span>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )
          })}
        </div>
      )}

      {shown.some(r => r.qty < 0) && (
        <p className="text-[12px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          A negative balance means more went out than ever came in — usually an opening quantity that was
          never set. It is shown rather than hidden, because hiding it is how a store stops being believed.
        </p>
      )}
    </div>
  )
}
