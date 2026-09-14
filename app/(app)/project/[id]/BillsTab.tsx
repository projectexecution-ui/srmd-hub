import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ReceiptText, ExternalLink } from 'lucide-react'
import { loadProjectBills } from '@/lib/bills-booking/project'
import { stageDef, type BbStage } from '@/lib/bills-booking/stages'
import { SCOPE_NOTE } from '@/lib/bills-booking/scope'
import { formatINR, formatINRCompact, formatDate } from '@/lib/utils'
import { CardList, Card as MCard, CardTotal } from '../../bills-booking/Cards'
import { StagePill } from '../../bills-booking/StagePill'

/** Bills Approval, narrowed to one project.
 *
 *  A PILOT — NGH B and an admin, gated in lib/revamp/tabs.ts and enforced again
 *  on the route, so it is not one typed URL wide. Aksha, 14 Sep 2026: the
 *  module is new to everyone and he wants to work it through internally on one
 *  real building before anyone else sees it. NGH B is a fair test: 29 work
 *  orders, 57 certificates, two Atm Heads already named in Cost Control.
 *
 *  Four pills, which are the four questions somebody standing in a project
 *  actually asks — and every figure comes from the same builders the org-level
 *  screens use, so the two can never disagree.
 */
export async function BillsTab({ projectId, view = 0 }: { projectId: string; view?: number }) {
  const sb = await createClient()
  const d = await loadProjectBills(sb, projectId)

  if (!d.subprojectIds.length) {
    return (
      <EmptyState
        icon={<ReceiptText className="h-8 w-8" />}
        title="No IN4 sub-project maps here yet"
        description="Bills are carried on IN4 sub-projects. Point one at this project on Where bills book and everything below fills in."
      />
    )
  }

  const { inFlight, waiting, orders, entered } = d
  const balance = Math.max(0, orders.ordered - orders.billed)

  return (
    <div className="space-y-4">
      {/* Always on, whichever pill: the four numbers that answer "where does
          this project stand" without a click. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-4">
        <Stat k="Money waiting" v={formatINRCompact(waiting.outstanding)} s={`${waiting.bills} bills open`} />
        <Stat k="In flight" v={formatINRCompact(inFlight.totals.outstanding)} s={`${inFlight.totals.bills} still moving`} />
        <Stat k="Left to bill" v={formatINRCompact(balance)} s={`on ${orders.count} work orders`} />
        <Stat k="Retention held" v={formatINRCompact(orders.retentionHeld)} s="deducted, not returned" />
      </div>

      {view === 0 && <InFlightPill d={d} />}
      {view === 1 && <WaitingPill d={d} />}
      {view === 2 && <EnteredPill entered={entered} />}
      {view === 3 && <RetentionPill orders={orders} />}

      <p className="text-xs text-gray-500">
        Read from the IN4 mirror for {d.subprojectNames.join(', ') || 'this project'}. Cancelled and reversed
        certificates are excluded. {SCOPE_NOTE}{' '}
        <Link href="/bills-booking" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          The whole section <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
    </div>
  )
}

function InFlightPill({ d }: { d: Awaited<ReturnType<typeof loadProjectBills>> }) {
  const { rows, haveTrail } = d.inFlight
  if (!rows.length) {
    return <Card className="p-6 text-center text-sm text-gray-500">Nothing on this project is at a live desk.</Card>
  }
  return (
    <>
      {!haveTrail && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          The approval trail has not synced, so <b>At desk</b> and <b>Last moved by</b> are blank.
        </p>
      )}

      <CardList>
        {rows.map(r => (
          <MCard key={r.certificateId} title={r.displayNo} sub={r.contractor}
                 amount={formatINR(r.outstanding)} amountLabel="payable"
                 flagged={r.atDesk != null && r.atDesk > 30}
                 facts={[
                   { k: 'With', v: r.desk },
                   { k: 'At desk', v: r.atDesk == null ? '—' : `${r.atDesk} d`, tone: r.atDesk != null && r.atDesk > 30 ? 'bad' : undefined },
                   { k: 'Work order', v: r.woNo ?? '—' },
                   { k: 'Last moved by', v: r.movedBy ?? '—' },
                 ]} />
        ))}
        <CardTotal n={d.inFlight.totals.bills} label="in flight" amount={formatINR(d.inFlight.totals.outstanding)} />
      </CardList>

      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <Th>Certificate</Th><Th>Contractor</Th><Th>Work order</Th>
              <Th right>Payable</Th><Th>With</Th><Th right>At desk</Th><Th>Last moved by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.certificateId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-[11px]">{r.displayNo}</td>
                <td className="px-3 py-2">{r.contractor}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{r.woNo ?? '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(r.outstanding)}</td>
                <td className="px-3 py-2 text-xs">{r.desk}<span className="block text-[10.5px] text-gray-400">{r.status}</span></td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.atDesk != null && r.atDesk > 30 ? 'font-semibold text-red-600' : 'text-gray-600'}`}>
                  {r.atDesk == null ? '—' : `${r.atDesk} d`}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{r.movedBy ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function WaitingPill({ d }: { d: Awaited<ReturnType<typeof loadProjectBills>> }) {
  return (
    <Card className="p-4">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Fact k="Still owed" v={formatINR(d.waiting.outstanding)} strong />
        <Fact k="Open bills" v={String(d.waiting.bills)} />
        <Fact k="Oldest" v={`${d.waiting.oldestDays} d`} />
        <Fact k="Ordered so far" v={formatINR(d.orders.ordered)} />
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        Every unpaid and part-paid certificate on this project, including part-paid ones — the same figure the
        org-level <Link href="/bills-booking/overview" className="text-blue-600 hover:underline">Money waiting</Link> screen
        rolls into its project row.
      </p>
    </Card>
  )
}

function EnteredPill({ entered }: { entered: Array<{ id: string; vendor: string; billNo: string | null; stage: string; amount: number; billDate: string | null; woNo: string | null }> }) {
  if (!entered.length) {
    return (
      <Card className="p-6 text-center text-sm text-gray-500">
        No bill has been entered in CT Hub against this project yet.{' '}
        <Link href="/bills-booking/new" className="font-semibold text-indigo-700 hover:underline">Enter one</Link>.
      </Card>
    )
  }
  return (
    <>
      <CardList>
        {entered.map(b => (
          <MCard key={b.id} title={b.vendor} sub={<>Bill {b.billNo || '—'}{b.woNo ? ` · ${b.woNo}` : ''}</>}
                 amount={formatINR(b.amount)}
                 facts={[
                   { k: 'Stage', v: stageDef(b.stage as BbStage).label },
                   { k: 'Bill date', v: b.billDate ? formatDate(b.billDate) : '—' },
                 ]}
                 action={<Link href={`/bills-booking/${b.id}`} className="text-xs font-semibold text-indigo-700 hover:underline">Open the bill →</Link>} />
        ))}
        <CardTotal n={entered.length} label="entered here" amount={formatINR(entered.reduce((s, b) => s + b.amount, 0))} />
      </CardList>

      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <Th>Vendor</Th><Th>Bill no</Th><Th>Order</Th><Th right>Amount</Th><Th>Bill date</Th><Th>Stage</Th>
            </tr>
          </thead>
          <tbody>
            {entered.map(b => (
              <tr key={b.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/bills-booking/${b.id}`} className="font-medium text-indigo-700 hover:underline">{b.vendor}</Link>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">{b.billNo || '—'}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{b.woNo || '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(b.amount)}</td>
                <td className="px-3 py-2 text-xs">{b.billDate ? formatDate(b.billDate) : '—'}</td>
                <td className="px-3 py-2"><StagePill stage={b.stage as BbStage} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function RetentionPill({ orders }: { orders: { count: number; ordered: number; billed: number; retentionHeld: number } }) {
  const pct = orders.billed > 0 ? Math.round((orders.retentionHeld / orders.billed) * 1000) / 10 : null
  return (
    <Card className="p-4">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Fact k="Held back" v={formatINR(orders.retentionHeld)} strong />
        <Fact k="Billed so far" v={formatINR(orders.billed)} />
        <Fact k="Effective rate" v={pct == null ? 'no bills yet' : `${pct}%`} />
        <Fact k="Work orders" v={String(orders.count)} />
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        Retention is per work order, not a house rule — some carry 5%, some none, and the rate above is what IN4
        has actually deducted rather than what anybody assumes. Releasing it is a Retention certificate in IN4, and
        closing the work order is what triggers it. Tracking only: nothing here blocks a bill.
      </p>
    </Card>
  )
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
      <div className="mt-0.5 text-xl font-medium tabular-nums">{v}</div>
      <div className="text-[11px] text-gray-500">{s}</div>
    </div>
  )
}
function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{k}</dt>
      <dd className={`mt-0.5 tabular-nums ${strong ? 'text-base font-bold text-gray-900' : 'text-gray-800'}`}>{v}</dd>
    </div>
  )
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}
