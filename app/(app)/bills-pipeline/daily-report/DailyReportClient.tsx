'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { toPng } from 'html-to-image'
import { toast } from 'sonner'
import { formatINR } from '@/lib/utils'

export interface ReportBillLite {
  id: string
  section: 'paid' | 'trust'
  vendor: string
  area: string               // task-list name = the "Project", and the trust-map key
  projectCode: string
  invoiceNo: string
  amount: number
  billDate: string
  paymentDate: string
  submittedOn?: string       // moment it moved to Submitted-to-Trust (auto default for submission date)
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
const COURIER_ACCTS = new Set(['SRET'])   // courier date column shows only for these trusts
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
  bills, initialEntries, initialTrustMap, asOf, availableDates, selectedDate,
}: {
  bills: ReportBillLite[]
  initialEntries: Record<string, TrustdeskEntry>
  initialTrustMap: Record<string, string>
  asOf: string
  availableDates: string[]
  selectedDate: string
}) {
  const router = useRouter()
  const [entries, setEntries] = useState<Record<string, TrustdeskEntry>>(initialEntries)
  const [trustMap, setTrustMap] = useState<Record<string, string>>(initialTrustMap)
  const [q, setQ] = useState('')
  const [busyImg, setBusyImg] = useState<string | null>(null)

  const todayInput = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

  function entryOf(id: string): TrustdeskEntry {
    return entries[id] ?? { submission_date: null, courier_date: null, remark: null, is_adjust_advance: false }
  }
  // Submission/courier auto-default to the "submitted to trust" moment; editable.
  const effSub = (b: ReportBillLite) => entryOf(b.id).submission_date ?? toDateInput(b.submittedOn)
  const effCourier = (b: ReportBillLite) => entryOf(b.id).courier_date ?? toDateInput(b.submittedOn)

  async function save(id: string, patch: Partial<TrustdeskEntry>) {
    setEntries(prev => ({ ...prev, [id]: { ...entryOf(id), ...patch } }))
    await fetch('/api/bills-pipeline/trustdesk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId: id, ...patch }),
    }).catch(() => { /* keep optimistic value; next save retries */ })
  }

  async function saveTrust(area: string, trust: string) {
    setTrustMap(prev => { const next = { ...prev }; if (trust) next[area] = trust; else delete next[area]; return next })
    await fetch('/api/bills-pipeline/trust-map', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area, trust }),
    }).catch(() => {})
  }

  const acctOf = (b: ReportBillLite) => (trustMap[b.area] || '').toUpperCase()

  const trustProjects = useMemo(() => {
    const s = new Set<string>()
    for (const b of bills) if (b.section === 'trust' && b.area) s.add(b.area)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [bills])
  const unassigned = trustProjects.filter(p => !trustMap[p])

  const { paid, copByAcct, adjByAcct, totals } = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = (b: ReportBillLite) => !needle || `${b.vendor} ${b.area} ${b.invoiceNo}`.toLowerCase().includes(needle)
    const subKey = (b: ReportBillLite) => entryOf(b.id).submission_date ?? (b.submittedOn ?? '').slice(0, 10)
    const byDateDesc = (a: ReportBillLite, b: ReportBillLite) => subKey(b).localeCompare(subKey(a))

    const paid = bills.filter(b => b.section === 'paid' && hit(b)).sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''))
    const trust = bills.filter(b => b.section === 'trust' && hit(b))
    const cop = trust.filter(b => !entryOf(b.id).is_adjust_advance)
    const adj = trust.filter(b => entryOf(b.id).is_adjust_advance)
    const group = (arr: ReportBillLite[]) => {
      const m = new Map<string, ReportBillLite[]>()
      for (const b of arr) { const a = acctOf(b) || '—'; const g = m.get(a) ?? []; g.push(b); m.set(a, g) }
      for (const g of m.values()) g.sort(byDateDesc)   // dates descending (latest first)
      return [...m.entries()].sort((x, y) => {
        const ix = ACCOUNTS.indexOf(x[0]); const iy = ACCOUNTS.indexOf(y[0])
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
      })
    }
    const totals = {
      paidValue: paid.reduce((s, b) => s + b.amount, 0),
      trustValue: cop.reduce((s, b) => s + b.amount, 0),
      trustCount: cop.length,
      adjValue: adj.reduce((s, b) => s + b.amount, 0),
      adjCount: adj.length,
    }
    return { paid, copByAcct: group(cop), adjByAcct: group(adj), totals }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, entries, trustMap, q])

  const inputCls = 'w-full rounded border border-gray-200 px-1.5 py-1 text-xs bg-white focus:border-blue-400 focus:outline-none'

  async function copyImage(cleanId: string, label: string) {
    const node = document.getElementById(cleanId)
    if (!node) return
    setBusyImg(cleanId)
    try {
      const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true })
      const blob = await (await fetch(dataUrl)).blob()
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
      if (navigator.clipboard && CI) {
        await navigator.clipboard.write([new CI({ 'image/png': blob })])
        toast.success(`${label} copied — paste into WhatsApp`)
      } else {
        const a = document.createElement('a'); a.href = dataUrl; a.download = `${label}.png`; a.click()
        toast.message(`${label} saved — attach it in WhatsApp`)
      }
    } catch {
      try {
        const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const a = document.createElement('a'); a.href = dataUrl; a.download = `${label}.png`; a.click()
        toast.message(`${label} saved — attach it in WhatsApp`)
      } catch { toast.error('Could not create image') }
    } finally { setBusyImg(null) }
  }

  function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const chips = [
    { id: 'sec-paid', label: '💸 Paid', n: paid.length, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    ...copByAcct.map(([a, rows]) => ({ id: `sec-cop-${a}`, label: a === '—' ? 'COP · unset' : `COP ${a}`, n: rows.length, tone: a === '—' ? 'bg-rose-50 text-rose-600 border-rose-200' : (ACCT_TONE[a] ?? 'bg-gray-50 text-gray-600 border-gray-200') })),
    ...adjByAcct.map(([a, rows]) => ({ id: `sec-adj-${a}`, label: a === '—' ? 'Adj · unset' : `Adj ${a}`, n: rows.length, tone: 'bg-amber-50 text-amber-700 border-amber-200' })),
  ]
  const dateLabel = fmtDate(asOf || selectedDate)

  return (
    <div className="space-y-5">
      {/* Sticky toolbar: date look-back + search + jump chips */}
      <div className="sticky top-14 md:top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 bg-white/95 backdrop-blur border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
            📅
            <input
              type="date" value={selectedDate} max={todayInput}
              onChange={e => router.push(e.target.value ? `?date=${e.target.value}` : '?')}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white focus:border-blue-400 focus:outline-none"
              title="Look back at a past day's report"
            />
          </label>
          {selectedDate !== todayInput && (
            <button onClick={() => router.push('?')} className="text-xs text-blue-600 hover:underline shrink-0">latest</button>
          )}
          <div className="relative flex-1 min-w-[160px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search vendor / project / invoice…"
              className="w-full rounded-lg border border-gray-200 pl-8 pr-8 py-1.5 text-sm bg-white focus:border-blue-400 focus:outline-none"
            />
            {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm" aria-label="Clear">✕</button>}
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mb-0.5 pb-0.5">
          {chips.map(c => (
            <button key={c.id} onClick={() => jump(c.id)} className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${c.tone} hover:brightness-95`}>
              {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
            </button>
          ))}
        </div>
      </div>

      {q && (
        <p className="text-xs text-gray-500 -mt-2">Filtered by &ldquo;<b>{q}</b>&rdquo; — {paid.length + totals.trustCount + totals.adjCount} match{paid.length + totals.trustCount + totals.adjCount === 1 ? '' : 'es'}. <button onClick={() => setQ('')} className="text-blue-600 hover:underline">show all</button></p>
      )}

      {/* Project → Trust map */}
      <TrustMapCard projects={trustProjects} trustMap={trustMap} saveTrust={saveTrust} unassignedCount={unassigned.length} />

      {/* Payments Done */}
      <section id="sec-paid" className="scroll-mt-32 md:scroll-mt-20 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-800">💸 Payments Done <span className="font-normal text-gray-500">(paid today)</span></h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 tabular-nums">{paid.length} · {formatINR(totals.paidValue)}</span>
            <CopyBtn onClick={() => copyImage('clean-sec-paid', `Payments Done ${dateLabel}`)} busy={busyImg === 'clean-sec-paid'} disabled={paid.length === 0} />
          </div>
        </div>
        {paid.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400 italic">{q ? 'No matches' : 'No payments done today'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-xs">
              <thead className="text-gray-500 bg-white"><tr>
                <th className="text-left px-3 py-2 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Paid on</th>
                <th className="text-left px-3 py-2 font-medium w-52">Remark ✎</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {paid.map((b, i) => (
                  <tr key={b.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums">{fmtDate(b.paymentDate)}</td>
                    <td className="px-3 py-1.5"><RemarkSelect value={entryOf(b.id).remark} onChange={v => save(b.id, { remark: v })} inputCls={inputCls} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* COP Under Process — per trust */}
      {copByAcct.map(([acct, rows]) => (
        <TrustSection key={`cop-${acct}`} idPrefix="sec-cop" title="COP Under Process" acct={acct} rows={rows}
          entryOf={entryOf} save={save} effSub={effSub} effCourier={effCourier} inputCls={inputCls}
          onCopy={() => copyImage(`clean-sec-cop-${acct}`, `COP ${acct === '—' ? '' : acct} ${dateLabel}`)} busy={busyImg === `clean-sec-cop-${acct}`} />
      ))}

      {/* Adjust Against Advance — per trust */}
      {adjByAcct.map(([acct, rows]) => (
        <TrustSection key={`adj-${acct}`} idPrefix="sec-adj" title="Adjust Against Advance" acct={acct} rows={rows}
          entryOf={entryOf} save={save} effSub={effSub} effCourier={effCourier} inputCls={inputCls}
          onCopy={() => copyImage(`clean-sec-adj-${acct}`, `Adjust ${acct === '—' ? '' : acct} ${dateLabel}`)} busy={busyImg === `clean-sec-adj-${acct}`} />
      ))}

      <p className="text-xs text-gray-400">Set each project&apos;s trust once at the top. Submission date auto-fills from when the bill reached Trust — edit if needed. Courier date shows for SRET only. Tick <b>Adj</b> to move a bill to Adjust-against-advance. Use <b>📋 Copy image</b> on any trust to share a clean table on WhatsApp. Report for {dateLabel || 'today'} — hit Refresh on Bills Pipeline to re-pull from Zoho.</p>

      {/* ── Hidden clean tables used only for "Copy image" ── */}
      <div aria-hidden style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }}>
        <CleanTable id="clean-sec-paid" title="Payments Done" acct="" dateLabel={dateLabel} rows={paid} kind="paid" entryOf={entryOf} effSub={effSub} effCourier={effCourier} />
        {copByAcct.map(([acct, rows]) => (
          <CleanTable key={`c-cop-${acct}`} id={`clean-sec-cop-${acct}`} title="COP Under Process" acct={acct} dateLabel={dateLabel} rows={rows} kind="trust" entryOf={entryOf} effSub={effSub} effCourier={effCourier} />
        ))}
        {adjByAcct.map(([acct, rows]) => (
          <CleanTable key={`c-adj-${acct}`} id={`clean-sec-adj-${acct}`} title="Adjust Against Advance" acct={acct} dateLabel={dateLabel} rows={rows} kind="trust" entryOf={entryOf} effSub={effSub} effCourier={effCourier} />
        ))}
      </div>
    </div>
  )
}

function CopyBtn({ onClick, busy, disabled }: { onClick: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
      {busy ? '…' : '📋'} Copy image
    </button>
  )
}

function RemarkSelect({ value, onChange, inputCls }: { value: string | null; onChange: (v: string) => void; inputCls: string }) {
  const custom = value && !REMARK_OPTIONS.includes(value)
  return (
    <select className={inputCls} value={custom ? '__custom' : (value ?? '')} onChange={e => onChange(e.target.value === '__custom' ? (value ?? '') : e.target.value)}>
      <option value="">— pick —</option>
      {REMARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
      {custom && <option value="__custom">{value}</option>}
    </select>
  )
}

function TrustSection({
  idPrefix, title, acct, rows, entryOf, save, effSub, effCourier, inputCls, onCopy, busy,
}: {
  idPrefix: string
  title: string
  acct: string
  rows: ReportBillLite[]
  entryOf: (id: string) => TrustdeskEntry
  save: (id: string, patch: Partial<TrustdeskEntry>) => void
  effSub: (b: ReportBillLite) => string
  effCourier: (b: ReportBillLite) => string
  inputCls: string
  onCopy: () => void
  busy: boolean
}) {
  const showCourier = COURIER_ACCTS.has(acct)
  const total = rows.reduce((s, b) => s + b.amount, 0)
  const badge = acct === '—'
    ? <span className="inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border bg-rose-50 text-rose-600 border-rose-200">Trust not set</span>
    : <span className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border ${ACCT_TONE[acct] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>Submitted to {acct} A/c</span>
  return (
    <section id={`${idPrefix}-${acct}`} className="scroll-mt-32 md:scroll-mt-20 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-gray-800 inline-flex items-center gap-2">{title} {badge}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 tabular-nums">{rows.length} · {formatINR(total)}</span>
          <CopyBtn onClick={onCopy} busy={busy} disabled={acct === '—'} />
        </div>
      </div>
      {acct === '—' && (
        <div className="px-4 py-1.5 text-[11px] text-rose-600 bg-rose-50/60 border-b border-rose-100">Set these projects&apos; trust in the card above to file them under a trust.</div>
      )}
      <div className="overflow-x-auto">
        <table className={`${showCourier ? 'min-w-[860px]' : 'min-w-[760px]'} w-full text-xs`}>
          <thead className="text-gray-500 bg-white"><tr>
            <th className="text-left px-3 py-2 font-medium w-8">#</th>
            <th className="text-left px-3 py-2 font-medium">Vendor</th>
            <th className="text-left px-3 py-2 font-medium">Project</th>
            <th className="text-left px-3 py-2 font-medium">Invoice</th>
            <th className="text-right px-3 py-2 font-medium">Amount</th>
            <th className="text-left px-3 py-2 font-medium w-28">Submission ✎</th>
            {showCourier && <th className="text-left px-3 py-2 font-medium w-28">Courier ✎</th>}
            <th className="text-left px-3 py-2 font-medium w-12">Age</th>
            <th className="text-left px-3 py-2 font-medium w-48">Remark ✎</th>
            <th className="text-center px-3 py-2 font-medium w-14">Adj</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((b, i) => {
              const e = entryOf(b.id)
              const age = daysSince(effSub(b))
              return (
                <tr key={b.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                  <td className="px-3 py-1.5"><input type="date" className={inputCls} value={effSub(b)} onChange={ev => save(b.id, { submission_date: ev.target.value || null })} /></td>
                  {showCourier && <td className="px-3 py-1.5"><input type="date" className={inputCls} value={effCourier(b)} onChange={ev => save(b.id, { courier_date: ev.target.value || null })} /></td>}
                  <td className="px-3 py-1.5 tabular-nums text-gray-600">{age == null ? '—' : `${age}d`}</td>
                  <td className="px-3 py-1.5"><RemarkSelect value={e.remark} onChange={v => save(b.id, { remark: v })} inputCls={inputCls} /></td>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={e.is_adjust_advance} onChange={ev => save(b.id, { is_adjust_advance: ev.target.checked })} className="h-4 w-4 accent-amber-600" title="Move to Adjust-against-advance" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
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
          {unassignedCount > 0 ? <span className="text-xs font-semibold text-amber-700">{unassignedCount} to set</span> : <span className="text-xs text-gray-400">all set</span>}
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
                <select className={`shrink-0 rounded border px-2 py-1 text-xs bg-white focus:outline-none ${t ? 'border-gray-200' : 'border-amber-400 text-amber-800'}`} value={t} onChange={e => saveTrust(p, e.target.value)}>
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

// Clean, read-only table rendered off-screen and captured as a PNG for WhatsApp.
function CleanTable({
  id, title, acct, dateLabel, rows, kind, entryOf, effSub, effCourier,
}: {
  id: string
  title: string
  acct: string
  dateLabel: string
  rows: ReportBillLite[]
  kind: 'paid' | 'trust'
  entryOf: (id: string) => TrustdeskEntry
  effSub: (b: ReportBillLite) => string
  effCourier: (b: ReportBillLite) => string
}) {
  const showCourier = kind === 'trust' && COURIER_ACCTS.has(acct)
  const total = rows.reduce((s, b) => s + b.amount, 0)
  const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', fontWeight: 700 }
  const thR: CSSProperties = { ...th, textAlign: 'right' }
  const td: CSSProperties = { padding: '5px 8px', borderBottom: '1px solid #eef2f7' }
  const tdR: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }
  return (
    <div id={id} style={{ width: '820px', background: '#fff', padding: '18px 20px', fontFamily: 'Arial, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>
          {title}{acct && acct !== '—' ? <span style={{ color: '#475569' }}> — {acct} A/c</span> : ''}
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{dateLabel}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr style={{ background: '#f1f5f9' }}>
          <th style={{ ...th, width: 28 }}>#</th>
          <th style={th}>Party</th>
          <th style={th}>Project</th>
          <th style={th}>Invoice</th>
          <th style={thR}>Amount (₹)</th>
          {kind === 'trust' && <th style={th}>Submission</th>}
          {showCourier && <th style={th}>Courier</th>}
          {kind === 'paid' && <th style={th}>Paid on</th>}
          <th style={th}>Remark</th>
        </tr></thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={b.id} style={i % 2 ? { background: '#fafcff' } : undefined}>
              <td style={{ ...td, color: '#94a3b8' }}>{i + 1}</td>
              <td style={td}>{b.vendor || '—'}</td>
              <td style={{ ...td, color: '#475569' }}>{b.area}</td>
              <td style={{ ...td, color: '#475569' }}>{b.invoiceNo}</td>
              <td style={tdR}>{formatINR(b.amount)}</td>
              {kind === 'trust' && <td style={td}>{fmtDate(effSub(b))}</td>}
              {showCourier && <td style={td}>{fmtDate(effCourier(b))}</td>}
              {kind === 'paid' && <td style={td}>{fmtDate(b.paymentDate)}</td>}
              <td style={{ ...td, color: '#475569' }}>{entryOf(b.id).remark || ''}</td>
            </tr>
          ))}
          <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
            <td style={td} colSpan={4}>Total · {rows.length} bill{rows.length === 1 ? '' : 's'}</td>
            <td style={tdR}>{formatINR(total)}</td>
            <td style={td} colSpan={(kind === 'trust' ? 1 : 1) + (showCourier ? 1 : 0) + 1}></td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 10 }}>SRMD Construction · Daily Bills Report · auto-generated</div>
    </div>
  )
}
