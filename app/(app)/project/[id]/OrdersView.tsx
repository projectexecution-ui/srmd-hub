// Budget vs Actual, pill 2 — the orders tree, five levels deep.
//
//   category → sub-category → order → line item → bill
//
// Same machinery and same colours as the Internal Estimate's category /
// sub-category table: TreeProvider + CatChevron + CatRows for the first two
// levels, and RowDetailProvider + RowDetailToggle + RowDetail for the ones
// below — the SAME "show the items" chevron the Internal Estimate already uses
// to open a sub-skill's item-wise BOQ, so the affordance is one people know.
//
// Money columns, left to right, all as IN4 holds them (see orders-tree.ts):
// Ordered (the full order, before-tax value under it) · Billed · Paid (bills
// + advances, TDS counted as paid) · Adv. o/s · Retention · Balance
// (Ordered − Paid − Retention, the one derived figure). Aksha, 8 Sept 2026.
//
// The sticky header lives on the cells inside their own scroll box, never on
// the page — page-level sticky is inert everywhere in this app (AGENTS.md).

import { Fragment } from 'react'
import Link from 'next/link'
import { AlertTriangle, Info, FileText } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import {
  TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow,
  RowDetailProvider, RowDetailToggle, RowDetail,
} from '@/components/cost-control/project-tree'
import { loadOrdersTree, type OrdersSubRow, type OrderRow, type OrderLine, type Money } from '@/lib/revamp/orders-tree'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

/** Quantities are not money: they carry decimals and their own unit. */
const qty = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 })

/** A money cell that shows a dash where IN4 holds nothing, never a zero. */
const money = (v: number | null) => (v == null ? <Dash /> : formatINR(v))

export async function OrdersView({ projectId }: { projectId: string }) {
  const { cats, totals, notes, linked, error, in4 } = await loadOrdersTree(projectId)

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> The orders tree could not be read
        </p>
        <p className="text-xs text-rose-800 mt-1 font-mono break-all">{error}</p>
      </div>
    )
  }

  // A mapping gap and an empty project are different things, and calling the
  // first "no orders" would be a lie.
  if (!linked) {
    // Says what to do, not only what is wrong (UX 32). Only a reviewer can
    // fix the mapping; everyone else is told who can.
    const reviewer = await checkIsCcReviewer()
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Not linked to an IN4 sub-project yet</p>
        <p className="text-xs text-amber-800 mt-1 max-w-2xl">
          Orders are read from IN4 through a confirmed mapping, never a name match. This is a gap in the
          mapping, not a project without orders.
        </p>
        {reviewer ? (
          <Link href="/admin/masters/mapping" className="mt-3 inline-flex items-center rounded-lg bg-amber-700 px-3 text-xs font-semibold text-white min-h-[44px] hover:bg-amber-800">
            Link it in Masters → Mapping
          </Link>
        ) : (
          <p className="mt-2 text-xs text-amber-800">Ask Aksha or a reviewer to link it; the tree fills in once it is.</p>
        )}
      </div>
    )
  }

  if (cats.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm text-gray-600">No work orders or purchase orders on this project in IN4.</p>
        <p className="text-xs text-gray-400 mt-1">The mapping is confirmed — IN4 simply holds no orders against it yet.</p>
      </div>
    )
  }

  const catIds = cats.map(c => c.id)
  const live = in4 === 'live'

  return (
    <TreeProvider allCatIds={catIds} emptyCount={0}>
      <RowDetailProvider>
        <div className="space-y-3">
          {!live && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                {in4 === 'not-configured'
                  ? 'This deployment has no IN4 login, so Billed, Paid, Adv. o/s, Retention and Balance are blank. Ordered shows the mirror’s last-synced figure.'
                  : 'IN4 could not be reached just now, so Billed, Paid, Adv. o/s, Retention and Balance are blank rather than stale. Ordered shows the mirror’s last-synced figure.'}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Ordered" value={formatINR(totals.gross)} />
            <Kpi label="Billed" value={live ? formatINR(totals.billed) : '—'} muted />
            <Kpi label="Paid (money out)" value={live ? formatINR(totals.paid) : '—'} muted />
            <Kpi label="Balance" value={live ? formatINR(totals.balance) : '—'} tone="amber" />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900">
                Category — WO/PO wise
                <span className="ml-2 text-[12px] font-normal text-gray-500">
                  {cats.length} categor{cats.length === 1 ? 'y' : 'ies'} · {totals.woCount} WO · {totals.poCount} PO · {totals.lineCount} line items
                  {live ? ' · live from IN4' : ' · mirror'}
                </span>
              </span>
              <TreeToolbar />
            </div>

            {/* Desktop */}
            <div className="overflow-auto max-h-[70vh] hidden md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <Th className="min-w-[300px] text-left">Category / sub-category / order</Th>
                    <Th className="text-right w-36">Ordered</Th>
                    <Th className="text-right w-32">Billed</Th>
                    <Th className="text-right w-36">Paid <span className="font-normal text-gray-400">(money out)</span></Th>
                    <Th className="text-right w-28">Adv. o/s</Th>
                    <Th className="text-right w-28">Retention</Th>
                    <Th className="text-right w-32">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map(c => (
                    <Fragment key={c.id}>
                      <tr className="bg-gray-50/60 border-t border-gray-200">
                        <td className="px-3 py-2 font-semibold text-gray-800">
                          <CatChevron catId={c.id} />
                          {c.name}
                          <span className="ml-2 text-[12px] font-normal text-gray-500">{c.count} order{c.count === 1 ? '' : 's'}</span>
                        </td>
                        <MoneyCells m={c} bold />
                      </tr>

                      <CatRows catId={c.id}>
                        {c.subs.map(s => (
                          <SubRow key={s.id} empty={false}>
                            {/* Level 2 — sub-category. Its chevron opens the orders. */}
                            <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                              <td className="pl-6 pr-3 py-2 text-gray-700">
                                <RowDetailToggle id={s.id} count={s.orders.length} />
                                <RowName row={s} />
                                <span className="ml-2 text-[12px] text-gray-400">{s.count} order{s.count === 1 ? '' : 's'}</span>
                              </td>
                              <MoneyCells m={s} />
                            </tr>

                            {/* Level 3 — the orders themselves. */}
                            <RowDetail id={s.id}>
                              {s.orders.map(o => (
                                <Fragment key={o.id}>
                                  <tr className="border-t border-gray-100 bg-slate-50/50">
                                    <td className="pl-12 pr-3 py-1.5">
                                      <RowDetailToggle id={o.id} count={o.lines.length} />
                                      <span className="font-mono text-[12px] text-gray-700">{o.ref}</span>
                                      {o.party && <span className="ml-2 text-[12px] text-gray-500">{o.party}</span>}
                                      {/* Work orders only: IN4 holds a print
                                          template for them (event 3) and none
                                          for purchase orders. */}
                                      {o.kind === 'wo' && <PrintWo id={o.id} ref_={o.ref} />}
                                      <span className="ml-2 text-[12px] text-gray-400">{o.lines.length} item{o.lines.length === 1 ? '' : 's'}</span>
                                      {o.flag && <span className="block mt-0.5 text-[12px] text-amber-700">{o.flag}</span>}
                                    </td>
                                    <MoneyCells m={o} small />
                                  </tr>

                                  {/* Level 4 — the line items, as their own
                                      table inside one full-width cell: the
                                      same shape the Internal Estimate uses
                                      for a sub-skill's item-wise BOQ
                                      (SubSkillBoq), so a reader who knows
                                      that screen knows this one. */}
                                  <RowDetail id={o.id}>
                                    <tr className="border-t border-gray-100 bg-gray-50/40">
                                      <td colSpan={7} className="pl-12 pr-3 py-3">
                                        <OrderItems order={o} />
                                      </td>
                                    </tr>
                                  </RowDetail>
                                </Fragment>
                              ))}
                            </RowDetail>
                          </SubRow>
                        ))}
                      </CatRows>
                    </Fragment>
                  ))}

                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-900">
                      Total
                      <span className="ml-2 text-[12px] font-normal text-gray-500">{totals.woCount + totals.poCount} orders</span>
                    </td>
                    <MoneyCells m={live ? totals : { ...totals, billed: null, paid: null, advanceOutstanding: null, retention: null, balance: null }} bold />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile — the same levels as nested cards. */}
            <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
              {cats.map(c => (
                <div key={c.id}>
                  <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                    <span className="flex items-center min-w-0 text-[12px] font-semibold text-gray-800">
                      <CatChevron catId={c.id} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-[12px] text-gray-600 flex-shrink-0 whitespace-nowrap tabular-nums">
                      {money(c.gross)}
                    </span>
                  </div>
                  <CatRows catId={c.id}>
                    {c.subs.map(s => (
                      <div key={s.id} className="px-4 py-2.5 border-t border-gray-50">
                        <p className="text-[13px] text-gray-900 flex items-center">
                          <RowDetailToggle id={s.id} count={s.orders.length} />
                          <RowName row={s} />
                        </p>
                        <MoneyChips m={s} count={s.count} />

                        <RowDetail id={s.id}>
                          <div className="mt-2 ml-6 space-y-2">
                            {s.orders.map(o => (
                              <div key={o.id} className="rounded-lg border border-gray-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[12px] flex items-center">
                                  <RowDetailToggle id={o.id} count={o.lines.length} />
                                  <span className="font-mono text-gray-700">{o.ref}</span>
                                </p>
                                {o.party && <p className="ml-6 text-[12px] text-gray-500">{o.party}</p>}
                                {o.kind === 'wo' && <p className="ml-6 mt-0.5"><PrintWo id={o.id} ref_={o.ref} /></p>}
                                {o.flag && <p className="ml-6 mt-0.5 text-[12px] text-amber-700">{o.flag}</p>}
                                <div className="ml-6"><MoneyChips m={o} /></div>
                                <RowDetail id={o.id}>
                                  <div className="mt-2">
                                    <OrderItems order={o} />
                                  </div>
                                </RowDetail>
                              </div>
                            ))}
                          </div>
                        </RowDetail>
                      </div>
                    ))}
                  </CatRows>
                </div>
              ))}
              <div className="px-4 py-3 bg-gray-50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-gray-900">Total ordered (full)</span>
                  <span className="text-[12px] font-semibold text-gray-900 tabular-nums">{formatINR(totals.gross)}</span>
                </div>
                {live && (
                  <div className="flex items-center justify-between text-[12px] text-gray-600 flex-wrap gap-x-3">
                    <span>Billed {formatINR(totals.billed)} · Paid {formatINR(totals.paid)} · Retention {formatINR(totals.retention)}</span>
                    <span className="font-semibold text-amber-700 tabular-nums">Balance {formatINR(totals.balance)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* What the tree did with the awkward parts of the data, stated
              rather than applied quietly. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5">
            <p className="text-[12px] font-semibold text-gray-700 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-gray-400" /> How this is put together
            </p>
            <ul className="mt-1 space-y-1">
              {notes.map((n, i) => (
                <li key={i} className="text-[12px] text-gray-600 leading-relaxed">{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </RowDetailProvider>
    </TreeProvider>
  )
}

/** The six money cells of a tree row, desktop. Ordered shows the FULL amount
 *  with the before-tax value beneath when they differ. */
function MoneyCells({ m, bold, small }: { m: Money; bold?: boolean; small?: boolean }) {
  const py = small ? 'py-1.5' : 'py-2'
  const strong = bold ? 'font-semibold text-gray-900' : 'text-gray-900'
  return (
    <>
      <td className={`px-3 ${py} text-right tabular-nums ${strong}`}>
        {m.gross == null ? formatINR(m.ordered) : formatINR(m.gross)}
      </td>
      <td className={`px-3 ${py} text-right tabular-nums text-gray-700`}>{money(m.billed)}</td>
      <td className={`px-3 ${py} text-right tabular-nums text-gray-700`}>{money(m.paid)}</td>
      <td className={`px-3 ${py} text-right tabular-nums text-gray-600`}>{money(m.advanceOutstanding)}</td>
      <td className={`px-3 ${py} text-right tabular-nums text-gray-600`}>{money(m.retention)}</td>
      <td className={`px-3 ${py} text-right tabular-nums text-amber-700 ${bold ? 'font-semibold' : ''}`}>{money(m.balance)}</td>
    </>
  )
}

/** The same six figures as inline chips, mobile. Blank figures are left out
 *  rather than shown as dashes, so a PO row does not carry four dashes. */
function MoneyChips({ m, count }: { m: Money; count?: number }) {
  const chip = (label: string, v: number | null, cls = 'text-gray-800') =>
    v == null ? null : <span key={label}>{label} <span className={`font-semibold tabular-nums ${cls}`}>{formatINR(v)}</span></span>
  return (
    <div className="mt-0.5 ml-6 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-gray-500">
      {count != null && <span>{count} order{count === 1 ? '' : 's'}</span>}
      {chip('Ordered', m.gross ?? m.ordered, 'text-gray-900')}
      {chip('Billed', m.billed)}
      {chip('Paid', m.paid)}
      {chip('Adv. o/s', m.advanceOutstanding, 'text-gray-700')}
      {chip('Retention', m.retention, 'text-gray-700')}
      {chip('Balance', m.balance, 'text-amber-700')}
    </div>
  )
}

/**
 * An order's line items in the Internal Estimate's item-wise shape
 * (components/cost-control/SubSkillBoq.tsx): a bordered card, a grey header
 * row with the order number and its total, then # · Description · Unit ·
 * Qty · Rate · Amount — and, because this is an ORDER rather than an
 * estimate, three more columns for what IN4 has certified against each line
 * so far: Certified Qty · Certified Amt · Bills. Each line's bill count is a
 * chevron that opens the bills themselves: date, bill number, quantity on
 * that bill, running quantity against the ordered quantity, amount.
 *
 * Desktop is the table; below md the same rows render as cards.
 */
function OrderItems({ order: o }: { order: OrderRow }) {
  if (o.lines.length === 0) {
    return (
      <p className="text-[12px] text-gray-500">
        IN4 holds no line items against this {o.kind === 'wo' ? 'work order' : 'purchase order'}.
      </p>
    )
  }
  const isWo = o.kind === 'wo'

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <span className="text-[12px] font-semibold text-gray-900">
          <span className="font-mono">{o.ref}</span>
          <span className="ml-2 font-normal text-gray-500">
            {o.lines.length} line item{o.lines.length === 1 ? '' : 's'}{o.party ? ` · ${o.party}` : ''}
          </span>
        </span>
        <span className="text-[12px] tabular-nums text-gray-700">
          Ordered <b className="text-gray-900">{formatINR(o.ordered)}</b>
          {' · '}{isWo ? 'Certified' : 'Received'} <b className="text-gray-900">{o.certifiedAmt == null ? '—' : formatINR(o.certifiedAmt)}</b>
        </span>
      </div>

      {/* Desktop: the Internal Estimate's columns, then the certified ones. */}
      <table className="w-full table-fixed text-[12px] hidden md:table">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[4%]">#</th>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[30%]">Description</th>
            <th className="border-b border-gray-100 px-2 py-1.5 w-[6%]">Unit</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[9%]">Qty</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[11%]">Rate</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[12%]">Amount</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[9%] text-emerald-700">{isWo ? 'Certified qty' : 'Received qty'}</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[12%] text-emerald-700">{isWo ? 'Certified amt' : 'Received value'}</th>
            <th className="border-b border-gray-100 px-2 py-1.5 text-right w-[7%]">{isWo ? 'Bills' : 'GRNs'}</th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l, i) => (
            <Fragment key={l.id}>
              <tr className="border-t border-gray-100">
                <td className="px-2 py-1.5 text-gray-400 align-top">{i + 1}</td>
                <td className="px-2 py-1.5 text-gray-800 align-top">
                  <p className="truncate" title={l.description ?? l.name}>{l.name}</p>
                  {l.description && l.description !== l.name && (
                    <p className="text-[12px] text-gray-400 leading-snug line-clamp-2">{l.description}</p>
                  )}
                </td>
                <td className="px-2 py-1.5 text-gray-600 align-top">{l.uom ?? ''}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top">{qty(l.qty)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top">{l.rate == null ? '' : formatINR(l.rate)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold align-top">{formatINR(l.amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top text-emerald-800">
                  {l.certifiedQty == null ? <Dash /> : qty(l.certifiedQty)}
                  {l.certifiedQty != null && l.qty ? (
                    <span className="block text-[12px] text-gray-400">{pctOf(l.certifiedQty, l.qty)} of qty</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top text-emerald-800 font-semibold">
                  {l.certifiedAmt == null ? <Dash /> : formatINR(l.certifiedAmt)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums align-top text-gray-500 whitespace-nowrap">
                  {l.bills.length ? <RowDetailToggle id={`${o.id}:${l.id}`} count={l.bills.length} /> : <Dash />}
                </td>
              </tr>
              {/* Level 5 — the bills on this line, oldest first. */}
              {l.bills.length > 0 && (
                <RowDetail id={`${o.id}:${l.id}`}>
                  <tr className="bg-emerald-50/40">
                    <td />
                    <td colSpan={8} className="px-2 py-2">
                      <BillsTable line={l} kind={o.kind} />
                    </td>
                  </tr>
                </RowDetail>
              )}
            </Fragment>
          ))}
          <tr className="border-t border-gray-300 bg-gray-100/70">
            <td />
            <td className="px-2 py-2 font-bold text-gray-900">Lines total</td>
            <td colSpan={3} />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-900">{formatINR(o.lineTotal)}</td>
            <td />
            <td className="px-2 py-2 text-right font-bold tabular-nums text-emerald-800">
              {o.certifiedAmt == null ? <Dash /> : formatINR(o.certifiedAmt)}
            </td>
            <td />
          </tr>
          {o.lineNote && (
            <tr className="bg-gray-100/70">
              <td />
              <td className="px-2 pb-2 text-[12px] text-amber-800" colSpan={8}>{o.lineNote}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Mobile: one card per line, the same figures in the same order. */}
      <ul className="md:hidden divide-y divide-gray-100">
        {o.lines.map((l, i) => (
          <li key={l.id} className="px-3 py-2">
            <p className="text-[12px] text-gray-800"><span className="text-gray-400 mr-1.5">{i + 1}.</span>{l.name}</p>
            {l.description && l.description !== l.name && (
              <p className="text-[12px] text-gray-400 leading-snug line-clamp-2">{l.description}</p>
            )}
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-gray-500 tabular-nums">
              {l.uom && <span>{l.uom}</span>}
              <span>{qty(l.qty)}</span>
              {l.rate != null && <span>× {formatINR(l.rate)}</span>}
              <span className="font-semibold text-gray-800">{formatINR(l.amount)}</span>
            </div>
            {(
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-emerald-800 tabular-nums">
                <span>{isWo ? 'Certified' : 'Received'} {l.certifiedQty == null ? '—' : qty(l.certifiedQty)}{l.uom && l.certifiedQty != null ? ` ${l.uom}` : ''}</span>
                <span className="font-semibold">{l.certifiedAmt == null ? '—' : formatINR(l.certifiedAmt)}</span>
                {l.bills.length > 0 && <RowDetailToggle id={`${o.id}:${l.id}`} count={l.bills.length} />}
              </div>
            )}
            {l.bills.length > 0 && (
              <RowDetail id={`${o.id}:${l.id}`}>
                <div className="mt-1.5 rounded border border-emerald-100 bg-emerald-50/40 p-2 overflow-x-auto">
                  <BillsTable line={l} kind={o.kind} />
                </div>
              </RowDetail>
            )}
          </li>
        ))}
        <li className="px-3 py-2 bg-gray-100/70 flex items-center justify-between text-[12px] font-bold tabular-nums">
          <span className="text-gray-900">Lines total {formatINR(o.lineTotal)}</span>
          {o.certifiedAmt != null && <span className="text-emerald-800">{isWo ? 'Certified' : 'Received'} {formatINR(o.certifiedAmt)}</span>}
        </li>
        {o.lineNote && <li className="px-3 py-1.5 text-[12px] text-amber-800 bg-gray-100/70">{o.lineNote}</li>}
      </ul>
    </div>
  )
}

/** The bills (or, on a purchase order, the GRNs) on one line item: when,
 *  which one, how much on it, how much in total so far against the ordered
 *  quantity, and the amount. */
function BillsTable({ line: l, kind }: { line: OrderLine; kind: 'wo' | 'po' }) {
  return (
    <table className="w-full text-[12px] tabular-nums">
      <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
        <tr>
          <th className="px-2 py-1 w-[14%]">Date</th>
          <th className="px-2 py-1 w-[26%]">{kind === 'wo' ? 'Bill' : 'GRN'}</th>
          <th className="px-2 py-1 text-right w-[15%]">{kind === 'wo' ? 'This bill' : 'This GRN'}</th>
          <th className="px-2 py-1 text-right w-[15%]">Cumulative</th>
          <th className="px-2 py-1 text-right w-[12%]">Of ordered</th>
          <th className="px-2 py-1 text-right w-[18%]">Amount</th>
        </tr>
      </thead>
      <tbody>
        {l.bills.map((b, i) => (
          <tr key={i} className="border-t border-emerald-100/70">
            <td className="px-2 py-1 text-gray-600">{b.date ?? '—'}</td>
            <td className="px-2 py-1 text-gray-800 font-mono truncate" title={b.billNo ?? (b.abstractNo ? `No bill number in IN4 — abstract ${b.abstractNo}` : undefined)}>{b.billNo ?? (b.abstractNo ? <span className="text-gray-500">abstract {b.abstractNo}</span> : '—')}</td>
            <td className="px-2 py-1 text-right text-gray-800">{qty(b.qty)}{l.uom ? <span className="text-gray-400"> {l.uom}</span> : null}</td>
            <td className="px-2 py-1 text-right text-emerald-800 font-semibold">{qty(b.cumQty)}</td>
            <td className="px-2 py-1 text-right text-gray-600">{l.qty ? pctOf(b.cumQty, l.qty) : '—'}</td>
            <td className="px-2 py-1 text-right text-gray-800">{formatINR(b.amount)}</td>
          </tr>
        ))}
        <tr className="border-t border-emerald-200">
          <td className="px-2 py-1 text-gray-500" colSpan={2}>Ordered {qty(l.qty)}{l.uom ? ` ${l.uom}` : ''}</td>
          <td />
          <td className="px-2 py-1 text-right text-emerald-800 font-semibold">{qty(l.certifiedQty)}</td>
          <td className="px-2 py-1 text-right text-gray-600">{l.qty && l.certifiedQty != null ? pctOf(l.certifiedQty, l.qty) : '—'}</td>
          <td className="px-2 py-1 text-right text-emerald-800 font-semibold">{l.certifiedAmt == null ? '—' : formatINR(l.certifiedAmt)}</td>
        </tr>
      </tbody>
    </table>
  )
}

const pctOf = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`

/** Why an order's lines do not add up to its value — a fact about the IN4
 *  record (discount or amendment), shown on the row so nobody reads the gap
 *  as a CT Hub mistake. */
function LineNote({ text }: { text: string }) {
  return (
    <span className="block mt-0.5 text-[12px] text-amber-800 leading-snug">
      <Info className="inline h-3 w-3 mr-1 -mt-0.5 text-amber-600" />{text}
    </span>
  )
}

/** A sub-category row's label, with the two "IN4 holds nothing here" cases
 *  marked so a reader never mistakes them for a real category. */
function RowName({ row }: { row: OrdersSubRow }) {
  if (row.kind === 'po') {
    return (
      <span className="inline-flex items-center gap-1.5">
        {row.name}
        <span className="text-[12px] font-semibold rounded px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-100">PO</span>
      </span>
    )
  }
  if (row.unassigned) return <span className="text-gray-500 italic">{row.name}</span>
  return <>{row.name}</>
}

/** Opens the order in IN4's OWN print format, rendered live from IN4's
 *  template. A new tab, because it is a document rather than a screen — and
 *  the page it opens carries the Print button that makes the PDF. */
function PrintWo({ id, ref_ }: { id: string; ref_: string }) {
  const woId = id.replace(/^wo:/, '')
  return (
    <a
      href={`/api/in4/work-order/${woId}/print`}
      target="_blank"
      rel="noopener"
      title={`Open ${ref_} in IN4's own work-order format`}
      className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:underline max-md:min-h-[44px] max-md:px-2"
    >
      <FileText className="h-3 w-3" /> Print
    </a>
  )
}

const Dash = () => <span className="text-gray-300">—</span>

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 ${className ?? ''}`}>
      {children}
    </th>
  )
}

function Kpi({ label, value, sub, muted, tone }: { label: string; value: string; sub?: string; muted?: boolean; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className={`text-[15px] font-bold mt-0.5 tabular-nums ${
        tone === 'amber' ? 'text-amber-700' : muted ? 'text-gray-700' : 'text-gray-900'
      }`}>{value}</p>
      {sub && <p className="text-[12px] text-gray-500 tabular-nums mt-0.5">{sub}</p>}
    </div>
  )
}
