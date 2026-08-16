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
  area: string
  projectCode: string
  invoiceNo: string
  amount: number
  billDate: string
  paymentDate: string
  submittedOn?: string       // moment it moved to Submitted-to-Trust (auto date default)
}
export interface TrustdeskEntry {
  submission_date: string | null
  courier_date: string | null
  remark: string | null
  is_adjust_advance: boolean
  highlight: string | null   // '' | 'red' | 'yellow'
}

const REMARK_OPTIONS = [
  'Cheque Received', 'Under A/c -Process', 'Online Payment',
  'Adjust Against Advance', 'Adjust Against Advance (By Purchase Dep.)', 'Hold Amount Release',
]
const ACCOUNTS = ['SRET', 'SRAH', 'SRASSK', 'SRA']
const COURIER_ACCTS = new Set(['SRET'])   // these trusts use a Courier date instead of Submission date
const ACCT_TONE: Record<string, string> = {
  SRET: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  SRAH: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  SRASSK: 'bg-violet-50 text-violet-700 border-violet-200',
  SRA: 'bg-sky-50 text-sky-700 border-sky-200',
}
const HL_ROW: Record<string, string> = { red: 'bg-red-50', yellow: 'bg-amber-50' }

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
  const [pdfBusy, setPdfBusy] = useState(false)

  const todayInput = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

  function entryOf(id: string): TrustdeskEntry {
    return entries[id] ?? { submission_date: null, courier_date: null, remark: null, is_adjust_advance: false, highlight: null }
  }
  const effSub = (b: ReportBillLite) => entryOf(b.id).submission_date ?? toDateInput(b.submittedOn)
  const effCourier = (b: ReportBillLite) => entryOf(b.id).courier_date ?? toDateInput(b.submittedOn)
  // The one date each trust cares about: SRET → courier, everyone else → submission.
  const effDate = (b: ReportBillLite, acct: string) => (COURIER_ACCTS.has(acct) ? effCourier(b) : effSub(b))

  async function save(id: string, patch: Partial<TrustdeskEntry>) {
    setEntries(prev => ({ ...prev, [id]: { ...entryOf(id), ...patch } }))
    await fetch('/api/bills-pipeline/trustdesk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billId: id, ...patch }),
    }).catch(() => {})
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
    const dateKey = (b: ReportBillLite, acct: string) => {
      const e = entryOf(b.id)
      const raw = (COURIER_ACCTS.has(acct) ? e.courier_date : e.submission_date) ?? (b.submittedOn ?? '').slice(0, 10)
      return raw
    }
    const paid = bills.filter(b => b.section === 'paid' && hit(b)).sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''))
    const trust = bills.filter(b => b.section === 'trust' && hit(b))
    const cop = trust.filter(b => !entryOf(b.id).is_adjust_advance)
    const adj = trust.filter(b => entryOf(b.id).is_adjust_advance)
    const group = (arr: ReportBillLite[]) => {
      const m = new Map<string, ReportBillLite[]>()
      for (const b of arr) { const a = acctOf(b) || '—'; const g = m.get(a) ?? []; g.push(b); m.set(a, g) }
      for (const [acct, g] of m) g.sort((a, b) => dateKey(b, acct).localeCompare(dateKey(a, acct)))   // date descending
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
  const dateLabel = fmtDate(asOf || selectedDate)

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

  async function downloadPdf() {
    setPdfBusy(true)
    try {
      const node = document.getElementById('clean-full')
      if (!node) throw new Error('report node missing')
      const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true })
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const im = new window.Image()
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
        im.onerror = rej
        im.src = dataUrl
      })
      const { default: JsPDF } = await import('jspdf')
      const pdfW = 595.28                       // A4 width (pt)
      const pdfH = (pdfW * dims.h) / dims.w      // ONE continuous page — never breaks
      const doc = new JsPDF({ unit: 'pt', format: [pdfW, pdfH] })
      doc.addImage(dataUrl, 'PNG', 0, 0, pdfW, pdfH)
      doc.save(`Daily Bills Report ${dateLabel || 'today'}.pdf`)
      toast.success('PDF ready')
    } catch {
      toast.error('Could not create PDF')
    } finally { setPdfBusy(false) }
  }

  function jump(id: string) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const chips = [
    { id: 'sec-paid', label: '💸 Paid', n: paid.length, tone: 'bg-slate-100 text-slate-700 border-slate-200' },
    ...copByAcct.map(([a, rows]) => ({ id: `sec-cop-${a}`, label: a === '—' ? 'COP · unset' : `COP ${a}`, n: rows.length, tone: ACCT_TONE[a] ?? 'bg-slate-100 text-slate-700 border-slate-200' })),
    ...adjByAcct.map(([a, rows]) => ({ id: `sec-adj-${a}`, label: a === '—' ? 'Adj · unset' : `Adj ${a}`, n: rows.length, tone: ACCT_TONE[a] ?? 'bg-slate-100 text-slate-700 border-slate-200' })),
  ]

  return (
    <div className="space-y-5">
      {/* Remark suggestions — used by every Remark input; typing a new one is allowed. */}
      <datalist id="bp-remark-options">
        {REMARK_OPTIONS.map(o => <option key={o} value={o} />)}
      </datalist>

      {/* Sticky toolbar: date look-back + PDF + search + jump chips */}
      <div className="sticky top-14 md:top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 bg-white/95 backdrop-blur border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
            📅
            <input type="date" value={selectedDate} max={todayInput}
              onChange={e => router.push(e.target.value ? `?date=${e.target.value}` : '?')}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white focus:border-blue-400 focus:outline-none"
              title="Look back at a past day's report" />
          </label>
          {selectedDate !== todayInput && (
            <button onClick={() => router.push('?')} className="text-xs text-blue-600 hover:underline shrink-0">latest</button>
          )}
          <button onClick={downloadPdf} disabled={pdfBusy}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 shrink-0">
            {pdfBusy ? '…' : '📄'} PDF (all)
          </button>
          <div className="relative flex-1 min-w-[150px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor / project / invoice…"
              className="w-full rounded-lg border border-gray-200 pl-8 pr-8 py-1.5 text-sm bg-white focus:border-blue-400 focus:outline-none" />
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
            <table className="min-w-[720px] w-full text-xs">
              <thead className="text-gray-500 bg-white"><tr>
                <th className="text-left px-3 py-2 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-left px-3 py-2 font-medium">Invoice</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Paid on</th>
                <th className="text-left px-3 py-2 font-medium w-48">Remark ✎</th>
                <th className="text-center px-3 py-2 font-medium w-14">Flag</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {paid.map((b, i) => {
                  const e = entryOf(b.id)
                  return (
                    <tr key={b.id} className={HL_ROW[e.highlight ?? ''] ?? 'hover:bg-gray-50/60'}>
                      <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                      <td className="px-3 py-1.5 text-gray-600 tabular-nums">{fmtDate(b.paymentDate)}</td>
                      <td className="px-3 py-1.5"><RemarkSelect value={e.remark} onChange={v => save(b.id, { remark: v })} inputCls={inputCls} /></td>
                      <td className="px-3 py-1.5"><HighlightDots value={e.highlight} onChange={h => save(b.id, { highlight: h })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {copByAcct.map(([acct, rows]) => (
        <TrustSection key={`cop-${acct}`} idPrefix="sec-cop" title="COP Under Process" acct={acct} rows={rows}
          entryOf={entryOf} save={save} effDate={effDate} inputCls={inputCls}
          onCopy={() => copyImage(`clean-sec-cop-${acct}`, `COP ${acct === '—' ? '' : acct} ${dateLabel}`)} busy={busyImg === `clean-sec-cop-${acct}`} />
      ))}

      {adjByAcct.map(([acct, rows]) => (
        <TrustSection key={`adj-${acct}`} idPrefix="sec-adj" title="Adjust Against Advance" acct={acct} rows={rows}
          entryOf={entryOf} save={save} effDate={effDate} inputCls={inputCls}
          onCopy={() => copyImage(`clean-sec-adj-${acct}`, `Adjust ${acct === '—' ? '' : acct} ${dateLabel}`)} busy={busyImg === `clean-sec-adj-${acct}`} />
      ))}

      <p className="text-xs text-gray-400">Set each project&apos;s trust once at the top. Date auto-fills from when the bill reached Trust (SRET shows Courier date, others Submission) — edit if needed. Tick <b>Adj</b> to move a bill to Adjust-against-advance; use <b>Flag</b> to mark a row red/yellow. Share a trust with <b>📋 Copy image</b>, or the whole day with <b>📄 PDF</b>. Report for {dateLabel || 'today'} — hit Refresh on Bills Pipeline to re-pull from Zoho.</p>

      {/* ── Hidden clean tables used only for "Copy image" ── */}
      <div aria-hidden style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }}>
        <CleanTable id="clean-sec-paid" title="Payments Done" acct="" dateLabel={dateLabel} rows={paid} kind="paid" entryOf={entryOf} effDate={effDate} />
        {copByAcct.map(([acct, rows]) => (
          <CleanTable key={`c-cop-${acct}`} id={`clean-sec-cop-${acct}`} title="COP Under Process" acct={acct} dateLabel={dateLabel} rows={rows} kind="trust" entryOf={entryOf} effDate={effDate} />
        ))}
        {adjByAcct.map(([acct, rows]) => (
          <CleanTable key={`c-adj-${acct}`} id={`clean-sec-adj-${acct}`} title="Adjust Against Advance" acct={acct} dateLabel={dateLabel} rows={rows} kind="trust" entryOf={entryOf} effDate={effDate} />
        ))}
        <FullReportDoc id="clean-full" dateLabel={dateLabel} paid={paid} copByAcct={copByAcct} adjByAcct={adjByAcct} totals={totals} entryOf={entryOf} effDate={effDate} />
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

function HighlightDots({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const dot = (color: 'red' | 'yellow') => {
    const on = value === color
    const base = color === 'red'
      ? (on ? 'bg-red-500 border-red-500 ring-2 ring-offset-1 ring-red-300' : 'bg-red-200 border-red-300')
      : (on ? 'bg-amber-400 border-amber-400 ring-2 ring-offset-1 ring-amber-300' : 'bg-amber-100 border-amber-300')
    return (
      <button type="button" title={on ? `Clear ${color}` : `Flag ${color}`} onClick={() => onChange(on ? null : color)}
        className={`h-3.5 w-3.5 rounded-full border ${base}`} />
    )
  }
  return <div className="flex items-center justify-center gap-1.5">{dot('red')}{dot('yellow')}</div>
}

// Pick a common remark from the list OR type a brand-new one. Saves on blur / Enter.
function RemarkSelect({ value, onChange, inputCls }: { value: string | null; onChange: (v: string) => void; inputCls: string }) {
  return (
    <input
      list="bp-remark-options"
      className={inputCls}
      defaultValue={value ?? ''}
      placeholder="Pick or type…"
      onBlur={e => { const v = e.target.value.trim(); if (v !== (value ?? '')) onChange(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function TrustSection({
  idPrefix, title, acct, rows, entryOf, save, effDate, inputCls, onCopy, busy,
}: {
  idPrefix: string
  title: string
  acct: string
  rows: ReportBillLite[]
  entryOf: (id: string) => TrustdeskEntry
  save: (id: string, patch: Partial<TrustdeskEntry>) => void
  effDate: (b: ReportBillLite, acct: string) => string
  inputCls: string
  onCopy: () => void
  busy: boolean
}) {
  const isCourier = COURIER_ACCTS.has(acct)
  const dateHdr = isCourier ? 'Courier ✎' : 'Submission ✎'
  const total = rows.reduce((s, b) => s + b.amount, 0)
  const badge = acct === '—'
    ? <span className="inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border bg-rose-50 text-rose-600 border-rose-200">Trust not set</span>
    : <span className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 border ${ACCT_TONE[acct] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>Submitted to {acct} A/c</span>
  return (
    <section id={`${idPrefix}-${acct}`} className="scroll-mt-32 md:scroll-mt-20 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap" style={{ backgroundColor: ACCT_HEAD[acct] ?? '#f8fafc' }}>
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
        <table className="min-w-[820px] w-full text-xs">
          <thead className="text-gray-500 bg-white"><tr>
            <th className="text-left px-3 py-2 font-medium w-8">#</th>
            <th className="text-left px-3 py-2 font-medium">Vendor</th>
            <th className="text-left px-3 py-2 font-medium">Project</th>
            <th className="text-left px-3 py-2 font-medium">Invoice</th>
            <th className="text-right px-3 py-2 font-medium">Amount</th>
            <th className="text-left px-3 py-2 font-medium w-28">{dateHdr}</th>
            <th className="text-left px-3 py-2 font-medium w-12">Age</th>
            <th className="text-left px-3 py-2 font-medium w-48">Remark ✎</th>
            <th className="text-center px-3 py-2 font-medium w-12">Adj</th>
            <th className="text-center px-3 py-2 font-medium w-14">Flag</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((b, i) => {
              const e = entryOf(b.id)
              const d = effDate(b, acct)
              const age = daysSince(d)
              return (
                <tr key={b.id} className={HL_ROW[e.highlight ?? ''] ?? 'hover:bg-gray-50/60'}>
                  <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5 text-gray-800">{b.vendor || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{b.area}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-600">{b.invoiceNo}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatINR(b.amount)}</td>
                  <td className="px-3 py-1.5">
                    <input type="date" className={inputCls} value={d}
                      onChange={ev => save(b.id, isCourier ? { courier_date: ev.target.value || null } : { submission_date: ev.target.value || null })} />
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-gray-600">{age == null ? '—' : `${age}d`}</td>
                  <td className="px-3 py-1.5"><RemarkSelect value={e.remark} onChange={v => save(b.id, { remark: v })} inputCls={inputCls} /></td>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={e.is_adjust_advance} onChange={ev => save(b.id, { is_adjust_advance: ev.target.checked })} className="h-4 w-4 accent-amber-600" title="Move to Adjust-against-advance" />
                  </td>
                  <td className="px-3 py-1.5"><HighlightDots value={e.highlight} onChange={h => save(b.id, { highlight: h })} /></td>
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

// ── Off-screen "clean" renders captured as PNG (per-trust) / PDF (full day) ──
// Calm, neutral hues only (indigo / cyan / violet / sky / slate) — deliberately
// NO red, pink, green or amber, so trust shades never compete with the red/yellow
// row flags or the red ≥7-day delay.
const ACCT_HEX: Record<string, string> = { SRET: '#4f46e5', SRAH: '#0891b2', SRASSK: '#7c3aed', SRA: '#0284c7', '—': '#64748b' }
// per-trust shades — header (light) + body wash (very light) so trusts differ at a glance
const ACCT_HEAD: Record<string, string> = { SRET: '#e0e7ff', SRAH: '#cffafe', SRASSK: '#ede9fe', SRA: '#e0f2fe', '—': '#e2e8f0' }
const ACCT_BODY: Record<string, string> = { SRET: '#f4f6ff', SRAH: '#ecfdff', SRASSK: '#f6f4ff', SRA: '#f0f9ff', '—': '#f6f8fb' }
const GRID = '1px solid #c7d0dc'   // visible grid lines for image + PDF

// One section: heading with a trust-colour chip + count/total, then a clean table.
function SectionTable({
  title, acct, rows, kind, entryOf, effDate, emptyNote,
}: {
  title: string
  acct: string
  rows: ReportBillLite[]
  kind: 'paid' | 'trust'
  entryOf: (id: string) => TrustdeskEntry
  effDate: (b: ReportBillLite, acct: string) => string
  emptyNote?: string
}) {
  const hex = kind === 'paid' ? '#475569' : (ACCT_HEX[acct] ?? '#64748b')
  const headBg = kind === 'paid' ? '#e8edf3' : (ACCT_HEAD[acct] ?? '#e2e8f0')
  const bodyBg = kind === 'paid' ? '#f7f9fc' : (ACCT_BODY[acct] ?? '#f8fafc')
  const dateHdr = kind === 'paid' ? 'Paid on' : (COURIER_ACCTS.has(acct) ? 'Courier' : 'Submission')
  const showDays = kind === 'trust'
  const total = rows.reduce((s, b) => s + b.amount, 0)
  const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', border: GRID, background: headBg, fontWeight: 700, color: '#1e293b' }
  const thR: CSSProperties = { ...th, textAlign: 'right' }
  const td: CSSProperties = { padding: '5px 8px', border: GRID }
  const tdR: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }
  const rowBg = (hl: string | null): string =>
    hl === 'red' ? '#fecaca' : hl === 'yellow' ? '#fde68a' : bodyBg
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: hex, display: 'inline-block' }} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>{title}{acct && acct !== '—' ? ` — ${acct} A/c` : (acct === '—' ? ' — Trust not set' : '')}</span>
        </div>
        <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{rows.length} bill{rows.length === 1 ? '' : 's'} · {formatINR(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '10px 8px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic', background: bodyBg, border: GRID, borderRadius: 4 }}>{emptyNote || 'No records'}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>
            <th style={{ ...th, width: 26 }}>#</th>
            <th style={th}>Party</th>
            <th style={th}>Project</th>
            <th style={th}>Invoice</th>
            <th style={thR}>Amount (₹)</th>
            <th style={th}>{dateHdr}</th>
            {showDays && <th style={{ ...th, width: 46, textAlign: 'right' }}>Days</th>}
            <th style={th}>Remark</th>
          </tr></thead>
          <tbody>
            {rows.map((b, i) => {
              const days = showDays ? daysSince(effDate(b, acct)) : null
              return (
                <tr key={b.id} style={{ background: rowBg(entryOf(b.id).highlight) }}>
                  <td style={{ ...td, color: '#94a3b8' }}>{i + 1}</td>
                  <td style={td}>{b.vendor || '—'}</td>
                  <td style={{ ...td, color: '#475569' }}>{b.area}</td>
                  <td style={{ ...td, color: '#475569' }}>{b.invoiceNo}</td>
                  <td style={tdR}>{formatINR(b.amount)}</td>
                  <td style={td}>{kind === 'paid' ? fmtDate(b.paymentDate) : fmtDate(effDate(b, acct))}</td>
                  {showDays && <td style={{ ...tdR, fontWeight: 400, color: days != null && days >= 7 ? '#b91c1c' : '#475569' }}>{days == null ? '—' : `${days}d`}</td>}
                  <td style={{ ...td, color: '#475569' }}>{entryOf(b.id).remark || ''}</td>
                </tr>
              )
            })}
            <tr style={{ background: headBg, fontWeight: 800 }}>
              <td style={td} colSpan={4}>Total · {rows.length} bill{rows.length === 1 ? '' : 's'}</td>
              <td style={tdR}>{formatINR(total)}</td>
              <td style={td} colSpan={showDays ? 3 : 2}></td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

// Per-trust card → "Copy image" (PNG to clipboard).
function CleanTable({
  id, title, acct, dateLabel, rows, kind, entryOf, effDate,
}: {
  id: string
  title: string
  acct: string
  dateLabel: string
  rows: ReportBillLite[]
  kind: 'paid' | 'trust'
  entryOf: (id: string) => TrustdeskEntry
  effDate: (b: ReportBillLite, acct: string) => string
}) {
  return (
    <div id={id} style={{ width: '820px', background: '#fff', padding: '18px 22px', fontFamily: 'Arial, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #0f172a', paddingBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Daily Bills Report</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>SRMD Construction · Trust Accounts</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{dateLabel}</div>
      </div>
      <SectionTable title={title} acct={acct} rows={rows} kind={kind} entryOf={entryOf} effDate={effDate} emptyNote={kind === 'paid' ? 'No payments done today' : 'No bills'} />
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 12 }}>Auto-generated from Zoho · CT Hub</div>
    </div>
  )
}

function SummaryPill({ label, n, amt, hex }: { label: string; n: number; amt: number; hex: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid #e2e8f0', borderLeft: `3px solid ${hex}`, borderRadius: 8, padding: '8px 12px', background: '#fff' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>{formatINR(amt)}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{n} bill{n === 1 ? '' : 's'}</div>
    </div>
  )
}

// Full day → single continuous PDF. Payments Done is always first.
function FullReportDoc({
  id, dateLabel, paid, copByAcct, adjByAcct, totals, entryOf, effDate,
}: {
  id: string
  dateLabel: string
  paid: ReportBillLite[]
  copByAcct: Array<[string, ReportBillLite[]]>
  adjByAcct: Array<[string, ReportBillLite[]]>
  totals: { paidValue: number; trustValue: number; trustCount: number; adjValue: number; adjCount: number }
  entryOf: (id: string) => TrustdeskEntry
  effDate: (b: ReportBillLite, acct: string) => string
}) {
  return (
    <div id={id} style={{ width: '820px', background: '#fff', fontFamily: 'Arial, sans-serif', color: '#0f172a' }}>
      <div style={{ background: '#0f172a', color: '#fff', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.3 }}>Daily Bills Report</div>
          <div style={{ fontSize: 11.5, color: '#cbd5e1', marginTop: 3 }}>SRMD Construction · Trust Accounts</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{dateLabel}</div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Auto-generated from Zoho</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, padding: '12px 24px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <SummaryPill label="Paid today" n={paid.length} amt={totals.paidValue} hex="#475569" />
        <SummaryPill label="At Trust (COP)" n={totals.trustCount} amt={totals.trustValue} hex="#4f46e5" />
        {totals.adjCount > 0 && <SummaryPill label="Adjust" n={totals.adjCount} amt={totals.adjValue} hex="#7c3aed" />}
      </div>
      <div style={{ padding: '2px 24px 8px' }}>
        <SectionTable title="Payments Done" acct="" rows={paid} kind="paid" entryOf={entryOf} effDate={effDate} emptyNote="No payments done today" />
        {copByAcct.map(([acct, rows]) => (
          <SectionTable key={`f-cop-${acct}`} title="COP Under Process" acct={acct} rows={rows} kind="trust" entryOf={entryOf} effDate={effDate} />
        ))}
        {adjByAcct.map(([acct, rows]) => (
          <SectionTable key={`f-adj-${acct}`} title="Adjust Against Advance" acct={acct} rows={rows} kind="trust" entryOf={entryOf} effDate={effDate} />
        ))}
      </div>
      <div style={{ padding: '12px 24px', borderTop: '1px solid #e2e8f0', fontSize: 10, color: '#94a3b8' }}>Generated by CT Hub · figures pulled from Zoho Projects · {dateLabel}</div>
    </div>
  )
}
