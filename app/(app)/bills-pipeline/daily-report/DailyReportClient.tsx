'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { formatINR } from '@/lib/utils'

export interface ReportBillLite {
  id: string
  section: 'paid' | 'trust'
  account: string            // auto-derived from IN4 ref
  vendor: string
  area: string
  projectCode: string
  invoiceNo: string
  amount: number
  billDate: string
  paymentDate: string
}
export interface TrustdeskEntry {
  submission_date: string | null
  courier_date: string | null
  remark: string | null
  account: string | null     // override
  is_adjust_advance: boolean
}

const REMARK_OPTIONS = [
  'Cheque Received',
  'Under A/c -Process',
  'Online Payment',
  'Adjust Against Advance',
  'Adjust Against Advance (By Purchase Dep.)',
  'Hold Amount Release',
]
const ACCOUNTS = ['SRET', 'SRAH', 'SRASSK', 'SRA']
const ACCT_TONE: Record<string, string> = {
  SRET: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  SRAH: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  SRASSK: 'bg-pink-50 text-pink-700 border-pink-200',
  SRA: 'bg-amber-50 text-amber-700 border-amber-200',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/\//g, '-')
}
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

export function DailyReportClient({
  bills, initialEntries, asOf,
}: {
  bills: ReportBillLite[]
  initialEntries: Record<string, TrustdeskEntry>
  asOf: string
}) {
  const [entries, setEntries] = useState<Record<string, TrustdeskEntry>>(initialEntries)

  function entryOf(id: string): TrustdeskEntry {
    return entries[id] ?? { submission_date: null, courier_date: null, remark: null, account: null, is_adjust_advance: false }
  }

  async function save(id: string, patch: Partial<TrustdeskEntry>) {
    setEntries(prev => ({ ...prev, [id]: { ...entryOf(id), ...patch } }))
    await fetch('/api/bills-pipeline/trustdesk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId: id, ...patch }),
    }).catch(() => { /* keep local optimistic value; next save retries */ })
  }

  const acctOf = (b: ReportBillLite) => (entryOf(b.id).account || b.account || '').toUpperCase()

  const { paid, copByAcct, adjByAcct, totals } = useMemo(() => {
    const paid = bills.filter(b => b.section === 'paid').sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''))
    const trust = bills.filter(b => b.section === 'trust')
    const cop = trust.filter(b => !entryOf(b.id).is_adjust_advance)
    const adj = trust.filter(b => entryOf(b.id).is_adjust_advance)
    const group = (arr: ReportBillLite[]) => {
      const m = new Map<string, ReportBillLite[]>()
      for (const b of arr) {
        const a = acctOf(b) || '—'
        const g = m.get(a) ?? []; g.push(b); m.set(a, g)
      }
      return [...m.entries()].sort((x, y) => ACCOUNTS.indexOf(x[0]) - ACCOUNTS.indexOf(y[0]))
    }
    const copByAcct = group(cop)
    const adjByAcct = group(adj)
    const totals = {
      paidValue: paid.reduce((s, b) => s + b.amount, 0),
      trustValue: cop.reduce((s, b) => s + b.amount, 0),
      trustCount: cop.length,
      adjValue: adj.reduce((s, b) => s + b.amount, 0),
      adjCount: adj.length,
    }
    return { paid, copByAcct, adjByAcct, totals }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, entries])

  const inputCls = 'w-full rounded border border-gray-200 px-1.5 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none'

  function AcctBadge({ a }: { a: string }) {
    return <span className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border ${ACCT_TONE[a] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>Submitted to {a} A/c</span>
  }

  return (
    <div className="space-y-5">
      {/* Payments Done */}
      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-800">💸 Payments Done <span className="font-normal text-gray-500">(status: Payment Done)</span></h2>
          <span className="text-xs text-gray-500 tabular-nums">{paid.length} · {formatINR(totals.paidValue)}</span>
        </div>
        {paid.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400 italic">No payment done recently</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-xs">
              <thead className="text-gray-500 bg-white"><tr>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Paid on</th>
                <th className="text-left px-3 py-2 font-medium w-52">Remark ✎</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {paid.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums">{fmtDate(b.paymentDate)}</td>
                    <td className="px-3 py-1.5">
                      <RemarkSelect value={entryOf(b.id).remark} onChange={v => save(b.id, { remark: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* COP Under Process — per account */}
      <SectionGroup title="COP Under Process" groups={copByAcct} entryOf={entryOf} save={save} acctOf={acctOf} AcctBadge={AcctBadge} inputCls={inputCls} />

      {/* Adjust Against Advance — per account */}
      {adjByAcct.length > 0 && (
        <SectionGroup title="Adjust Against Advance" groups={adjByAcct} entryOf={entryOf} save={save} acctOf={acctOf} AcctBadge={AcctBadge} inputCls={inputCls} />
      )}

      <p className="text-xs text-gray-400">Saving updates instantly. Account, dates and remarks below feed the report; tick <b>Adjust-advance</b> to move a bill into that section. Snapshot as on {fmtDate(asOf)} — hit Refresh on the main Bills Pipeline page to re-pull from Zoho.</p>
    </div>
  )

  function RemarkSelect({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
    const custom = value && !REMARK_OPTIONS.includes(value)
    return (
      <select className={inputCls} value={custom ? '__custom' : (value ?? '')} onChange={e => onChange(e.target.value === '__custom' ? (value ?? '') : e.target.value)}>
        <option value="">— pick —</option>
        {REMARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        {custom && <option value="__custom">{value}</option>}
      </select>
    )
  }
}

function SectionGroup({
  title, groups, entryOf, save, acctOf, AcctBadge, inputCls,
}: {
  title: string
  groups: Array<[string, ReportBillLite[]]>
  entryOf: (id: string) => TrustdeskEntry
  save: (id: string, patch: Partial<TrustdeskEntry>) => void
  acctOf: (b: ReportBillLite) => string
  AcctBadge: (props: { a: string }) => ReactNode
  inputCls: string
}) {
  return (
    <>
      {groups.map(([acct, rows]) => (
        <section key={`${title}-${acct}`} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-gray-800 inline-flex items-center gap-2">{title} <AcctBadge a={acct} /></h2>
            <span className="text-xs text-gray-500 tabular-nums">{rows.length} · {formatINR(rows.reduce((s, b) => s + b.amount, 0))}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[880px] w-full text-xs">
              <thead className="text-gray-500 bg-white"><tr>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium w-28">Submission ✎</th>
                <th className="text-left px-3 py-2 font-medium w-28">Courier ✎</th>
                <th className="text-left px-3 py-2 font-medium w-12">Due</th>
                <th className="text-left px-3 py-2 font-medium w-48">Remark ✎</th>
                <th className="text-left px-3 py-2 font-medium w-20">Account ✎</th>
                <th className="text-center px-3 py-2 font-medium w-14">Adj</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(b => {
                  const e = entryOf(b.id)
                  const due = daysSince(e.submission_date ?? e.courier_date)
                  return (
                    <tr key={b.id} className="hover:bg-gray-50/60">
                      <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                      <td className="px-3 py-1.5"><input type="date" className={inputCls} value={toDateInput(e.submission_date)} onChange={ev => save(b.id, { submission_date: ev.target.value || null })} /></td>
                      <td className="px-3 py-1.5"><input type="date" className={inputCls} value={toDateInput(e.courier_date)} onChange={ev => save(b.id, { courier_date: ev.target.value || null })} /></td>
                      <td className="px-3 py-1.5 tabular-nums text-gray-600">{due == null ? '—' : `${due}d`}</td>
                      <td className="px-3 py-1.5">
                        <select className={inputCls} value={REMARK_OPTIONS.includes(e.remark ?? '') ? (e.remark ?? '') : (e.remark ? '__c' : '')} onChange={ev => save(b.id, { remark: ev.target.value === '__c' ? e.remark : ev.target.value })}>
                          <option value="">— pick —</option>
                          {REMARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                          {e.remark && !REMARK_OPTIONS.includes(e.remark) && <option value="__c">{e.remark}</option>}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <select className={inputCls} value={acctOf(b)} onChange={ev => save(b.id, { account: ev.target.value || null })}>
                          <option value="">{b.account ? `auto (${b.account})` : '— set —'}</option>
                          {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={e.is_adjust_advance} onChange={ev => save(b.id, { is_adjust_advance: ev.target.checked })} className="h-4 w-4 accent-amber-600" title="Mark as Adjust-against-advance" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}
