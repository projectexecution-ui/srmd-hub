'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Search, X, FileText, ChevronRight } from 'lucide-react'
import { searchOrdersForEntry } from './po-action'
import type { OrderOption } from '@/lib/stores/queries'
import { T } from '@/lib/stores/lang'
import { formatDate, formatINR } from '@/lib/utils'
import { Label } from '../../field'

/**
 * Finding the order a delivery is against.
 *
 * This replaced a plain text box that wanted an exact match. Real IN4 numbers
 * read PO/SRASSK/AB/2026-27/94 — nobody types that at a gate, and typing "123"
 * got you "IN4 has no order numbered 123", which is true and useless. The
 * number a person says out loud is the tail, so typing 94 finds it.
 *
 * Opened cold it shows the OPEN purchase orders — 89 of the 1,451, the only
 * ones a lorry could be delivering against today — so the common case needs no
 * typing at all. SEARCHING looks at every purchase order whatever its status:
 * 180 are draft, cancelled or terminated, and hiding those is why an order
 * somebody was holding in their hand could not be found. They come back under
 * their own heading with the status on the row.
 *
 * Purchase orders only. Work orders were offered here briefly and Aksha took
 * them out on 15 Sep 2026 — they are contracts for labour, and a material
 * register has no use for one. Searching runs on the server; 1,451 orders is
 * not a list to ship to a phone.
 *
 * FIELD register: 56px control, 44px rows, one thing on screen at a time.
 */
export function OrderPicker({
  value, onPick, onClear, gateParty = null, gatePartyId = null,
}: {
  /** The chosen order's number, or null. */
  value: string | null
  onPick: (key: string) => void
  onClear: () => void
  /** Who Security wrote down — their open orders lead the list. */
  gateParty?: string | null
  /** IN4's id for them, when the gate picked rather than typed. Exact match. */
  gatePartyId?: number | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<OrderOption[] | null>(null)
  const [busy, startSearch] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced so a five-letter search is one round trip, not five.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      startSearch(async () => setRows(await searchOrdersForEntry(query, { name: gateParty, id: gatePartyId })))
    }, query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, open, gateParty, gatePartyId])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30) }, [open])

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label t={T.poNumber} />
        <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-3.5 py-3 min-h-[56px]">
          <FileText className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
          <span className="flex-1 min-w-0 font-mono text-[14px] font-semibold text-gray-900 break-all">{value}</span>
          <button
            type="button" onClick={onClear} aria-label="Choose a different order"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-emerald-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label t={T.poNumber} />
      {!open ? (
        <button
          type="button" onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-gray-300 bg-white px-3.5 py-3 min-h-[56px] text-left active:bg-gray-50"
        >
          <Search className="h-5 w-5 shrink-0 text-gray-400" />
          <span className="flex-1 text-[16px] text-gray-400">{T.findOrder}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" />
        </button>
      ) : (
        <div className="rounded-xl border-2 border-indigo-400 bg-white overflow-hidden">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3">
            <Search className="h-5 w-5 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              inputMode="search"
              placeholder={T.orderSearch}
              className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-gray-400"
            />
            <button
              type="button" onClick={() => { setOpen(false); setQuery('') }} aria-label={T.cancel}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="max-h-[22rem] overflow-auto">
            {rows === null || busy ? (
              <p className="px-4 py-5 text-[14px] text-gray-400">Looking…</p>
            ) : rows.length === 0 ? (
              <div className="px-4 py-5">
                <p className="text-[15px] font-semibold text-gray-900">{T.orderNone}</p>
                <p className="mt-1 text-[13px] text-gray-500">
                  Search the shop&rsquo;s name, or the order number — those read like{' '}
                  <span className="font-mono">PO/SRASSK/AB/2026-27/94</span>, and the last number is
                  usually enough. Only approved orders are listed. If the material came without an
                  order, leave this out.
                </p>
              </div>
            ) : (
              <ul>
                {rows.map((r, i) => {
                  const band = bandOf(r, gateParty)
                  const newBand = i === 0 || band !== bandOf(rows[i - 1], gateParty)
                  return (
                    <li key={r.key}>
                      {newBand && (
                        <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-gray-500">
                          {band}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => { onPick(r.key); setOpen(false); setQuery('') }}
                        className="flex w-full items-start gap-2.5 border-b border-gray-100 px-3 py-3 min-h-[44px] text-left active:bg-indigo-50"
                      >
                        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[13.5px] font-semibold text-gray-900 break-all">{r.no}</span>
                          <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[12px] text-gray-500">
                            {r.party && <span className="font-medium text-gray-700">{r.party}</span>}
                            {r.projectName && <span>{r.projectName}</span>}
                            {r.date && <span>{formatDate(r.date)}</span>}
                            {r.value != null && r.value > 0 && <span>{formatINR(r.value)}</span>}
                            {r.linesDue != null && r.linesDue > 0 && (
                              <span className="font-semibold text-amber-800">
                                {r.linesDue} {r.linesDue === 1 ? 'line' : 'lines'} still due
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {rows !== null && rows.length > 0 && (
            <p className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
              {query
                ? `${rows.length} ${rows.length === 1 ? 'order' : 'orders'} match "${query}"`
                : 'Every open purchase order. Type a number or a shop name to search them all.'}
            </p>
          )}

          <button
            type="button" onClick={() => { setOpen(false); setQuery('') }}
            className="w-full border-t border-gray-200 bg-gray-50 px-3 py-3 min-h-[44px] text-[13.5px] font-semibold text-gray-600 active:bg-gray-100"
          >
            {T.noOrder}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Which heading an order sits under.
 *
 * The first band exists because Security already wrote down who turned up, so
 * that supplier's open orders are almost certainly the ones being looked for.
 * It only appears when one of them matches — no empty headings.
 */
function bandOf(r: OrderOption, party: string | null): string {
  if (r.fromGateParty && r.open) return party ? `Brought by ${party}` : T.openOrders
  return r.open ? T.openOrders : T.otherOrders
}

