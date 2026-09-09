import { Fragment } from 'react'
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { SLA_DAYS } from '@/lib/revamp/indents-tree'
import { shortRef, cleanName, meaningfulRemark } from '@/lib/revamp/indents-board'
import { referenceRate, priceDelta } from '@/lib/revamp/approver'
import { loadOrderApprovals, TURN_LABEL, type PendingOrder, type OrderLinePending } from '@/lib/revamp/order-approvals'
import { daysSince, History } from './IndentRows'

/**
 * WO / PO tab — "Waiting for approval in IN4", the approver's table: one row
 * per work order or purchase order at Submitted / Verify, and under each the
 * lines with every rate against the last rate paid for the same thing — a PO
 * line against the last PO for that material, a WO line against the last
 * approved WO for the same BOQ item (this project first, then the trust).
 * Then the history and the remarks. Approval itself happens in IN4.
 *
 * Aksha, 10 Sep 2026: "can we incorporate the last rate feature and change
 * in rate … for PO and WO as well … in the WO / PO section."
 */
export async function OrderApprovals({ projectId, subprojectIds, manyProjects = false }: { projectId?: string; subprojectIds?: number[]; manyProjects?: boolean }) {
  let subs = subprojectIds
  if (!subs && projectId) {
    const supabase = await createClient()
    const { data: links } = await supabase.from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
    const bphIds = (links ?? []).map(r => r.bph_project_id as string)
    const { data: subLinks } = bphIds.length ? await supabase.from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds) : { data: [] as Array<{ subproject_id: number }> }
    subs = [...new Set((subLinks ?? []).map(r => r.subproject_id as number))]
    if (subs.length === 0) return null // not linked — the tree below says so
  }
  const { orders, in4, error } = await loadOrderApprovals({ subprojectIds: subs })

  if (in4 !== 'live') {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] text-amber-900 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>{in4 === 'not-configured' ? 'No IN4 login on this deployment — what is waiting for approval in IN4 cannot be shown.' : `IN4 did not answer for the approvals list${error ? ` (${error})` : ''}.`}</span>
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

  return (
    <RowDetailProvider initialOpen={orders.map(o => `oa:${o.kind}:${o.id}`)}>
      <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
        <div className="px-3 py-2 border-b border-amber-100 bg-amber-50/60 text-sm font-bold text-gray-900">
          Waiting for approval in IN4
          <span className="ml-2 text-[12px] font-normal text-gray-600">
            {[wos ? `${wos} work order${wos === 1 ? '' : 's'}` : null, pos ? `${pos} purchase order${pos === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')} · the Atm Head’s turn first · every rate against the last one paid · approve in IN4
          </span>
        </div>
        <div className="overflow-auto max-h-[75vh]">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <Th className="min-w-[280px]">Document</Th>
                <Th className="w-52">{wos && pos ? 'Contractor / supplier' : wos ? 'Contractor' : 'Supplier'}</Th>
                <Th className="w-48">Category · where</Th>
                <Th className="w-40">Raised by</Th>
                <Th className="text-right w-16">Lines</Th>
                <Th className="text-right w-32">Value</Th>
                <Th className="text-right w-28">Rates vs last</Th>
                <Th className="w-28">With</Th>
                <Th className="text-right w-20">Waiting</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const key = `oa:${o.kind}:${o.id}`
                const days = daysSince(o.since)
                const late = days != null && days > SLA_DAYS['PO approval']
                const deltas = o.lines.map(l => priceDelta(l.rate, o.refs.get(l.refKey))).filter((d): d is number => d != null)
                const up = deltas.filter(d => d > 5).length, down = deltas.filter(d => d < -5).length, firsts = o.lines.length - deltas.length
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-gray-200 bg-gray-50/60 align-top">
                      <td className="px-3 py-2">
                        <RowDetailToggle id={key} count={o.lines.length} label="the lines" />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mr-2">{o.kind === 'wo' ? 'WO' : 'PO'}</span>
                        <span className="font-semibold text-gray-900">{shortRef(o.ref)}</span>
                        <span className="text-gray-500"> · {o.status}</span>
                        {o.date && <span className="ml-2 text-[12px] text-gray-500">{formatDate(o.date)}</span>}
                        {meaningfulRemark(o.description) && <span className="block ml-6 text-[12px] text-gray-600">{meaningfulRemark(o.description)}</span>}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-gray-700">{o.party ?? <Dash />}</td>
                      <td className="px-3 py-2 text-[12px] text-gray-600">
                        {o.category && <span className="block">{cleanName(o.category)}</span>}
                        {(manyProjects ? [o.project, o.subproject] : [o.subproject]).filter(Boolean).map(x => <span key={x} className="block text-gray-500">{x}</span>)}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-gray-600">{o.raisedBy ?? ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{o.lines.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{o.value > 0.5 ? formatINR(o.value) : <Dash />}</td>
                      <td className="px-3 py-2 text-right text-[12px] tabular-nums">
                        {deltas.length === 0 ? <span className="text-amber-700">all first-time</span> : <>
                          {up > 0 && <span className="block text-rose-700 font-semibold">{up} higher</span>}
                          {down > 0 && <span className="block text-emerald-700">{down} lower</span>}
                          {deltas.length - up - down > 0 && <span className="block text-gray-500">{deltas.length - up - down} within 5%</span>}
                          {firsts > 0 && <span className="block text-amber-700">{firsts} first-time</span>}
                        </>}
                      </td>
                      <td className={`px-3 py-2 text-[12px] ${o.turn === 'approver' ? 'text-indigo-800 font-semibold' : 'text-gray-500'}`}>{TURN_LABEL[o.turn]}</td>
                      <td className={`px-3 py-2 text-right tabular-nums text-[12px] ${late && o.turn === 'approver' ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>{days == null ? '' : `${days}d`}{late && o.turn === 'approver' ? <span className="block text-[11px] font-normal">late</span> : null}</td>
                    </tr>
                    <RowDetail id={key}>
                      <tr className="border-t border-gray-100 bg-gray-50/40">
                        <td colSpan={9} className="pl-9 pr-3 py-3 space-y-3">
                          <LinesTable o={o} />
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                            <History title={`${o.kind === 'wo' ? 'WO' : 'PO'} ${shortRef(o.ref)}`} chain={o.chain} links={o.kind === 'wo'
                              ? <a href={`/api/in4/work-order/${o.id}/print`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-indigo-700 hover:underline"><FileText className="h-3 w-3" /> Print</a>
                              : <><a href={`/api/in4/purchase-order/${o.id}/print`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Print</a>{' · '}<a href={`/api/in4/purchase-order/${o.id}/ledger`} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">Ledger</a></>} />
                          </div>
                        </td>
                      </tr>
                    </RowDetail>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </RowDetailProvider>
  )
}

const qty = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const Dash = () => <span className="text-gray-300">—</span>
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 ${className ?? ''}`}>{children}</th>
}
