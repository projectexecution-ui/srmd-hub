import Link from 'next/link'
import { FileText, Info, Link2Off } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadOrdersTree } from '@/lib/revamp/orders-tree'
import { buildAccounts, type AccountsOrder, type PartyAccount } from '@/lib/revamp/accounts-data'

/**
 * Accounts — the WO/PO tree's money regrouped by what an accounts person
 * asks: what is due now, which deliveries have no bill yet, what is held
 * back, and each party's account. One screen, four sections, every section
 * collapsed to its total until opened (Aksha: collapse by default). Nothing
 * here is computed afresh — see lib/revamp/accounts-data.ts.
 *
 * Reviewer-only: it is project-level money, like Approvals.
 */
export async function AccountsTab({ projectId }: { projectId: string }) {
  const tree = await loadOrdersTree(projectId)

  if (!tree.linked) {
    return (
      <EmptyState
        icon={<Link2Off className="h-10 w-10" />}
        title="Not linked to IN4"
        description="This project is not mapped to an IN4 project yet, so there are no orders, bills or payments to account for. Link it under Setup."
        action={<Link href={`/project/${projectId}/setup`} className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]">Open Setup</Link>}
      />
    )
  }
  if (tree.error) {
    return <EmptyState title="The orders could not be read" description={tree.error} />
  }

  const a = buildAccounts(tree)
  const wos = a.parties.reduce((n, p) => n + p.orders.filter(o => o.kind === 'wo').length, 0)
  const pos = a.totals.orders - wos

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        {/* The six figures the whole screen adds up to. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Ordered (with GST)" value={a.totals.gross} />
          <Kpi label="Billed" value={a.totals.billed} />
          <Kpi label="Paid (money out)" value={a.totals.paid} />
          <Kpi label="Due now" value={a.totals.due} tone={a.totals.due > 0 ? 'amber' : undefined} />
          <Kpi label="Retention held" value={a.totals.retention} />
          <Kpi label="Advances outstanding" value={a.totals.advanceOutstanding} />
        </div>
        <p className="text-[12px] text-gray-500 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {wos} work order{wos === 1 ? '' : 's'} and {pos} purchase order{pos === 1 ? '' : 's'} — the same figures as the WO/PO tree, regrouped.
            {a.in4 === 'live' ? ' Order values live from IN4.' : ' IN4 was not reached; header figures are from the mirror.'}
            {a.withoutHeader > 0 && ` ${a.withoutHeader} order${a.withoutHeader === 1 ? '' : 's'} IN4 returned no header for ${a.withoutHeader === 1 ? 'is' : 'are'} left out.`}
            {' '}Due = certified in IN4 and not yet paid. Paid counts TDS as paid.
          </span>
        </p>

        <Section
          id="due"
          title="Due now"
          summary={`${a.due.length} order${a.due.length === 1 ? '' : 's'} · ${formatINR(a.totals.due)}`}
          empty="Nothing certified is waiting to be paid."
          count={a.due.length}
        >
          <OrderTable orders={a.due} cols={[['Billed', o => o.billed], ['Paid', o => o.paid], ['Due', o => o.due]]} strong="Due" />
        </Section>

        <Section
          id="rnb"
          title="Received, not yet billed"
          summary={`${a.receivedNotBilled.length} PO${a.receivedNotBilled.length === 1 ? '' : 's'} · ${formatINR(a.receivedNotBilled.reduce((s, r) => s + r.gap, 0))}`}
          empty="Every delivery received has a supplier bill against it."
          count={a.receivedNotBilled.length}
          hint="Material received (GRN, landed value) for which IN4 holds no supplier bill yet — the bill is still to come, or was booked under another PO's number."
        >
          <OrderTable
            orders={a.receivedNotBilled.map(r => r.order)}
            cols={[['Received', o => o.received ?? 0], ['Billed', o => o.billed], ['Not billed', o => (o.received ?? 0) - o.billed]]}
            strong="Not billed"
          />
        </Section>

        <Section
          id="held"
          title="Held back"
          summary={`Retention ${formatINR(a.totals.retention)} on ${a.retention.length} · advances ${formatINR(a.totals.advanceOutstanding)} on ${a.advances.length}`}
          empty="No retention held and no advance outstanding."
          count={a.retention.length + a.advances.length}
          hint="Retention is released at the end of the work. An advance outstanding is recovered from the party's next bills."
        >
          <OrderTable
            orders={dedupe([...a.retention, ...a.advances]).sort((x, y) => (y.retention + y.advanceOutstanding) - (x.retention + x.advanceOutstanding))}
            cols={[['Ordered', o => o.gross], ['Retention', o => o.retention], ['Advance o/s', o => o.advanceOutstanding]]}
          />
        </Section>

        <Section
          id="parties"
          title="By party"
          summary={`${a.parties.length} part${a.parties.length === 1 ? 'y' : 'ies'}`}
          empty="No orders on this project."
          count={a.parties.length}
        >
          <PartyTable parties={a.parties} />
        </Section>
      </div>
    </RowDetailProvider>
  )
}

function dedupe(orders: AccountsOrder[]): AccountsOrder[] {
  const seen = new Set<string>()
  return orders.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)))
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`text-[15px] font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{formatINR(value)}</p>
    </div>
  )
}

/** A section collapsed to its title and total; the chevron opens the rows.
 *  Same chevron as every tree in the app (RowDetailToggle). */
function Section({ id, title, summary, empty, count, hint, children }: {
  id: string; title: string; summary: string; empty: string; count: number; hint?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <RowDetailToggle id={`acc:${id}`} count={count} />
        <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
        <span className="ml-auto text-[12px] tabular-nums text-gray-700 text-right">{count > 0 ? summary : empty}</span>
      </div>
      {hint && <p className="px-3 py-1.5 text-[12px] text-gray-500 border-b border-gray-100">{hint}</p>}
      {count > 0 && <RowDetail id={`acc:${id}`}>{children}</RowDetail>}
    </section>
  )
}

type Col = [label: string, pick: (o: AccountsOrder) => number]

/** Orders with a chosen set of money columns — a table on md and up, cards
 *  below. Every row links to the order's live IN4 ledger and print. */
function OrderTable({ orders, cols, strong }: { orders: AccountsOrder[]; cols: Col[]; strong?: string }) {
  return (
    <>
      <table className="w-full text-[12px] hidden md:table">
        <thead className="text-left text-[12px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="px-3 py-1.5 border-b border-gray-100">Order</th>
            <th className="px-3 py-1.5 border-b border-gray-100">Party</th>
            {cols.map(([l]) => <th key={l} className="px-3 py-1.5 border-b border-gray-100 text-right">{l}</th>)}
            <th className="px-3 py-1.5 border-b border-gray-100" />
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-1.5">
                <span className="font-mono text-gray-800">{o.ref}</span>
                <span className="ml-2 text-gray-400">{o.category}</span>
                {o.flag && <span className="block text-amber-700">{o.flag}</span>}
              </td>
              <td className="px-3 py-1.5 text-gray-600">{o.party ?? <span className="italic text-gray-400">no party named</span>}</td>
              {cols.map(([l, pick]) => (
                <td key={l} className={`px-3 py-1.5 text-right tabular-nums ${l === strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{formatINR(pick(o))}</td>
              ))}
              <td className="px-3 py-1.5 text-right whitespace-nowrap"><Docs o={o} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden divide-y divide-gray-100">
        {orders.map(o => (
          <li key={o.id} className="px-3 py-2 text-[12px]">
            <p className="flex items-center justify-between gap-2">
              <span className="font-mono text-gray-800">{o.ref}</span>
              <Docs o={o} />
            </p>
            <p className="text-gray-500">{o.party ?? 'no party named'} · {o.category}</p>
            {o.flag && <p className="text-amber-700">{o.flag}</p>}
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
              {cols.map(([l, pick]) => (
                <span key={l} className={l === strong ? 'font-semibold text-gray-900' : 'text-gray-700'}>
                  <span className="text-gray-400">{l} </span>{formatINR(pick(o))}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Party rows, each opening to its orders. */
function PartyTable({ parties }: { parties: PartyAccount[] }) {
  const cols: Col[] = [['Ordered', o => o.gross], ['Billed', o => o.billed], ['Paid', o => o.paid], ['Due', o => o.due], ['Retention', o => o.retention], ['Advance o/s', o => o.advanceOutstanding]]
  return (
    <div className="divide-y divide-gray-100">
      {parties.map(p => (
        <div key={p.name}>
          <div className="flex items-center gap-1 px-3 py-1.5 text-[12px]">
            <RowDetailToggle id={`acc:party:${p.name}`} count={p.orders.length} />
            <span className="font-medium text-gray-900 truncate">{p.name}</span>
            <span className="text-gray-400 flex-shrink-0">{p.kind === 'both' ? 'WO + PO' : p.kind === 'wo' ? 'WO' : 'PO'} · {p.orders.length}</span>
            <span className="ml-auto hidden md:flex gap-4 tabular-nums text-gray-700 flex-shrink-0">
              <span>Ordered <b className="text-gray-900">{formatINR(p.gross)}</b></span>
              <span>Paid <b className="text-gray-900">{formatINR(p.paid)}</b></span>
              <span>Due <b className={p.due > 0.5 ? 'text-amber-700' : 'text-gray-900'}>{formatINR(p.due)}</b></span>
              {p.retention > 0.5 && <span>Retention <b className="text-gray-900">{formatINR(p.retention)}</b></span>}
              {p.advanceOutstanding > 0.5 && <span>Adv. o/s <b className="text-gray-900">{formatINR(p.advanceOutstanding)}</b></span>}
            </span>
          </div>
          <p className="md:hidden px-3 pb-1.5 -mt-0.5 text-[12px] tabular-nums text-gray-700 flex flex-wrap gap-x-3">
            <span><span className="text-gray-400">Ordered </span>{formatINR(p.gross)}</span>
            <span><span className="text-gray-400">Paid </span>{formatINR(p.paid)}</span>
            <span className={p.due > 0.5 ? 'text-amber-700' : ''}><span className="text-gray-400">Due </span>{formatINR(p.due)}</span>
            {p.retention > 0.5 && <span><span className="text-gray-400">Retention </span>{formatINR(p.retention)}</span>}
            {p.advanceOutstanding > 0.5 && <span><span className="text-gray-400">Adv. o/s </span>{formatINR(p.advanceOutstanding)}</span>}
          </p>
          <RowDetail id={`acc:party:${p.name}`}>
            <div className="bg-slate-50/60 border-t border-gray-100">
              <OrderTable orders={p.orders} cols={cols} strong="Due" />
            </div>
          </RowDetail>
        </div>
      ))}
    </div>
  )
}

/** The order's two live IN4 documents. */
function Docs({ o }: { o: AccountsOrder }) {
  if (o.in4Id == null) return null
  const base = o.kind === 'wo' ? `/api/in4/work-order/${o.in4Id}` : `/api/in4/purchase-order/${o.in4Id}`
  const cls = 'inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline max-md:min-h-[44px] max-md:px-1'
  return (
    <span className="inline-flex items-center gap-3">
      <a href={`${base}/ledger`} target="_blank" rel="noopener" className={cls} title={`Ledger for ${o.ref}, live from IN4`}><FileText className="h-3 w-3" /> Ledger</a>
      <a href={`${base}/print`} target="_blank" rel="noopener" className={cls} title={`Open ${o.ref} in IN4's own format`}><FileText className="h-3 w-3" /> Print</a>
    </span>
  )
}
