'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { formatINR } from '@/lib/utils'

export interface ReportBillLite {
  id: string
  section: 'paid' | 'trust'
  vendor: string
  area: string               // task-list name = the "Project" — trust-map key
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
  bills, initialEntries, initialTrustMap, asOf,
}: {
  bills: ReportBillLite[]
  initialEntries: Record<string, TrustdeskEntry>
  initialTrustMap: Record<string, string>
  asOf: string
}) {
  const [entries, setEntries] = useState<Record<string, TrustdeskEntry>>(initialEntries)
  const [trustMap, setTrustMap] = useState<Record<string, string>>(initialTrustMap)

  function entryOf(id: string): TrustdeskEntry {
    return entries[id] ?? { submission_date: null, courier_date: null, remark: null, is_adjust_advance: false }
  }

  async function save(id: string, patch: Partial<TrustdeskEntry>) {
    setEntries(prev => ({ ...prev, [id]: { ...entryOf(id), ...patch } }))
    await fetch('/api/bills-pipeline/trustdesk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId: id, ...patch }),
    }).catch(() => { /* keep local optimistic value; next save retries */ })
  }

  async function saveTrust(area: string, trust: string) {
    setTrustMap(prev => {
      const next = { ...prev }
      if (trust) next[area] = trust; else delete next[area]
      return next
    })
    await fetch('/api/bills-pipeline/trust-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area, trust }),
    }).catch(() => { /* keep local optimistic value */ })
  }

  const acctOf = (b: ReportBillLite) => (trustMap[b.area] || '').toUpperCase()

  // Every project (task-list) that has an at-Trust bill needs a trust set.
  const trustProjects = useMemo(() => {
    const s = new Set<string>()
    for (const b of bills) if (b.section === 'trust' && b.area) s.add(b.area)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [bills])
  const unassigned = trustProjects.filter(p => !trustMap[p])

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
      return [...m.entries()].sort((x, y) => {
        const ix = ACCOUNTS.indexOf(x[0]); const iy = ACCOUNTS.indexOf(y[0])
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)   // '—' unassigned sinks to the end
      })
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
  }, [bills, entries, trustMap])

  const inputCls = 'w-full rounded border border-gray-200 px-1.5 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none'

  function AcctBadge({ a }: { a: string }) {
    if (a === '—') return <span className="inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border bg-rose-50 text-rose-600 border-rose-200">Trust not set</span>
    return <span className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border ${ACCT_TONE[a] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>Submitted to {a} A/c</span>
  }

  return (
    <div className="space-y-5">
      {/* Project → Trust map */}
      <TrustMapCard projects={trustProjects} trustMap={trustMap} saveTrust={saveTrust} unassignedCount={unassigned.length} />

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

      {/* COP Under Process — per trust */}
      <SectionGroup title="COP Under Process" groups={copByAcct} entryOf={entryOf} save={save} AcctBadge={AcctBadge} inputCls={inputCls} />

      {/* Adjust Against Advance — per trust */}
      {adjByAcct.length > 0 && (
        <SectionGroup title="Adjust Against Advance" groups={adjByAcct} entryOf={entryOf} save={save} AcctBadge={AcctBadge} inputCls={inputCls} />
      )}

      <p className="text-xs text-gray-400">Saving updates instantly. Set each project&apos;s trust once at the top — every bill of that project files under it. Dates &amp; remarks per bill feed the report; tick <b>Adj</b> to move a bill into Adjust-against-advance. Snapshot as on {fmtDate(asOf)} — hit Refresh on the main Bills Pipeline page to re-pull from Zoho.</p>
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

function TrustMapCard({
  projects, trustMap, saveTrust, unassignedCount,
}: {
  projects: string[]
  trustMap: Record<string, string>
  saveTrust: (area: string, trust: string) => void
  unassignedCount: number
}) {
  const [open, setOpen] = useState(unassignedCount > 0)
  if (projects.length === 0) return null
  return (
    <section className={`rounded-xl border overflow-hidden ${unassignedCount > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left">
        <h2 className="text-sm font-bold text-gray-800">🏦 Trust account per project</h2>
        <span className="flex items-center gap-2">
          {unassignedCount > 0
            ? <span className="text-xs font-semibold text-amber-700">{unassignedCount} to set</span>
            : <span className="text-xs text-gray-400">all set</span>}
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 space-y-1.5">
          <p className="text-xs text-gray-500 mb-2">Pick which trust pays each project — every submitted bill of that project files under it. New projects show up here to be set.</p>
          {projects.map(p => {
            const t = trustMap[p] || ''
            return (
              <div key={p} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 ${t ? 'bg-gray-50' : 'bg-amber-100/60'}`}>
                <span className="text-xs text-gray-800 truncate">{p}</span>
                <select
                  className={`shrink-0 rounded border px-2 py-1 text-xs bg-white focus:outline-none ${t ? 'border-gray-200' : 'border-amber-400 text-amber-800'}`}
                  value={t}
                  onChange={e => saveTrust(p, e.target.value)}
                >
                  <option value="">— pick trust —</option>
                  {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SectionGroup({
  title, groups, entryOf, save, AcctBadge, inputCls,
}: {
  title: string
  groups: Array<[string, ReportBillLite[]]>
  entryOf: (id: string) => TrustdeskEntry
  save: (id: string, patch: Partial<TrustdeskEntry>) => void
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
          {acct === '—' && (
            <div className="px-4 py-1.5 text-[11px] text-rose-600 bg-rose-50/60 border-b border-rose-100">Set these projects&apos; trust in the card above to file them under SRET / SRAH / SRASSK.</div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-xs">
              <thead className="text-gray-500 bg-white"><tr>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium w-28">Submission ✎</th>
                <th className="text-left px-3 py-2 font-medium w-28">Courier ✎</th>
                <th className="text-left px-3 py-2 font-medium w-12">Due</th>
                <th className="text-left px-3 py-2 font-medium w-48">Remark ✎</th>
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
