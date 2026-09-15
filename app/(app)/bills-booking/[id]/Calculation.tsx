import { Card } from '@/components/ui/card'
import { Calculator, PackageCheck, Receipt, Ruler, Wallet } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import type { BillCalc } from '@/lib/bills-booking/load-calc'
import type { BillLadder } from '@/lib/bills-booking/calc'
import type { AbstractSheet } from '@/lib/bills-booking/abstract'
import type { GrnSheet, AdvancePosition } from '@/lib/bills-booking/purchase'
import { formatNumber } from '@/lib/utils'
import { Particular } from './Particular'

/** How this bill adds up, and every bill already raised on the same order.
 *
 *  Aksha, 14 Sep 2026: "Live Example should also carry the Calculation and Live
 *  Bills". Both halves are read out of the IN4 mirror — nothing here is typed
 *  and nothing is assumed. Where a figure is an expectation rather than a
 *  certified fact, it says so on the panel rather than in a footnote. */
export function Calculation({ calc, showIn4Sheet = true }: {
  calc: BillCalc
  /** False when CT Hub has its own sheet for this bill — the Abstract maker
   *  above is then the abstract, and showing IN4's read-back underneath it was
   *  two panels of the same thing with the same title. */
  showIn4Sheet?: boolean
}) {
  const { history, mine, mineCert, expected, sheet } = calc
  const ladder = mine ?? expected
  // "work order" is wrong on a vendor bill, and an approver reading the wrong
  // noun on an approval screen stops trusting the rest of it.
  const noun = calc.kind === 'WO' ? 'work order' : 'purchase order'
  // A work order's bills are a running account: RA-1, RA-2. A supplier's are
  // not — IN4 numbers them as certificates — so they are counted, not renamed.
  const seq = (n: number) => (calc.kind === 'WO' ? `RA-${n}` : `Bill ${n}`)
  // IN4 mirrors a supplier certificate's status as a bare code (15, 6, 8, 2)
  // with no name table behind it. A column of em dashes reads as broken, and
  // inventing words for those codes would be worse, so it is not shown.
  const showStatus = history.rows.some(r => r.status)

  return (
    <>
      {ladder && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
              <Calculator className="h-3.5 w-3.5" /> How this bill adds up
            </p>
            {mine
              ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                  certified in IN4 · {mineCert?.displayNo ?? ''}
                </span>
              : <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800">
                  expected — not certified yet
                </span>}
          </div>

          {!mine && (
            <p className="mb-3 text-xs text-gray-500">
              No certificate exists in IN4 for this bill yet, so this is what the claim works out to using the tax
              and retention <b>this {noun} has actually carried</b> — not a house rate. The real figures replace
              it the moment Billing keys the certificate.
            </p>
          )}

          <Ladder l={ladder} />

          {mine && !ladder.reconciles && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>The parts do not add up to what IN4 shows.</b> This ladder makes it {formatINR(ladder.stillOwed)};
              IN4 says {formatINR(ladder.in4Outstanding)} is outstanding — a difference
              of {formatINR(Math.abs(ladder.outBy))}. Usually an adjustment or a hold release, which IN4 settles
              differently. Both figures are shown rather than one being picked.
            </p>
          )}
        </Card>
      )}

      {calc.advance && <Advance a={calc.advance} />}

      {sheet && showIn4Sheet && <Sheet s={sheet} />}

      {/* A purchase order is not measured against a BOQ — the supplier's
          certificate is raised on what was received. So this stands where the
          abstract stands, and answers the same three questions. */}
      {calc.grn && <Received s={calc.grn} />}

      <Card className="p-4">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
          <Receipt className="h-3.5 w-3.5" /> Bills on {calc.orderNo}
        </p>
        <p className="mb-3 text-xs text-gray-500">
          Every bill raised against this {noun}, live from IN4 — newest first. {history.deadCount > 0 && (
            <>{history.deadCount} cancelled {history.deadCount === 1 ? 'bill is' : 'bills are'} shown greyed and counted nowhere.</>
          )}
        </p>

        <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-4">
          <Tile k="Ordered" v={formatINR(history.ordered)} />
          <Tile k="Billed" v={formatINR(history.billedGross)} s={`${history.rows.filter(r => !r.dead).length} bills`} />
          <Tile k="Left to bill" v={formatINR(history.leftToBill)} strong />
          <Tile k="Retention held" v={formatINR(history.retentionHeld)} />
        </div>

        {history.rows.length === 0 ? (
          <p className="rounded-lg border border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
            Nothing has been billed on this order yet — this would be the first.
          </p>
        ) : (
          <>
            {/* Phone */}
            <div className="space-y-2 md:hidden">
              {history.rows.map(r => (
                <div key={r.certificateId}
                     className={`rounded-lg border p-3 ${r.dead ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] font-semibold">{r.displayNo || r.invoiceNo || '—'}</div>
                      <div className="text-[11px] text-gray-500">
                        {r.dead ? r.status : seq(r.ra)} · {r.on ? formatDate(r.on) : '—'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums">{formatINR(r.gross)}</div>
                      <div className="text-[10.5px] text-gray-400">incl. GST</div>
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3 text-[11px]">
                    <Pair k="Retention" v={formatINR(r.retention)} />
                    <Pair k="Paid" v={formatINR(r.paid)} />
                    <Pair k="Left after" v={formatINR(r.leftToBill)} />
                  </dl>
                </div>
              ))}
            </div>

            {/* Desktop */}
            <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <Th>Bill</Th><Th>Raised</Th><Th right>Basic</Th><Th right>Gross</Th>
                    <Th right>Retention</Th><Th right>Paid</Th><Th right>Left after</Th>{showStatus && <Th>Status</Th>}
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map(r => (
                    <tr key={r.certificateId}
                        className={`border-b border-gray-100 last:border-0 ${r.dead ? 'text-gray-400 line-through' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[11px]">{r.displayNo || r.invoiceNo || '—'}</span>
                        <span className="block text-[10.5px] text-gray-400">{r.dead ? '—' : seq(r.ra)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.on ? formatDate(r.on) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.certified)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(r.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.retention)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatINR(r.leftToBill)}</td>
                      {showStatus && <td className="px-3 py-2 text-xs">{r.status ?? '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  )
}

function Ladder({ l }: { l: BillLadder }) {
  return (
    <dl className="divide-y divide-gray-100">
      {l.steps.map((s, i) => (
        <div key={`${s.label}-${i}`}
             className={`flex items-baseline justify-between gap-3 py-2 ${s.total ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
          <dt className={s.deduct ? 'pl-4 text-sm' : 'text-sm'}>
            {s.deduct && <span className="mr-1 text-gray-400">less</span>}
            {s.label}
            {s.note && <span className="block text-[11px] font-normal text-gray-400">{s.note}</span>}
          </dt>
          <dd className={`shrink-0 tabular-nums ${s.total ? 'text-base' : 'text-sm'} ${s.deduct ? 'text-rose-700' : ''}`}>
            {s.deduct ? '− ' : ''}{formatINR(s.amount)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Tile({ k, v, s, strong }: { k: string; v: string; s?: string; strong?: boolean }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? 'text-base font-bold text-gray-900' : 'text-sm font-medium'}`}>{v}</div>
      {s && <div className="text-[10.5px] text-gray-400">{s}</div>}
    </div>
  )
}
function Pair({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-gray-500">{k}</dt><dd className="tabular-nums text-gray-800">{v}</dd></div>
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

/** The abstract sheet — the measurement this bill is built from.
 *
 *  Aksha asked where it was, and it was nowhere. This is it: every BOQ item
 *  measured on this bill, what was ordered against it, what has been measured
 *  in total, and what is left. The thing a Disc Head actually checks. */
function Sheet({ s }: { s: AbstractSheet }) {
  const qty = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 2)
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
          <Ruler className="h-3.5 w-3.5" /> Abstract sheet — as IN4 holds it
        </p>
        <span className="font-mono text-[10.5px] text-gray-500">
          {s.abstractNo ?? '—'}{s.on ? ` · ${formatDate(s.on)}` : ''}
        </span>
      </div>

      <p className="mb-3 text-xs text-gray-500">
        The measurement behind this bill — {s.rows.length} {s.rows.length === 1 ? 'item' : 'items'} from the work
        order&apos;s BOQ. <b>This bill</b> is what was measured now; <b>to date</b> is everything measured on that
        item including this bill; <b>balance</b> is what is still to do.
      </p>

      {/* Phone */}
      <div className="space-y-2 md:hidden">
        {s.rows.map(r => (
          <div key={r.itemId} className={`rounded-lg border p-3 ${r.overrun ? 'border-rose-200 bg-rose-50/40' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1"><Particular text={r.item} /></span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(r.thisAmt)}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              {qty(r.thisQty)} {r.uom} @ {formatINR(r.rate)}
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-x-3 text-[11px]">
              <Pair k="Ordered" v={`${qty(r.orderedQty)} ${r.uom ?? ''}`} />
              <Pair k="To date" v={`${qty(r.cumulativeQty)} ${r.uom ?? ''}`} />
              <Pair k="Balance" v={r.complete ? 'complete' : `${qty(r.balanceQty)} ${r.uom ?? ''}`} />
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <Th>Item</Th><Th>Unit</Th><Th right>Ordered</Th><Th right>Rate</Th>
              <Th right>This bill</Th><Th right>Amount</Th><Th right>To date</Th><Th right>Balance</Th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map(r => (
              <tr key={r.itemId} className={`border-b border-gray-100 last:border-0 ${r.overrun ? 'bg-rose-50/40' : 'hover:bg-gray-50'}`}>
                <td className="max-w-[300px] px-3 py-2 align-top"><Particular text={r.item} /></td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.uom ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{qty(r.orderedQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatINR(r.rate)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{qty(r.thisQty)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(r.thisAmt)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{qty(r.cumulativeQty)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${
                  r.overrun ? 'font-semibold text-rose-700' : r.complete ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {r.overrun ? `over by ${qty(Math.abs(r.balanceQty))}` : r.complete ? 'complete' : qty(r.balanceQty)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>{s.rows.length} {s.rows.length === 1 ? 'item' : 'items'} measured</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatINR(s.thisBill)}</td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {s.rows.some(r => r.overrun) && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Some lines are measured past the quantity ordered. That needs an amendment in IN4 before payment — it does
          not stop the bill being checked.
        </p>
      )}

      <p className="mt-3 text-xs text-gray-500">
        {s.reconciles
          ? <>These lines add up to {formatINR(s.thisBill)}, which is what IN4 certified for this bill.</>
          : <><b className="text-amber-800">The lines do not add up to the certified figure.</b> They total {formatINR(s.thisBill)};
              IN4 certified {formatINR(s.certified)} — a difference of {formatINR(Math.abs(s.outBy))}. Worth asking about
              before this is approved.</>}
      </p>
    </Card>
  )
}
/** The advance on this order, and how much of it has been worked off.
 *
 *  Aksha, 15 Sep 2026: "Advance are done as per terms." It is a contractual
 *  position, not noise — and without it a bill whose payable collapses to
 *  nothing reads as a mistake instead of a recovery. 215 purchase orders carry
 *  one, ₹9.9 Cr between them, of which ₹8.48 Cr has already come back. */
function Advance({ a }: { a: AdvancePosition }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
          <Wallet className="h-3.5 w-3.5" /> Advance on this order
        </p>
        <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${
          a.settled
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {a.settled ? 'fully recovered' : `${formatINR(a.outstanding)} still to recover`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-4">
        <Tile k="Advance taken" v={formatINR(a.taken)} s={a.count === 1 ? 'one certificate' : `${a.count} certificates`} />
        <Tile k="Paid out" v={formatINR(a.paid)} />
        <Tile k="Recovered so far" v={formatINR(a.recovered)} s="across every bill" />
        <Tile k="Still to recover" v={formatINR(a.outstanding)} strong />
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {a.thisBill > 0
          ? <>This bill takes back <b className="text-gray-800">{formatINR(a.thisBill)}</b> of it — the deduction in
             the ladder above. An advance is paid on the order&apos;s own terms and recovered out of the bills that
             follow, so it is never counted as billed against the order.</>
          : <>Nothing is recovered on this bill. An advance is paid on the order&apos;s own terms and recovered out of
             the bills that follow, so it is never counted as billed against the order.</>}
      </p>
    </Card>
  )
}

/** What arrived, and what this bill is therefore for.
 *
 *  Aksha, 15 Sep 2026: "Supplier Certificate is raised - pls check post GRN -
 *  so instead of Abstract PO follows GRN." This is the purchase side's abstract
 *  sheet, and it holds up better than the contractor side's: the lines of a
 *  bill sum to that bill's landed cost on all 1,376 supplier certificates.
 *
 *  Quantities come from the goods receipt, money from IN4's own pay line, and
 *  what was ordered from the purchase order — so it answers the same three
 *  questions the abstract does: this bill, received to date, still to come. */
function Received({ s }: { s: GrnSheet }) {
  const qty = (n: number) => formatNumber(n, n % 1 === 0 ? 0 : 2)
  // Where IN4's bill line and its receipt line disagree on quantity, the
  // receipt's own figure is context, never the bill's share.
  const show = (r: { thisQty: number | null; receiptQty: number | null; uom: string | null }) =>
    r.thisQty != null ? `${qty(r.thisQty)} ${r.uom ?? ''}`.trim()
      : r.receiptQty != null ? `part of ${qty(r.receiptQty)} ${r.uom ?? ''}`.trim()
        : 'not stated'
  const challans = s.grns.map(g => g.challan).filter(Boolean)

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
          <PackageCheck className="h-3.5 w-3.5" /> Goods received — what this bill is for
        </p>
        <span className="text-right font-mono text-[10.5px] text-gray-500">
          {s.grns.length === 0
            ? '—'
            : s.grns.map(g => `${g.no ?? 'GRN'}${g.on ? ` · ${formatDate(g.on)}` : ''}`).join('  ·  ')}
        </span>
      </div>

      <p className="mb-3 text-xs text-gray-500">
        A purchase order is measured by what arrived, not by a measurement sheet — IN4 raises the supplier&apos;s
        certificate against the goods receipt. {s.rows.length} {s.rows.length === 1 ? 'material' : 'materials'} on
        this bill. <b>This bill</b> is what came in now; <b>received</b> is everything received against that material
        so far; <b>balance</b> is what is still to come.
        {challans.length > 0 && <> Challan {challans.join(', ')}.</>}
      </p>

      {/* Phone */}
      <div className="space-y-2 md:hidden">
        {s.rows.map((r, i) => (
          <div key={r.materialId ?? `x${i}`}
               className={`rounded-lg border p-3 ${r.overrun ? 'border-rose-200 bg-rose-50/40' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-[13px]">{r.material}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatINR(r.thisAmt)}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              {show(r)}{r.rate > 0 ? ` @ ${formatINR(r.rate)}` : ''}
              {r.offOrder && <span className="ml-1 text-amber-700">· not on the order</span>}
            </div>
            {!r.offOrder && (
              <dl className="mt-2 grid grid-cols-3 gap-x-3 text-[11px]">
                <Pair k="Ordered" v={`${qty(r.orderedQty)} ${r.uom ?? ''}`} />
                <Pair k="Received" v={`${qty(r.receivedQty)} ${r.uom ?? ''}`} />
                <Pair k="Balance" v={r.complete ? 'complete' : `${qty(r.balanceQty)} ${r.uom ?? ''}`} />
              </dl>
            )}
          </div>
        ))}
      </div>

      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <Th>Material</Th><Th>Unit</Th><Th right>Ordered</Th><Th right>Rate</Th>
              <Th right>This bill</Th><Th right>Amount</Th><Th right>Received</Th><Th right>Balance</Th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={r.materialId ?? `x${i}`}
                  className={`border-b border-gray-100 last:border-0 ${r.overrun ? 'bg-rose-50/40' : 'hover:bg-gray-50'}`}>
                <td className="max-w-[300px] px-3 py-2 align-top text-[13px]">
                  {r.material}
                  {r.offOrder && <span className="block text-[10.5px] text-amber-700">not on the purchase order</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.uom ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.offOrder ? '—' : qty(r.orderedQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.rate > 0 ? formatINR(r.rate) : '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {r.thisQty != null ? qty(r.thisQty)
                    : <span className="text-gray-400">{r.receiptQty != null ? `part of ${qty(r.receiptQty)}` : 'not stated'}</span>}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(r.thisAmt)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.offOrder ? '—' : qty(r.receivedQty)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${
                  r.overrun ? 'font-semibold text-rose-700' : r.complete ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {r.offOrder ? '—'
                    : r.overrun ? `over by ${qty(Math.abs(r.balanceQty))}`
                      : r.complete ? 'complete' : qty(r.balanceQty)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>{s.rows.length} {s.rows.length === 1 ? 'material' : 'materials'} received</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatINR(s.thisBill)}</td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {s.anyOverrun && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          More has been received than was ordered on some lines. That needs an amendment in IN4 before payment — it
          does not stop the bill being checked.
        </p>
      )}

      <p className="mt-3 text-xs text-gray-500">
        {s.reconciles
          ? <>These lines add up to {formatINR(s.thisBill)}, which is what IN4 bills for this certificate.</>
          : <><b className="text-amber-800">The lines do not add up to the bill.</b> They total {formatINR(s.thisBill)};
              IN4 bills {formatINR(s.landed)} — a difference of {formatINR(Math.abs(s.outBy))}. Worth asking about
              before this is approved.</>}
      </p>
    </Card>
  )
}
