'use client'

import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { orderKey, type PickableOrder } from '@/lib/bills-booking/orders'

export type OrderKind = 'WO' | 'PO'

/** Find the order by typing, not by drilling.
 *
 *  There are 2,181 work orders and 1,451 purchase orders. A project dropdown
 *  feeding an order dropdown means two choices and a scroll, and it needs the
 *  project answered before you can even look — when the thing in the person's
 *  hand is a bill with the number printed on it. So: say which kind, then one
 *  box, type any part of the number or the party, pick from what matches.
 *
 *  Aksha, 15 Sep 2026: "a option should come for WO or PO then we search as per
 *  that selection". The two lists are kept apart rather than merged because the
 *  person always knows which one they are holding, and searching both at once
 *  would put "…/2026-27/9" from a WO next to "…/2026-27/9" from a PO.
 *
 *  The project is then a fact IN4 tells us, not a question we ask twice. */
export function OrderPicker({
  kind, onKind, wos, pos, picked, onPick, projectNames,
  subprojectNames, booksTo, onSubproject,
}: {
  kind: OrderKind
  onKind: (k: OrderKind) => void
  wos: PickableOrder[]
  pos: PickableOrder[]
  picked: PickableOrder | null
  onPick: (o: PickableOrder | null) => void
  /** IN4 project names, used only to say which building a match belongs to
   *  while somebody is still choosing between several. */
  projectNames: Map<number, string>
  /** IN4 sub-project names, for the orders that span more than one. */
  subprojectNames: Map<number, string>
  /** The sub-project this bill will book to — the order's own, unless somebody
   *  has picked a different one of its lines' sub-projects. */
  booksTo: number | null
  onSubproject?: (id: number) => void
}) {
  const [q, setQ] = useState('')
  const list = kind === 'WO' ? wos : pos
  const words = kind === 'WO' ? WO : PO

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    return list
      .filter(o => o.orderNo.toLowerCase().includes(needle) || o.party.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [list, q])

  if (picked) {
    const p = picked
    const w = p.kind === 'WO' ? WO : PO
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold">{p.orderNo}</div>
            {/* Where it books is NOT repeated here — the panel below it carries
                the sub-project, the CT Hub project and the Atm Head, all read
                off this order. */}
            <div className="text-xs text-gray-600">{p.party || `${w.party} not named in IN4`}</div>
          </div>
          <button type="button" onClick={() => { onPick(null); setQ('') }}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 min-h-[32px]">
            <X className="h-3.5 w-3.5" /> Change
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Fact k="Ordered incl. GST" v={formatINR(p.orderedGross)} />
          <Fact k="Billed so far" v={formatINR(p.billedGross)} />
          <Fact k="Balance to bill" v={formatINR(p.balance)} strong />
          <Fact k="Retention" v={p.retentionPct == null ? 'no bills yet' : `${p.retentionPct}%`} />
          <Fact k="Trust" v={p.trust ?? '—'} />
          <Fact k="Bills so far" v={String(p.bills)} />
          <Fact k="Last bill no." v={p.lastBillNo ?? '—'} />
          <Fact k={`${p.kind} status`} v={p.status ?? '—'} />
        </dl>

        {/* 49 of the 1,451 purchase orders buy for two to four sub-projects at
            once. IN4 names the sub-project on each LINE, so the order genuinely
            has several — it opens on the one carrying the most value and the
            rest are offered, because the person holding the bill knows which
            building it is for and a wrong desk costs a morning. */}
        {p.subprojectIds.length > 1 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <p className="text-[11px] text-amber-900">
              This {p.kind} buys for <b>{p.subprojectIds.length} sub-projects</b>. It is booked to the one carrying
              the most value — pick another if this bill is for that one.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.subprojectIds.map(sid => (
                <button key={sid} type="button" onClick={() => onSubproject?.(sid)}
                        aria-pressed={booksTo === sid}
                        className={`min-h-[32px] rounded-full border px-2.5 text-[11px] font-semibold ${
                          booksTo === sid
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-amber-300 bg-white text-amber-900 hover:border-indigo-400'}`}>
                  {subprojectNames.get(sid) ?? `Sub-project ${sid}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {p.balance === 0 && (
          <p className="mt-2.5 text-[11px] font-semibold text-red-700">
            Fully billed. Anything further needs an amendment in IN4 first — it will be flagged either way.
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Which kind first. The list, the labels and what IN4 can fill in all
          follow from it, so it cannot be a guess made from the number typed. */}
      {/* Full width and two-up on a phone, where it is also the tap target;
          a compact segmented control from sm up. */}
      <div className="mb-3 flex w-full rounded-lg border border-gray-300 bg-gray-50 p-0.5 sm:inline-flex sm:w-auto">
        {(['WO', 'PO'] as const).map(k => (
          <button key={k} type="button" onClick={() => { onKind(k); setQ('') }}
                  aria-pressed={kind === k}
                  className={`min-h-[40px] flex-1 rounded-[6px] px-3 text-sm font-semibold transition sm:min-h-[36px] sm:flex-none ${
                    kind === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            {k === 'WO' ? 'Work order' : 'Purchase order'}
            <span className="ml-1.5 text-[11px] font-normal text-gray-400">
              {(k === 'WO' ? wos : pos).length}
            </span>
          </button>
        ))}
      </div>

      <Label htmlFor="ordersearch">{words.label}</Label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input id="ordersearch" value={q} onChange={e => setQ(e.target.value)} className="pl-9"
               placeholder={words.placeholder} autoComplete="off" />
      </div>

      {q.trim().length >= 2 && (
        matches.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            No {words.label.toLowerCase()} in IN4 matches that.
            {' '}{otherHit(q, kind === 'WO' ? pos : wos)
              ? <>It matches a <b>{kind === 'WO' ? 'purchase' : 'work'} order</b> though — switch above.</>
              : <>Check the number, or tick <b>{words.none}</b> below if it has not been raised.</>}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {matches.map(o => (
              <li key={orderKey(o)}>
                <button type="button" onClick={() => { onPick(o); setQ('') }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-indigo-50 min-h-[44px]">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{o.orderNo}</span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {o.party || '—'}
                      {o.projectId != null && projectNames.get(o.projectId) ? ` · ${projectNames.get(o.projectId)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs tabular-nums font-medium">{formatINR(o.balance)}</span>
                    <span className="block text-[10.5px] text-gray-400">left to bill</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

/** The words that change between the two. Everything else is identical, which
 *  is the point — a vendor bill is not a second-class bill. */
const WO = {
  label: 'Work order',
  party: 'contractor',
  none: 'no work order yet',
  placeholder: 'Type the WO number or the contractor — e.g. SQ/2026 or Amin',
}
const PO = {
  label: 'Purchase order',
  party: 'supplier',
  none: 'no purchase order yet',
  placeholder: 'Type the PO number or the supplier — e.g. NGH/2026 or Pankaj',
}

/** Somebody searching the wrong list gets told, instead of being told nothing
 *  matches when it plainly does. */
function otherHit(q: string, other: PickableOrder[]): boolean {
  const needle = q.trim().toLowerCase()
  return other.some(o => o.orderNo.toLowerCase().includes(needle) || o.party.toLowerCase().includes(needle))
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{v}</dd>
    </div>
  )
}
