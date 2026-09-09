import { Fragment } from 'react'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { SLA_DAYS } from '@/lib/revamp/indents-tree'
import { shortRef, meaningfulRemark } from '@/lib/revamp/indents-board'
import { referenceRate, priceDelta } from '@/lib/revamp/approver'
import { TURN_LABEL, type PendingOrder, type OrderLinePending } from '@/lib/revamp/order-approvals'
import { daysSince, History } from './IndentRows'

/**
 * The pieces the orders tree (OrdersView.tsx) uses to show a WO or PO that is
 * still waiting in IN4 — as a yellow row inside its own category and
 * sub-category, the Internal Estimate's shape kept — and, under the chevron,
 * its lines with every rate against the last one paid, then the history.
 *
 * Aksha, 10 Sep 2026: "only WO and PO verified in IN4 to be reflected, and in
 * Tree view as IE … the pending yellow colour should come." Approval itself
 * happens in IN4.
 */

const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const Dash = () => <span className="text-gray-300">—</span>

/** One line above the tree: how many are waiting, and that they are the yellow rows. */
export function PendingStrip({ orders, in4 }: { orders: PendingOrder[]; in4: 'live' | 'not-configured' | 'unavailable' }) {
  if (in4 !== 'live') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] text-amber-900 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>{in4 === 'not-configured' ? 'No IN4 login on this deployment — what is waiting for approval in IN4 cannot be shown.' : 'IN4 did not answer for the approvals — the tree shows approved orders only.'}</span>
      </p>
    )
  }
  if (orders.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-[13px] text-emerald-900 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" /> No work order or purchase order is waiting for approval in IN4.
      </p>
    )
  }
  const wos = orders.filter(o => o.kind === 'wo').length, pos = orders.length - wos
  const mine = orders.filter(o => o.turn === 'approver').length
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-[13px] text-amber-900 flex items-center gap-2 flex-wrap">
      <span className="inline-block h-3 w-3 rounded-sm bg-amber-300 border border-amber-400" aria-hidden />
      <span className="font-semibold">{[wos ? `${wos} work order${wos === 1 ? '' : 's'}` : null, pos ? `${pos} purchase order${pos === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')} waiting in IN4</span>
      <span>— the yellow rows in the tree below, each with its rates against the last ones paid.</span>
      <span className="ml-auto text-[12px]">{mine ? `${mine} at Verify — the Atm Head’s turn` : 'none at Verify yet'} · approve in IN4</span>
    </p>
  )
}

const TURN_CLS: Record<PendingOrder['turn'], string> = {
  approver: 'bg-amber-200 text-amber-900 border-amber-300', verifier: 'bg-amber-100 text-amber-800 border-amber-200', raiser: 'bg-gray-100 text-gray-600 border-gray-200',
}

function TurnBadge({ o }: { o: PendingOrder }) {
  const days = daysSince(o.since)
  const late = o.turn === 'approver' && days != null && days > SLA_DAYS['PO approval']
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${TURN_CLS[o.turn]}`}>
      {o.status} · {TURN_LABEL[o.turn]}{days != null && days > 0 ? ` · ${days}d` : ''}{late ? ' · late' : ''}
    </span>
  )
}

function RateSummary({ o }: { o: PendingOrder }) {
  const deltas = o.lines.map(l => priceDelta(l.rate, o.refs.get(l.refKey))).filter((d): d is number => d != null)
  const up = deltas.filter(d => d > 5).length, down = deltas.filter(d => d < -5).length, firsts = o.lines.length - deltas.length
  if (o.lines.length === 0) return null
  return (
    <span className="text-[11px] tabular-nums">
      {up > 0 && <span className="text-rose-700 font-semibold mr-2">{up} higher</span>}
      {down > 0 && <span className="text-emerald-700 mr-2">{down} lower</span>}
      {deltas.length - up - down > 0 && <span className="text-gray-500 mr-2">{deltas.length - up - down} within 5%</span>}
      {firsts > 0 && <span className="text-amber-700">{firsts} first-time</span>}
    </span>
  )
}

/** Desktop: the yellow row inside the tree table, and its detail row. */
export function PendingOrderRow({ o, colSpan }: { o: PendingOrder; colSpan: number }) {
  const key = `pend:${o.kind}:${o.id}`
  return (
    <Fragment>
      <tr className="border-t border-amber-100 bg-amber-50">
        <td className="pl-12 pr-3 py-1.5">
          <RowDetailToggle id={key} count={Math.max(1, o.lines.length)} label="the lines and the rate check" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mr-1.5">{o.kind}</span>
          <span className="font-medium text-[12px] text-gray-900">{shortRef(o.ref)}</span>
          {o.party && <span className="ml-2 text-[12px] text-gray-600">{o.party}</span>}
          {o.date && <span className="ml-2 text-[12px] text-gray-500">{formatDate(o.date)}</span>}
          <span className="ml-2"><TurnBadge o={o} /></span>
          <span className="ml-2 text-[12px] text-gray-400">{o.lines.length} line{o.lines.length === 1 ? '' : 's'}</span>
          <span className="block mt-0.5 ml-6"><RateSummary o={o} />{meaningfulRemark(o.description) && <span className="text-[11px] text-gray-500 italic ml-2">“{meaningfulRemark(o.description)}”</span>}</span>
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-[12px] text-gray-900">{o.value > 0.5 ? formatINR(o.value) : <Dash />}<span className="block text-[11px] text-amber-700">not yet approved</span></td>
        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
        <td className="px-3 py-1.5 text-right text-gray-300">—</td>
      </tr>
      <RowDetail id={key}>
        <tr className="border-t border-amber-100 bg-amber-50/40">
          <td colSpan={colSpan} className="pl-12 pr-3 py-3"><PendingDetail o={o} /></td>
        </tr>
      </RowDetail>
    </Fragment>
  )
}

/** Mobile: the same as a yellow card. */
export function PendingOrderCard({ o }: { o: PendingOrder }) {
  const key = `pend:${o.kind}:${o.id}`
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-[12px] flex items-center flex-wrap gap-x-1">
        <RowDetailToggle id={key} count={Math.max(1, o.lines.length)} label="the lines and the rate check" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">{o.kind}</span>
        <span className="font-medium text-gray-900">{shortRef(o.ref)}</span>
        {o.date && <span className="text-gray-500">{formatDate(o.date)}</span>}
      </p>
      {o.party && <p className="ml-6 text-[12px] text-gray-600">{o.party}</p>}
      <p className="ml-6 mt-0.5 flex items-center gap-2 flex-wrap"><TurnBadge o={o} /><span className="text-[12px] tabular-nums text-gray-900">{o.value > 0.5 ? formatINR(o.value) : ''}</span></p>
      <p className="ml-6 mt-0.5"><RateSummary o={o} /></p>
      <RowDetail id={key}><div className="mt-2"><PendingDetail o={o} /></div></RowDetail>
    </div>
  )
}

/** Under the chevron: the lines with the rate check, then the history with the print links. */
export function PendingDetail({ o }: { o: PendingOrder }) {
  return (
    <div className="space-y-3">
      <LinesTable o={o} />
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
        <History title={`${o.kind === 'wo' ? 'WO' : 'PO'} ${shortRef(o.ref)}`} chain={o.chain} links={o.kind === 'wo'
          ? <a href={`/api/in4/work-order/${o.id}/print`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-indigo-700 hover:underline"><FileText className="h-3 w-3" /> Print</a>
          : <><a href={`/api/in4/purchase-order/${o.id}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Print</a>{' · '}<a href={`/api/in4/purchase-order/${o.id}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Ledger</a></>} />
      </div>
    </div>
  )
}

const TH = 'border-b border-gray-100 px-2 py-1.5'

/** The lines, the IE's item-wise shape, with the rate check. */
function LinesTable({ o }: { o: PendingOrder }) {
  const isPo = o.kind === 'po'
  const rows = o.lines.map((l, i) => ({ l, i, ref: referenceRate(o.refs.get(l.refKey)), delta: priceDelta(l.rate, o.refs.get(l.refKey)), ctx: o.refs.get(l.refKey) }))
  const total = o.lines.reduce((t, l) => t + l.amount, 0)
  if (o.lines.length === 0) return <p className="text-[12px] text-gray-500">IN4 holds no lines against this {isPo ? 'purchase order' : 'work order'} yet.</p>
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full table-fixed text-[12px] min-w-[900px]">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className={`${TH} w-[4%]`}>#</th>
            <th className={`${TH} w-[30%]`}>{isPo ? 'Material' : 'BOQ item'}</th>
            <th className={`${TH} w-[6%]`}>Unit</th>
            {isPo && <th className={`${TH} text-right w-[8%]`}>Indent qty</th>}
            <th className={`${TH} text-right w-[8%]`}>Qty</th>
            <th className={`${TH} text-right w-[10%]`}>Rate</th>
            <th className={`${TH} text-right w-[20%]`}>vs last paid <span className="normal-case text-gray-400 font-normal">this project first</span></th>
            <th className={`${TH} text-right w-[12%]`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ l, i, ref, delta, ctx }) => <Line key={l.id} l={l} i={i} isPo={isPo} ref_={ref} delta={delta} spread={ctx && ctx.minRate != null && ctx.maxRate != null && ctx.maxRate > ctx.minRate * 1.05 ? `${ctx.purchases} before · ${formatINR(ctx.minRate)}–${formatINR(ctx.maxRate)}` : null} />)}
          <tr className="border-t border-gray-300 bg-gray-100/70">
            <td />
            <td className="px-2 py-2 font-bold text-gray-900">{isPo ? 'PO total' : 'WO total'} <span className="font-normal text-gray-500">{isPo ? 'landed, with GST' : 'as in IN4'}</span></td>
            <td colSpan={isPo ? 5 : 4} />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Line({ l, i, isPo, ref_, delta, spread }: { l: OrderLinePending; i: number; isPo: boolean; ref_: ReturnType<typeof referenceRate>; delta: number | null; spread: string | null }) {
  const over = isPo && l.indentQty != null && l.qty > l.indentQty + 0.001
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
      <td className="px-2 py-1.5 text-gray-800">
        <p className="truncate" title={l.description ?? l.name}>{l.name}</p>
        {l.description && l.description !== l.name && <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{l.description}</p>}
        {l.indentRef && <p className="text-[11px] text-gray-400">{shortRef(l.indentRef)}</p>}
      </td>
      <td className="px-2 py-1.5 text-gray-600">{l.uom ?? ''}</td>
      {isPo && <td className="px-2 py-1.5 text-right tabular-nums">{l.indentQty == null ? <Dash /> : qty(l.indentQty)}</td>}
      <td className={`px-2 py-1.5 text-right tabular-nums ${over ? 'text-rose-700 font-semibold' : ''}`}>{qty(l.qty)}{over && <span className="block text-[11px] font-normal">over indent</span>}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{l.rate == null ? <Dash /> : formatINR(l.rate)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {ref_ ? <>
          <span className={delta == null ? 'text-gray-500' : delta > 5 ? 'text-rose-700 font-semibold' : delta < -5 ? 'text-emerald-700 font-semibold' : 'text-gray-700'}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</span>
          <span className="block text-[11px] text-gray-500 truncate">{formatINR(ref_.rate)} · {[ref_.from.supplier, ref_.from.date ? formatDate(ref_.from.date) : null, ref_.where === 'elsewhere' ? ref_.from.project : null].filter(Boolean).join(' · ')}</span>
          {spread && <span className="block text-[11px] text-gray-400">{spread}</span>}
        </> : <span className="text-amber-700">first of its kind</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatINR(l.amount)}</td>
    </tr>
  )
}
