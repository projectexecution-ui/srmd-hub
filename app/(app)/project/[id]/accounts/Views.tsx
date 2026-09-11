// Accounts tab, pills 0–4: Payments · FY-wise · Month-wise · Reconcile with
// Trust · Party ledgers. Server components over lib/accounts; the fifth pill
// (Due & held) is the original AccountsTab body.

import Link from 'next/link'
import { Download, AlertTriangle, Info } from 'lucide-react'
import { cn, formatINR, formatDate, todayIST } from '@/lib/utils'
import type { AccountsLoad } from '@/lib/accounts/load'
import { fyOf, rollupByFy, rollupByMonth, buildPartyLedger, tallyBalance, type Payment } from '@/lib/accounts/payments'
import { ReconcileClient, type OpenItem } from './ReconcileClient'

export interface ViewParams { raw: boolean; fy: string | null; party: string | null }

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const href = (projectId: string, view: number, p: Partial<ViewParams>, base: ViewParams) => {
  const q = new URLSearchParams({ view: String(view) })
  const raw = p.raw ?? base.raw, fy = p.fy === undefined ? base.fy : p.fy, party = p.party === undefined ? base.party : p.party
  if (raw) q.set('raw', '1'); if (fy) q.set('fy', fy); if (party) q.set('party', party)
  return `/project/${projectId}/accounts?${q.toString()}`
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={cn('text-[15px] font-semibold tabular-nums', tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900')}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}
function Chip({ href: h, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return <Link href={h} className={cn('rounded-full border px-3 py-1 text-[12.5px] min-h-[32px] inline-flex items-center', on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500')}>{children}</Link>
}
function DateCell({ p }: { p: Payment }) {
  if (!p.date) return <span className="text-amber-700 text-[12px]">no date in IN4</span>
  return (
    <span className="whitespace-nowrap">
      <span className={p.bankDate ? 'text-gray-900' : 'text-gray-500'}>{formatDate(p.date)}</span>
      <span className={cn('ml-1.5 text-[10px] uppercase tracking-wide rounded px-1 py-0.5', p.bankDate ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>{p.bankDate ? 'bank' : 'bill'}</span>
    </span>
  )
}
function RawToggle({ projectId, view, params, dupCount, cancelled = 0 }: { projectId: string; view: number; params: ViewParams; dupCount: number; cancelled?: number }) {
  const bits = [cancelled > 0 ? `${cancelled} cancelled in IN4` : null, dupCount > 0 ? `${dupCount} bill${dupCount === 1 ? '' : 's'} listed twice` : null].filter(Boolean)
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-gray-600">
      {bits.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700" title="Left out of the true figures; the raw view shows them"><AlertTriangle className="h-3.5 w-3.5" />{bits.join(' · ')}</span>}
      <Link href={href(projectId, view, { raw: !params.raw }, params)} className={cn('rounded-full border px-2.5 py-1 min-h-[30px] inline-flex items-center', params.raw ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-gray-300 bg-white hover:border-gray-500')}>
        {params.raw ? 'Showing IN4 as-is — back to true figures' : 'Show IN4 as-is'}
      </Link>
    </span>
  )
}
function ExportLinks({ projectId, what, params }: { projectId: string; what: 'payments' | 'ledger'; params: ViewParams }) {
  const q = new URLSearchParams({ what })
  if (params.fy) q.set('fy', params.fy); if (params.party) q.set('party', params.party); if (params.raw) q.set('raw', '1')
  const cls = 'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold min-h-[32px] hover:bg-gray-50'
  return (
    <span className="inline-flex gap-1.5">
      <a href={`/api/accounts/${projectId}/export?${q}&format=xlsx`} className={cls}><Download className="h-3.5 w-3.5" /> Excel</a>
      <a href={`/api/accounts/${projectId}/export?${q}&format=pdf`} className={cls}><Download className="h-3.5 w-3.5" /> PDF</a>
    </span>
  )
}

/* ── 0 · Payments ─────────────────────────────────────────────────────────── */

export function PaymentsView({ projectId, acc, params }: { projectId: string; acc: AccountsLoad; params: ViewParams }) {
  const t = acc.book.totals
  const fys = [...new Set(acc.book.payments.map(p => fyOf(p.date)).filter(Boolean) as string[])].sort().reverse()
  const rows = params.fy ? acc.book.payments.filter(p => fyOf(p.date) === params.fy) : acc.book.payments
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Paid to contractors" value={formatINR(t.contractorPaid)} />
        <Kpi label="Paid to suppliers" value={formatINR(t.supplierPaid)} sub={t.undatedPaid > 0 ? `${formatINR(t.undatedPaid)} has no date in IN4` : undefined} />
        <Kpi label="Confirmed by Trust" value={formatINR(t.confirmedPaid)} sub="bank date known" tone="ok" />
        <Kpi label="Awaiting Trust" value={formatINR(t.awaitingPaid)} sub="shown on bill date" tone={t.awaitingPaid > 0 ? 'warn' : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={href(projectId, 0, { fy: null }, params)} on={!params.fy}>All years</Chip>
        {fys.map(f => <Chip key={f} href={href(projectId, 0, { fy: f }, params)} on={params.fy === f}>{f}</Chip>)}
        <span className="ml-auto flex flex-wrap items-center gap-2"><RawToggle projectId={projectId} view={0} params={params} dupCount={acc.book.duplicates.length} cancelled={acc.book.cancelled} /><ExportLinks projectId={projectId} what="payments" params={params} /></span>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[860px]">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Paid to</th><th className="px-3 py-2">Against</th><th className="px-3 py-2">Bill / certificate</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Retention</th><th className="px-3 py-2 text-right">Paid</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {rows.map(p => (
                <tr key={p.id} className={cn((p.duplicateOf || p.cancelled) && 'bg-amber-50/60')}>
                  <td className="px-3 py-2"><DateCell p={p} /></td>
                  <td className="px-3 py-2 text-gray-900">{p.party}</td>
                  <td className="px-3 py-2 text-gray-600"><span className="font-mono text-[12px]">{p.against ?? '—'}</span><span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{p.kind}</span>{p.cancelled && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-rose-700">cancelled in IN4</span>}{p.duplicateOf && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-700">listed twice in IN4</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{p.billNo ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatINR(p.gross)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatINR(p.deductions)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatINR(p.retention)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatINR(p.paid)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No payments here.</td></tr>}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold tabular-nums">
              <tr><td className="px-3 py-2" colSpan={4}>{rows.length} payments</td><td className="px-3 py-2 text-right">{formatINR(rows.reduce((s, p) => s + p.gross, 0))}</td><td className="px-3 py-2 text-right">{formatINR(rows.reduce((s, p) => s + p.deductions, 0))}</td><td className="px-3 py-2 text-right">{formatINR(rows.reduce((s, p) => s + p.retention, 0))}</td><td className="px-3 py-2 text-right">{formatINR(rows.reduce((s, p) => s + p.paid, 0))}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-gray-500 flex items-start gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /><span>Deductions = TDS and other cuts plus advance and debit-note recoveries. <b>bank</b> = the Trust confirmed this payment and its bank date is shown; <b>bill</b> = IN4’s bill or certificate date until then. True figures leave out certificates IN4 has cancelled and show a bill IN4 lists twice once; “Show IN4 as-is” shows every row.</span></p>
    </div>
  )
}

/* ── 1 · FY-wise ──────────────────────────────────────────────────────────── */

export function FyView({ projectId, acc, params }: { projectId: string; acc: AccountsLoad; params: ViewParams }) {
  const rows = rollupByFy(acc.book.payments)
  const max = Math.max(1, ...rows.filter(r => r.fy).map(r => r.paid))
  const total = rows.reduce((s, r) => s + r.paid, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><span className="text-[12px] text-gray-500">Indian financial year, April to March. A payment sits in the year of its bank date once confirmed, else of its bill date.</span><span className="ml-auto"><RawToggle projectId={projectId} view={1} params={params} dupCount={acc.book.duplicates.length} /></span></div>
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Financial year</th><th className="px-3 py-2 w-[40%]">Share</th><th className="px-3 py-2 text-right">Payments</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Confirmed by Trust</th></tr></thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">
            {rows.map(r => (
              <tr key={r.fy ?? 'none'}>
                <td className="px-3 py-2">{r.fy ? <Link href={href(projectId, 2, { fy: r.fy }, params)} className="text-indigo-700 hover:underline font-medium">{r.fy}</Link> : <span className="text-amber-700">Date unknown</span>}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><span className={cn('inline-block h-2 rounded', r.fy ? 'bg-teal-700' : 'bg-gray-300')} style={{ width: `${Math.max(2, Math.round((r.paid / max) * 200))}px` }} />{total > 0 && <span className="text-[12px] text-gray-500">{Math.round((r.paid / total) * 100)}%</span>}</span></td>
                <td className="px-3 py-2 text-right text-gray-700">{r.count}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatINR(r.paid)}</td>
                <td className="px-3 py-2 text-right text-emerald-700">{r.confirmedPaid ? formatINR(r.confirmedPaid) : <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold tabular-nums"><tr><td className="px-3 py-2">Total paid</td><td></td><td className="px-3 py-2 text-right">{rows.reduce((s, r) => s + r.count, 0)}</td><td className="px-3 py-2 text-right">{formatINR(total)}</td><td className="px-3 py-2 text-right text-emerald-700">{formatINR(rows.reduce((s, r) => s + r.confirmedPaid, 0))}</td></tr></tfoot>
        </table>
      </div>
      <p className="text-[12px] text-gray-500">Tap a year for its months.</p>
    </div>
  )
}

/* ── 2 · Month-wise ───────────────────────────────────────────────────────── */

export function MonthView({ projectId, acc, params }: { projectId: string; acc: AccountsLoad; params: ViewParams }) {
  const fys = [...new Set(acc.book.payments.map(p => fyOf(p.date)).filter(Boolean) as string[])].sort().reverse()
  const fy = params.fy && fys.includes(params.fy) ? params.fy : (fys[0] ?? null)
  if (!fy) return <p className="text-[13px] text-gray-400 py-8 text-center">No dated payments yet.</p>
  const rows = rollupByMonth(acc.book.payments, fy)
  const max = Math.max(1, ...rows.map(r => r.paid))
  const thisMonth = todayIST().slice(0, 7)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {fys.map(f => <Chip key={f} href={href(projectId, 2, { fy: f }, params)} on={fy === f}>{f}</Chip>)}
        <span className="ml-auto flex items-center gap-2"><RawToggle projectId={projectId} view={2} params={params} dupCount={acc.book.duplicates.length} /><ExportLinks projectId={projectId} what="payments" params={{ ...params, fy }} /></span>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5 items-end h-40">
          {rows.map((r, i) => {
            const future = r.month > thisMonth
            return (
              <div key={r.month} className="flex flex-col items-center justify-end h-full gap-1">
                <span className="text-[11px] tabular-nums font-medium text-gray-700">{r.paid ? formatINR(r.paid).replace('₹', '') : future ? '' : '0'}</span>
                <span className={cn('block w-3/4 rounded-t', future ? 'border border-dashed border-gray-300' : r.paid ? 'bg-teal-700' : 'bg-gray-200')} style={{ height: `${future ? 10 : Math.max(2, Math.round((r.paid / max) * 100))}%` }} />
                <span className="text-[10px] text-gray-500 font-mono">{MONTHS[i]}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Payments</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Running total, FY {fy}</th></tr></thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">
            {rows.filter(r => r.month <= thisMonth).map((r, i) => (
              <tr key={r.month}><td className="px-3 py-2 text-gray-900">{MONTHS[i]} {r.month.slice(0, 4)}</td><td className="px-3 py-2 text-right text-gray-700">{r.count}</td><td className="px-3 py-2 text-right font-semibold text-gray-900">{formatINR(r.paid)}</td><td className="px-3 py-2 text-right text-gray-700">{formatINR(r.running)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── 3 · Reconcile ────────────────────────────────────────────────────────── */

export function ReconcileView({ projectId, acc }: { projectId: string; acc: AccountsLoad }) {
  const fys = [...new Set(acc.book.payments.map(p => fyOf(p.date)).filter(Boolean) as string[])].sort().reverse()
  const confirmed = acc.book.payments.filter(p => p.bankDate)
  const open: OpenItem[] = acc.book.payments
    .filter(p => p.confirmation && p.confirmation.status !== 'confirmed')
    .map(p => ({ id: p.id, date: p.date, party: p.party, against: p.against, billNo: p.billNo, paid: p.paid, status: p.confirmation!.status as OpenItem['status'], amountInBooks: p.confirmation!.amount_in_books, bankDate: p.confirmation!.bank_date, bankRef: p.confirmation!.bank_ref, remark: p.confirmation!.remark }))
    .sort((a, b) => (a.status === 'explained' ? 1 : 0) - (b.status === 'explained' ? 1 : 0) || b.paid - a.paid)
  return (
    <ReconcileClient
      projectId={projectId} fys={fys} lastStatement={acc.statements[0] ?? null}
      totals={{ paid: acc.book.totals.paid, confirmedPaid: acc.book.totals.confirmedPaid, awaitingPaid: acc.book.totals.awaitingPaid, count: acc.book.totals.count, confirmedCount: confirmed.length, awaitingCount: acc.book.totals.count - confirmed.length }}
      open={open}
    />
  )
}

/* ── 4 · Party ledgers ────────────────────────────────────────────────────── */

export function LedgerView({ projectId, acc, params }: { projectId: string; acc: AccountsLoad; params: ViewParams }) {
  const parties = [...new Map(acc.book.bills.map(b => [b.party, (acc.book.bills.filter(x => x.party === b.party).reduce((s, x) => s + x.gross, 0))])).entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const party = params.party && parties.includes(params.party) ? params.party : (parties[0] ?? null)
  if (!party) return <p className="text-[13px] text-gray-400 py-8 text-center">No bills on this project yet.</p>
  const fys = [...new Set(acc.book.bills.filter(b => b.party === party).map(b => fyOf(b.date)).filter(Boolean) as string[])].sort().reverse()
  const fy = params.fy && fys.includes(params.fy) ? params.fy : null
  const ledger = buildPartyLedger(acc.book.bills, party, fy, acc.book.duplicates.filter(d => d.kept.party === party).length)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[12px] text-gray-500">Party</label>
        <form action={`/project/${projectId}/accounts`} method="get" className="inline-flex items-center gap-1.5">
          <input type="hidden" name="view" value="4" />{params.raw && <input type="hidden" name="raw" value="1" />}{fy && <input type="hidden" name="fy" value={fy} />}
          <select name="party" defaultValue={party} className="h-9 max-w-[280px] rounded-lg border border-gray-300 bg-white px-2 text-[13px]">
            {parties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold min-h-[36px] hover:bg-gray-50">Open</button>
        </form>
        <Chip href={href(projectId, 4, { fy: null, party }, params)} on={!fy}>All years</Chip>
        {fys.map(f => <Chip key={f} href={href(projectId, 4, { fy: f, party }, params)} on={fy === f}>{f}</Chip>)}
        <span className="ml-auto flex items-center gap-2"><RawToggle projectId={projectId} view={4} params={{ ...params, party }} dupCount={ledger.duplicatesFolded} /><ExportLinks projectId={projectId} what="ledger" params={{ ...params, party, fy }} /></span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Bills" value={formatINR(ledger.totals.bills)} sub={fy ? `FY ${fy}` : 'all years'} />
        <Kpi label="Paid" value={formatINR(ledger.totals.paid)} />
        <Kpi label="Retention held" value={formatINR(ledger.totals.retention)} />
        <Kpi label="Closing balance" value={tallyBalance(ledger.closing)} sub={ledger.closing > 0 ? 'payable to party' : ledger.closing < 0 ? 'party owes (advance)' : 'settled'} tone={ledger.closing > 0 ? 'warn' : undefined} />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap items-baseline gap-x-3"><h3 className="text-[14px] font-semibold text-gray-900">{party}</h3><span className="text-[12px] text-gray-500">Ledger account{fy ? ` · FY ${fy}` : ' · all years'} · Tally layout</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[820px]">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Particulars</th><th className="px-3 py-2">Vch Type</th><th className="px-3 py-2">Vch No.</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              <tr className="bg-gray-50/70 italic text-gray-600"><td className="px-3 py-2">{fy ? formatDate(`${fy.slice(0, 4)}-04-01`) : ''}</td><td className="px-3 py-2" colSpan={5}>Opening Balance</td><td className="px-3 py-2 text-right">{tallyBalance(ledger.opening)}</td></tr>
              {ledger.lines.map((l, i) => (
                <tr key={`${l.paymentId}-${i}`}>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{l.date ? formatDate(l.date) : <span className="text-amber-700">no date</span>}{l.bankDated && <span className="ml-1 text-[10px] uppercase text-emerald-700">bank</span>}</td>
                  <td className="px-3 py-2 text-gray-900">{l.particulars}</td>
                  <td className="px-3 py-2 text-gray-600">{l.vchType}</td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-[12px]">{l.vchNo}</td>
                  <td className="px-3 py-2 text-right text-gray-900">{l.debit ? formatINR(l.debit) : ''}</td>
                  <td className="px-3 py-2 text-right text-teal-800">{l.credit ? formatINR(l.credit) : ''}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{tallyBalance(l.balance)}</td>
                </tr>
              ))}
              {ledger.lines.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No entries in this period.</td></tr>}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold tabular-nums">
              <tr><td className="px-3 py-2" colSpan={4}>Current Total</td><td className="px-3 py-2 text-right">{formatINR(ledger.totals.debit)}</td><td className="px-3 py-2 text-right text-teal-800">{formatINR(ledger.totals.credit)}</td><td></td></tr>
              <tr><td className="px-3 py-2 italic" colSpan={6}>Closing Balance</td><td className="px-3 py-2 text-right">{tallyBalance(ledger.closing)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-gray-500 flex items-start gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /><span>The gross bill credits the party; retention, recoveries, TDS and the bank payment debit it. Vch No. is IN4’s invoice number, which ties to the paper bill. Cr = payable to the party, Dr = the party owes (an advance not yet absorbed).{ledger.duplicatesFolded > 0 && <> {ledger.duplicatesFolded} bill{ledger.duplicatesFolded === 1 ? '' : 's'} IN4 lists twice {ledger.duplicatesFolded === 1 ? 'is' : 'are'} shown once; use “Show IN4 as-is” to see both rows.</>}</span></p>
    </div>
  )
}
