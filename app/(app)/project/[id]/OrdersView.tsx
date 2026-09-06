// Budget vs Actual, pill 2 — the orders tree, four levels deep.
//
//   category → sub-category → order → line item
//
// Same machinery and same colours as the Internal Estimate's category /
// sub-category table: TreeProvider + CatChevron + CatRows for the first two
// levels, and RowDetailProvider + RowDetailToggle + RowDetail for the two
// below — the SAME "show the items" chevron the Internal Estimate already uses
// to open a sub-skill's item-wise BOQ, so the affordance is one people know.
// Aksha, 7 Sept 2026: "i want all the Line of Items as Tree view in WO/PO
// wise", and "follow the Tree View of Cat/sub cat wise layout and colour
// scheme".
//
// The sticky header lives on the cells inside their own scroll box, never on
// the page — page-level sticky is inert everywhere in this app (AGENTS.md).

import { Fragment } from 'react'
import Link from 'next/link'
import { AlertTriangle, Info } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import {
  TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow,
  RowDetailProvider, RowDetailToggle, RowDetail,
} from '@/components/cost-control/project-tree'
import { loadOrdersTree, type OrdersSubRow, type OrderRow, type OrderLine } from '@/lib/revamp/orders-tree'

/** Quantities are not money: they carry decimals and their own unit. */
const qty = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 })

export async function OrdersView({ projectId }: { projectId: string }) {
  const { cats, totals, notes, linked, error } = await loadOrdersTree(projectId)

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
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Not linked to an IN4 sub-project yet</p>
        <p className="text-xs text-amber-800 mt-1 max-w-2xl">
          Orders are read from IN4 through a confirmed mapping, never a name match. Confirm it on{' '}
          <Link href="/admin/masters/mapping" className="underline font-medium">Masters → Mapping</Link>{' '}
          and this tree fills in. Until then this is a gap in the mapping, not a project without orders.
        </p>
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
  const balance = totals.ordered - totals.paid

  return (
    <TreeProvider allCatIds={catIds} emptyCount={0}>
      <RowDetailProvider>
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Kpi label="Ordered" value={formatINR(totals.ordered)} />
            <Kpi label="Paid" value={formatINR(totals.paid)} muted />
            <Kpi label="Balance" value={formatINR(balance)} tone="amber" />
            <Kpi label="Orders" value={`${totals.woCount} WO · ${totals.poCount} PO`} muted />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900">
                Category — WO/PO wise
                <span className="ml-2 text-[11px] font-normal text-gray-500">
                  {cats.length} categor{cats.length === 1 ? 'y' : 'ies'} · {totals.lineCount} line items · live from IN4
                </span>
              </span>
              <TreeToolbar />
            </div>

            {/* Desktop */}
            <div className="overflow-auto max-h-[70vh] hidden md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <Th className="min-w-[300px] text-left">Category / sub-category / order / item</Th>
                    <Th className="text-right w-24">Unit</Th>
                    <Th className="text-right w-24">Qty</Th>
                    <Th className="text-right w-28">Rate</Th>
                    <Th className="text-right w-36">Ordered</Th>
                    <Th className="text-right w-32">Paid</Th>
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
                        </td>
                        <td colSpan={3} className="px-3 py-2 text-right text-[11px] text-gray-500">
                          {c.count} order{c.count === 1 ? '' : 's'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{formatINR(c.ordered)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.paid == null ? <Dash /> : formatINR(c.paid)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {c.paid == null ? <Dash /> : formatINR(c.ordered - c.paid)}
                        </td>
                      </tr>

                      <CatRows catId={c.id}>
                        {c.subs.map(s => (
                          <SubRow key={s.id} empty={false}>
                            {/* Level 2 — sub-category. Its chevron opens the orders. */}
                            <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                              <td className="pl-6 pr-3 py-2 text-gray-700">
                                <RowDetailToggle id={s.id} count={s.orders.length} />
                                <RowName row={s} />
                              </td>
                              <td colSpan={3} className="px-3 py-2 text-right text-[11px] text-gray-400">
                                {s.count} order{s.count === 1 ? '' : 's'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{formatINR(s.ordered)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.paid == null ? <Dash /> : formatINR(s.paid)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                                {s.paid == null ? <Dash /> : formatINR(s.ordered - s.paid)}
                              </td>
                            </tr>

                            {/* Level 3 — the orders themselves. */}
                            <RowDetail id={s.id}>
                              {s.orders.map(o => (
                                <Fragment key={o.id}>
                                  <tr className="border-t border-gray-100 bg-slate-50/50">
                                    <td className="pl-12 pr-3 py-1.5">
                                      <RowDetailToggle id={o.id} count={o.lines.length} />
                                      <span className="font-mono text-[11.5px] text-gray-700">{o.ref}</span>
                                      {o.party && <span className="ml-2 text-[11.5px] text-gray-500">{o.party}</span>}
                                    </td>
                                    <td colSpan={3} className="px-3 py-1.5 text-right text-[11px] text-gray-400">
                                      {o.lines.length} item{o.lines.length === 1 ? '' : 's'}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">{formatINR(o.ordered)}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{o.paid == null ? <Dash /> : formatINR(o.paid)}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">
                                      {o.paid == null ? <Dash /> : formatINR(o.ordered - o.paid)}
                                    </td>
                                  </tr>

                                  {/* Level 4 — the line items. */}
                                  <RowDetail id={o.id}>
                                    {o.lines.map(l => (
                                      <tr key={l.id} className="border-t border-gray-50 bg-white">
                                        <td className="pl-[4.5rem] pr-3 py-1.5">
                                          <p className="text-[12px] text-gray-800">{l.name}</p>
                                          {l.description && (
                                            <p className="text-[11px] text-gray-400 leading-snug line-clamp-2">{l.description}</p>
                                          )}
                                        </td>
                                        <td className="px-3 py-1.5 text-right text-[11.5px] text-gray-500">{l.uom ?? '—'}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px] text-gray-600">{qty(l.qty)}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px] text-gray-600">{l.rate == null ? '—' : formatINR(l.rate)}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">{formatINR(l.amount)}</td>
                                        {/* Paid and balance are held per ORDER, never per line. */}
                                        <td className="px-3 py-1.5 text-right"><Dash /></td>
                                        <td className="px-3 py-1.5 text-right"><Dash /></td>
                                      </tr>
                                    ))}
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
                    <td className="px-3 py-2 text-gray-900">Total</td>
                    <td colSpan={3} className="px-3 py-2 text-right text-[11px] text-gray-500">
                      {totals.woCount + totals.poCount} orders
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{formatINR(totals.ordered)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatINR(totals.paid)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{formatINR(balance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile — the same four levels as nested cards. */}
            <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
              {cats.map(c => (
                <div key={c.id}>
                  <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                    <span className="flex items-center min-w-0 text-[12px] font-semibold text-gray-800">
                      <CatChevron catId={c.id} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="text-[11px] text-gray-600 flex-shrink-0 whitespace-nowrap tabular-nums">
                      {formatINR(c.ordered)}
                    </span>
                  </div>
                  <CatRows catId={c.id}>
                    {c.subs.map(s => (
                      <div key={s.id} className="px-4 py-2.5 border-t border-gray-50">
                        <p className="text-[13px] text-gray-900 flex items-center">
                          <RowDetailToggle id={s.id} count={s.orders.length} />
                          <RowName row={s} />
                        </p>
                        <div className="mt-0.5 ml-6 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                          <span>{s.count} order{s.count === 1 ? '' : 's'}</span>
                          <span>Ordered <span className="font-semibold text-gray-900 tabular-nums">{formatINR(s.ordered)}</span></span>
                          <span>Paid <span className="font-semibold text-gray-700 tabular-nums">{s.paid == null ? '—' : formatINR(s.paid)}</span></span>
                        </div>

                        <RowDetail id={s.id}>
                          <div className="mt-2 ml-6 space-y-2">
                            {s.orders.map(o => (
                              <div key={o.id} className="rounded-lg border border-gray-100 bg-slate-50/50 px-3 py-2">
                                <p className="text-[12px] flex items-center">
                                  <RowDetailToggle id={o.id} count={o.lines.length} />
                                  <span className="font-mono text-gray-700">{o.ref}</span>
                                </p>
                                {o.party && <p className="ml-6 text-[11px] text-gray-500">{o.party}</p>}
                                <div className="ml-6 mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-gray-500">
                                  <span>Ordered <span className="font-semibold text-gray-800 tabular-nums">{formatINR(o.ordered)}</span></span>
                                  {o.paid != null && <span>Paid <span className="font-semibold text-gray-700 tabular-nums">{formatINR(o.paid)}</span></span>}
                                </div>
                                <RowDetail id={o.id}>
                                  <ul className="ml-6 mt-1.5 space-y-1.5 border-l border-gray-200 pl-2.5">
                                    {o.lines.map(l => <LineCard key={l.id} line={l} />)}
                                  </ul>
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
              <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-900">Total</span>
                <span className="text-[12px] font-semibold text-gray-900 tabular-nums">{formatINR(totals.ordered)}</span>
              </div>
            </div>
          </div>

          {/* What the tree did with the awkward parts of the data, stated
              rather than applied quietly. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-gray-400" /> How this is put together
            </p>
            <ul className="mt-1 space-y-1">
              {notes.map((n, i) => (
                <li key={i} className="text-[11.5px] text-gray-600 leading-relaxed">{n}</li>
              ))}
            </ul>
          </div>
        </div>
      </RowDetailProvider>
    </TreeProvider>
  )
}

function LineCard({ line }: { line: OrderLine }) {
  return (
    <li>
      <p className="text-[12px] text-gray-800">{line.name}</p>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-500 tabular-nums">
        {line.uom && <span>{line.uom}</span>}
        <span>{qty(line.qty)}</span>
        {line.rate != null && <span>× {formatINR(line.rate)}</span>}
        <span className="font-semibold text-gray-800">{formatINR(line.amount)}</span>
      </div>
    </li>
  )
}

/** A sub-category row's label, with the two "IN4 holds nothing here" cases
 *  marked so a reader never mistakes them for a real category. */
function RowName({ row }: { row: OrdersSubRow }) {
  if (row.kind === 'po') {
    return (
      <span className="inline-flex items-center gap-1.5">
        {row.name}
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-100">PO</span>
      </span>
    )
  }
  if (row.unassigned) return <span className="text-gray-500 italic">{row.name}</span>
  return <>{row.name}</>
}

const Dash = () => <span className="text-gray-300">—</span>

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 ${className ?? ''}`}>
      {children}
    </th>
  )
}

function Kpi({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className={`text-[15px] font-bold mt-0.5 tabular-nums ${
        tone === 'amber' ? 'text-amber-700' : muted ? 'text-gray-700' : 'text-gray-900'
      }`}>{value}</p>
    </div>
  )
}

// Referenced for its type only; kept so the import stays honest.
export type { OrderRow }
