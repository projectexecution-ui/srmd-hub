// Budget vs Actual, pill 2 — the orders tree.
//
// Same machinery and same colours as the Internal Estimate's category /
// sub-category table: TreeProvider + CatChevron + CatRows + SubRow, a desktop
// table whose header pins inside its OWN scroll box, and a matching card list
// on mobile. Aksha, 7 Sept 2026: "follow the Tree View of Cat/sub cat wise
// layout and colour scheme."
//
// The sticky header lives on the cells, not the page — page-level sticky is
// inert everywhere in this app (see AGENTS.md).

import { Fragment } from 'react'
import Link from 'next/link'
import { AlertTriangle, Info } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow } from '@/components/cost-control/project-tree'
import { loadOrdersTree, type OrdersSubRow } from '@/lib/revamp/orders-tree'

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

  // A mapping gap and an empty project are different things, and saying "no
  // orders" for the first would be a lie.
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
      <div className="space-y-3">
        {/* The three figures the tree adds up to, stated before the detail. */}
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
                {cats.length} categor{cats.length === 1 ? 'y' : 'ies'}, live from IN4
              </span>
            </span>
            <TreeToolbar />
          </div>

          {/* Desktop */}
          <div className="overflow-auto max-h-[70vh] hidden md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[280px]">Category / sub-category</th>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-24">Orders</th>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-36">Ordered</th>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Paid</th>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Balance</th>
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
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{formatINR(c.ordered)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.paid == null ? <Dash /> : formatINR(c.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                        {c.paid == null ? <Dash /> : formatINR(c.ordered - c.paid)}
                      </td>
                    </tr>
                    <CatRows catId={c.id}>
                      {c.subs.map(s => (
                        <SubRow key={s.id} empty={false}>
                          <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                            <td className="pl-9 pr-3 py-2 text-gray-700">
                              <RowName row={s} />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.count}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-900">{formatINR(s.ordered)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.paid == null ? <Dash /> : formatINR(s.paid)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                              {s.paid == null ? <Dash /> : formatINR(s.ordered - s.paid)}
                            </td>
                          </tr>
                        </SubRow>
                      ))}
                    </CatRows>
                  </Fragment>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-gray-900">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{totals.woCount + totals.poCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{formatINR(totals.ordered)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatINR(totals.paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">{formatINR(balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile — same data as cards, category bar pinning inside its own
              scroll box. */}
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
                    <div key={s.id} className="px-4 py-3">
                      <p className="text-sm text-gray-900"><RowName row={s} /></p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                        <span>{s.count} order{s.count === 1 ? '' : 's'}</span>
                        <span>Ordered <span className="font-semibold text-gray-900 tabular-nums">{formatINR(s.ordered)}</span></span>
                        <span>Paid <span className="font-semibold text-gray-700 tabular-nums">{s.paid == null ? '—' : formatINR(s.paid)}</span></span>
                        {s.paid != null && (
                          <span>Balance <span className="font-semibold text-amber-700 tabular-nums">{formatINR(s.ordered - s.paid)}</span></span>
                        )}
                      </div>
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

        {/* What the tree did with the awkward parts of the data, stated rather
            than applied quietly. */}
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
    </TreeProvider>
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
