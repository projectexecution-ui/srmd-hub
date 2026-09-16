'use client'

import { useState } from 'react'
import { ChevronDown, PackageCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatINR, formatINRCompact, formatNumber, formatDate } from '@/lib/utils'
import type { GrnSheet } from '@/lib/bills-booking/purchase'

/** The goods received behind a supplier bill — the purchase side's abstract.
 *
 *  Aksha, 16 Sep 2026: "what about PO - i want similar format to follow as WO".
 *  So this is the work-order sheet's layout, column group for column group:
 *  what was ordered, what each earlier bill took, what this bill takes, where
 *  that leaves the order. Same colours, same fold, same reading order.
 *
 *  Two things are deliberately NOT the same, because a purchase order is not a
 *  running-account measurement:
 *
 *  · Cum is RECEIVED, not billed quantity. IN4 keeps its own received-to-date
 *    on the order line (`grn_qty`); adding up per-bill quantities would be
 *    worse, since some of them are not certain (below).
 *  · A quantity cell is blank where IN4's own two tables disagree — the pay
 *    line's money against what the receipt says those goods cost. A bill can
 *    pay for part of a receipt, and deriving the share by proportion produced
 *    95× on one live line. The money is exact on every certificate, so the
 *    amount columns are always filled; only the quantity holds back. */
export function GrnSheetPanel({ s, orderNo, vendor, billLabel }: {
  s: GrnSheet
  orderNo: string
  vendor: string
  billLabel: string
}) {
  const earlierBills = s.earlierBills
  //   auto    the last three stand alone, anything older folds  (the default)
  //   all     every bill as its own column
  //   folded  every earlier bill in one column — the narrowest read
  const [view, setView] = useState<'auto' | 'all' | 'folded'>('auto')
  const KEEP = 3
  const rolled = view === 'all' ? 0
    : view === 'folded' ? earlierBills.length
      : Math.max(0, earlierBills.length - KEEP)
  const shownBills = earlierBills.map((b, i) => ({ ...b, i })).slice(rolled)
  const prevCols = (rolled > 0 ? 1 : 0) + Math.max(shownBills.length, earlierBills.length === 0 ? 1 : 0)

  const q3 = (v: number) => Math.round(v * 1000) / 1000
  const n = (v: number) => (v === 0 ? '—' : formatNumber(v, v % 1 === 0 ? 0 : 2))
  const m = (v: number) => (v === 0 ? '—' : formatINR(v))
  const mc = (v: number) => (v === 0 ? '—' : formatINRCompact(v))
  /** A null is "IN4 does not state it", which is not the same as nothing. */
  const qn = (v: number | null) => (v == null ? <span className="text-gray-400">not stated</span> : n(v))
  /** Summing a folded range: one uncertain bill in it makes the whole unknown,
   *  the same rule a single cell follows. */
  const roll = (h: Array<number | null>, from: number, to: number) => {
    const part = h.slice(from, to)
    return part.some(v => v == null) ? null : q3(part.reduce<number>((a, b) => a + (b ?? 0), 0))
  }
  const challans = s.grns.map(g => g.challan).filter(Boolean)

  return (
    <Card className="overflow-hidden p-0">
      {/* Masthead, as on the work-order sheet */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-800 px-4 py-3 text-white">
        <PackageCheck className="h-4 w-4 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-[15px] font-bold leading-tight">
            {s.billed ? 'Goods Received Sheet — Supplier Bill' : 'Goods Received — not yet billed'}
          </h2>
          <p className="text-[11px] text-slate-300">
            {s.billed
              ? 'Received in IN4 against the purchase order — the certificate is raised on it'
              : 'Received in IN4, no supplier certificate yet — this is what the bill is being passed for'}
          </p>
        </div>
        <span className="w-full text-[11px] text-slate-300 sm:w-auto">
          {s.grns.length === 0
            ? '—'
            : s.grns.map(g => `${g.no ?? 'GRN'}${g.on ? ` · ${formatDate(g.on)}` : ''}`).join('  ·  ')}
          {challans.length > 0 && ` · challan ${challans.join(', ')}`}
        </span>
        <span className="ml-auto rounded-md bg-amber-300 px-2.5 py-0.5 text-[11px] font-extrabold text-slate-900">
          {billLabel} · {orderNo}
        </span>
      </div>

      {earlierBills.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-gray-100 bg-amber-50/40 px-4 py-1.5 text-[11px] text-gray-600">
          <b className="text-gray-800">Earlier bills on this order:</b>
          <span className="min-w-0 flex-1">
            {earlierBills.map((b, i) => (
              <span key={i} className={i < rolled ? 'text-gray-400' : undefined}>
                {i > 0 && '  ·  '}
                <b>{b.label ?? 'Bill'}</b> {b.billNo ?? '—'}{b.on ? ` (${formatDate(b.on)})` : ''}
                {!b.measured && <span className="text-gray-400"> · no lines</span>}
              </span>
            ))}
          </span>
          <button type="button"
                  onClick={() => setView(rolled > 0 ? 'all' : 'folded')}
                  className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-50">
            <ChevronDown className={`h-3 w-3 transition-transform ${rolled > 0 ? '' : 'rotate-180'}`} />
            {rolled > 0
              ? `Show all ${earlierBills.length} ${earlierBills.length === 1 ? 'bill' : 'bills'}`
              : 'Fold earlier bills'}
          </button>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-gray-200 px-4 py-3 text-[13px] sm:grid-cols-2">
        <div><dt className="inline font-semibold text-gray-500">Supplier </dt><dd className="inline">{vendor}</dd></div>
        <div><dt className="inline font-semibold text-gray-500">PO No </dt><dd className="inline font-mono text-xs">{orderNo}</dd></div>
      </dl>

      {/* Phone — the same figures, stacked. A wide sheet is unusable on a
          handset, and the Atm Head reads these on one. */}
      <div className="space-y-2 p-3 md:hidden">
        {s.rows.map((r, i) => (
          <div key={r.materialId ?? `x${i}`}
               className={`rounded-lg border p-3 ${r.overrun ? 'border-rose-200 bg-rose-50/40' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-[13px]">{r.material}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(r.thisAmt)}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              This bill{' '}
              {r.thisQty != null ? `${n(r.thisQty)} ${r.uom ?? ''}`.trim()
                : r.receiptQty != null ? `part of ${n(r.receiptQty)} ${r.uom ?? ''}`.trim()
                  : 'not stated'}
              {r.rate > 0 ? ` @ ${formatINR(r.rate)}` : ''}
              {r.offOrder && <span className="ml-1 text-amber-700">· not on the order</span>}
            </div>
            {!r.offOrder && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <Pair k="Ordered" v={`${n(r.orderedQty)} ${r.uom ?? ''}`} />
                <Pair k="Billed before" v={m(r.priorAmt)} />
                <Pair k="Received" v={`${n(r.receivedQty)} ${r.uom ?? ''}`} />
                <Pair k="Billed to date" v={m(r.cumAmt)} />
                <Pair k="Balance qty" v={r.complete ? 'complete' : `${n(r.balanceQty)} ${r.uom ?? ''}`} />
                <Pair k="Balance value" v={m(r.balAmt)} />
              </dl>
            )}
          </div>
        ))}
      </div>

      {/* Desktop */}
      <div className="hidden overflow-x-auto px-2 pt-2 md:block">
        <table style={{ minWidth: 1020 + (prevCols - 1) * 54 }} className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <Th l>#</Th><Th l>Material</Th><Th>Qty</Th><Th>Unit</Th><Th>Rate</Th>
              <Th g="po">PO Amt</Th>
              {rolled > 0 && (
                <Th g="prev">
                  <button type="button" onClick={() => setView('all')}
                          title={`Open: ${earlierBills.slice(0, rolled).map(b => `${b.label ?? 'Bill'} ${b.billNo ?? ''}`).join(' · ')}`}
                          className="inline-flex items-center gap-0.5 font-bold uppercase tracking-wide text-amber-900 hover:text-indigo-700">
                    Earlier ({rolled})
                    <ChevronDown className="h-2.5 w-2.5 -rotate-90" />
                  </button>
                </Th>
              )}
              {shownBills.map(b => (
                <Th key={b.i} g="prev">
                  <span className={b.measured ? undefined : 'font-normal text-amber-700/60'}
                        title={`${b.billNo ?? 'earlier bill'}${b.on ? ` · ${formatDate(b.on)}` : ''}${b.measured ? '' : ' — no lines in IN4'}`}>
                    {b.label ?? 'Bill'}
                  </span>
                </Th>
              ))}
              {earlierBills.length === 0 && <Th g="prev">Prev Qty</Th>}
              <Th g="prev">Prev Amt</Th>
              <Th g="this">This Qty</Th><Th g="this">This Amt</Th>
              <Th g="cum">Received</Th><Th g="cum">Cum Amt</Th>
              <Th g="bal">Bal Qty</Th><Th g="bal">Bal Amt</Th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={r.materialId ?? `x${i}`} className={r.overrun ? 'bg-rose-50' : 'hover:bg-gray-50/60'}>
                <Td l>{i + 1}</Td>
                <Td l className="max-w-[220px] whitespace-normal align-top">
                  {r.material}
                  {r.offOrder && <span className="block text-[10px] text-amber-700">not on the purchase order</span>}
                </Td>
                <Td>{r.offOrder ? '—' : n(r.orderedQty)}</Td>
                <Td>{r.uom ?? '—'}</Td>
                <Td>{r.rate > 0 ? m(r.rate) : '—'}</Td>
                <Td g="po">{r.offOrder ? '—' : mc(r.orderedAmt)}</Td>
                {rolled > 0 && (
                  <Td g="prev" className="text-gray-500">{qn(roll(r.history, 0, rolled))}</Td>
                )}
                {shownBills.map(b => (
                  <Td key={b.i} g="prev" className="text-gray-600">{qn(r.history[b.i] ?? 0)}</Td>
                ))}
                {earlierBills.length === 0 && <Td g="prev">—</Td>}
                <Td g="prev">{mc(r.priorAmt)}</Td>
                <Td g="this">
                  {r.thisQty != null ? n(r.thisQty)
                    : <span className="text-gray-400">{r.receiptQty != null ? `part of ${n(r.receiptQty)}` : 'not stated'}</span>}
                </Td>
                <Td g="this" className="font-semibold">{mc(r.thisAmt)}</Td>
                <Td g="cum">{r.offOrder ? '—' : n(r.receivedQty)}</Td>
                <Td g="cum">{mc(r.cumAmt)}</Td>
                <Td g="bal" className={r.overrun ? 'font-semibold text-rose-700' : r.complete ? 'text-emerald-700' : ''}>
                  {r.offOrder ? '—'
                    : r.overrun ? `over ${n(Math.abs(r.balanceQty))}`
                      : r.complete ? 'done' : n(r.balanceQty)}
                </Td>
                <Td g="bal">{r.offOrder ? '—' : mc(r.balAmt)}</Td>
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr className="bg-slate-50 font-bold">
              <td className="border border-gray-100 px-2 py-1.5 text-left" colSpan={6}>
                {s.rows.length} {s.rows.length === 1 ? 'material' : 'materials'} on this bill
              </td>
              <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums text-gray-500"
                  colSpan={Math.max(prevCols, 1) + 1}>{m(s.prevBill)}</td>
              <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>{m(s.thisBill)}</td>
              <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>{m(s.cumulative)}</td>
              <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>{m(s.balance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-4 py-3">
        <Chip k="This bill — gross" v={formatINR(s.thisBill)} tone="green" />
        <Chip k="Billed before on these materials" v={formatINR(s.prevBill)} />
        <Chip k="Ordered on these materials" v={formatINR(s.ordered)} />
      </div>

      {!s.reconciles && (
        <p className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The lines add up to {formatINR(s.thisBill)} against {formatINR(s.landed)} on IN4&apos;s certificate —
          out by {formatINR(Math.abs(s.outBy))}. Worth checking before it is passed.
        </p>
      )}
      {s.anyOverrun && (
        <p className="mx-4 mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          More has been received than was ordered on some lines. That needs an amendment in IN4 before payment — it
          does not stop the bill being checked.
        </p>
      )}
    </Card>
  )
}

function Th({ children, l, g }: { children: React.ReactNode; l?: boolean; g?: 'po' | 'prev' | 'this' | 'cum' | 'bal' }) {
  const bg = g === 'this' ? 'bg-blue-100' : g === 'prev' ? 'bg-amber-50' : g === 'cum' ? 'bg-emerald-50' : g === 'po' ? 'bg-slate-100' : g === 'bal' ? 'bg-gray-50' : 'bg-slate-100'
  return (
    <th className={`border border-gray-200 px-1.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-700 ${bg} ${l ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  )
}
function Td({ children, l, g, className = '' }: { children: React.ReactNode; l?: boolean; g?: 'po' | 'prev' | 'this' | 'cum' | 'bal'; className?: string }) {
  const bg = g === 'this' ? 'bg-blue-50/70' : g === 'prev' ? 'bg-amber-50/50' : g === 'cum' ? 'bg-emerald-50/40' : g === 'po' ? 'bg-slate-50/60' : ''
  return (
    <td className={`border border-gray-100 px-1.5 py-1 tabular-nums ${bg} ${l ? 'text-left' : 'text-right'} ${className}`}>
      {children}
    </td>
  )
}
function Pair({ k, v }: { k: string; v: string }) {
  return <div><dt className="inline text-gray-500">{k} </dt><dd className="inline font-medium tabular-nums">{v}</dd></div>
}
function Chip({ k, v, tone }: { k: string; v: string; tone?: 'green' }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
      <div className={`text-base font-extrabold tabular-nums ${tone === 'green' ? 'text-emerald-700' : 'text-gray-900'}`}>{v}</div>
    </div>
  )
}
