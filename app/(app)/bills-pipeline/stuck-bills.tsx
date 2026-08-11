'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Search, ArrowDownWideNarrow } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StuckBillRow {
  id:          string
  prefix:      string
  zohoDate:    string
  vendor:      string
  project:     string
  tasklist:    string
  invoiceDate: string
  invoiceNo:   string
  amount:      number
  status:      string
  delayDays:   number
  stalled:     boolean
  atTrust:     boolean
}

// Tidy a Zoho task-list name for display: title-case long words, keep short
// acronyms / codes as-is ("NGH INFRA" -> "NGH Infra", "P2 A01" stays).
function prettyArea(s: string): string {
  return (s ?? '')
    .split(/\s+/)
    .map(w => (w.length > 3 && /^[A-Za-z]+$/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
    .trim()
}

export interface ChecklistState {
  ms_sheet:       boolean
  abstract_sheet: boolean
  po_wo:          boolean
  drawing:        boolean
  note?:          string
}

type CheckKey = 'ms_sheet' | 'abstract_sheet' | 'po_wo' | 'drawing'

const CHECK_FIELDS: Array<{ key: CheckKey; label: string; short: string }> = [
  { key: 'ms_sheet',       label: 'MS Sheet',      short: 'MS' },
  { key: 'abstract_sheet', label: 'Abstract Sheet', short: 'Abs' },
  { key: 'po_wo',          label: 'PO / WO',       short: 'PO/WO' },
  { key: 'drawing',        label: 'Drawing',       short: 'Dwg' },
]

const EMPTY: ChecklistState = { ms_sheet: false, abstract_sheet: false, po_wo: false, drawing: false, note: '' }

function inr(n: number): string {
  const v = Math.round(n || 0)
  const s = Math.abs(v).toString()
  if (s.length <= 3) return (v < 0 ? '-' : '') + s
  return (v < 0 ? '-' : '') + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
}
// Compact ₹ for the scoreboard (lakh / crore).
function cr(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + inr(n)
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso)
  if (isNaN(d.getTime())) return '—'
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getUTCFullYear()}`
}

export default function StuckBills({
  bills, initialChecklist, canEdit,
}: {
  bills: StuckBillRow[]
  initialChecklist: Record<string, ChecklistState>
  canEdit: boolean
}) {
  const [checks, setChecks] = useState<Record<string, ChecklistState>>(initialChecklist)
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // Segment = the verification-state lens Mayank works in (his action queue).
  const [seg, setSeg] = useState<'all' | 'ready' | 'oneaway' | 'notstarted' | 'stalled'>('all')
  // Priority: ready-to-push first, then biggest money / longest wait.
  const [sortBy, setSortBy] = useState<'priority' | 'amount' | 'days' | 'nearly'>('priority')

  const ticksOf = (id: string) => {
    const c = checks[id] ?? EMPTY
    return (c.ms_sheet ? 1 : 0) + (c.abstract_sheet ? 1 : 0) + (c.po_wo ? 1 : 0) + (c.drawing ? 1 : 0)
  }
  const isReady = (id: string) => ticksOf(id) === 4

  const projects = useMemo(() => [...new Set(bills.map(b => b.project).filter(Boolean))].sort(), [bills])
  const statuses = useMemo(() => [...new Set(bills.map(b => b.status).filter(Boolean))].sort(), [bills])

  // Scoreboard — counts + ₹ over ALL bills, so the tiles stay stable while filtering.
  const board = useMemo(() => {
    const val = (arr: StuckBillRow[]) => arr.reduce((s, b) => s + (b.amount || 0), 0)
    const ready = bills.filter(b => ticksOf(b.id) === 4)
    const oneaway = bills.filter(b => ticksOf(b.id) === 3)
    const notstarted = bills.filter(b => ticksOf(b.id) === 0)
    const stalled = bills.filter(b => b.stalled)
    return {
      all: { n: bills.length, v: val(bills) },
      ready: { n: ready.length, v: val(ready) },
      oneaway: { n: oneaway.length, v: val(oneaway) },
      notstarted: { n: notstarted.length, v: val(notstarted) },
      stalled: { n: stalled.length, v: val(stalled) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, checks])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = bills.filter(b => {
      if (projectFilter && b.project !== projectFilter) return false
      if (statusFilter && b.status !== statusFilter) return false
      if (seg === 'ready' && ticksOf(b.id) !== 4) return false
      if (seg === 'oneaway' && ticksOf(b.id) !== 3) return false
      if (seg === 'notstarted' && ticksOf(b.id) !== 0) return false
      if (seg === 'stalled' && !b.stalled) return false
      if (q && ![b.vendor, b.invoiceNo, b.project, b.tasklist, b.prefix, b.status].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
    const score = (b: StuckBillRow) => (b.amount || 0) * (1 + (b.delayDays || 0) / 20)
    rows.sort((a, b) => {
      if (sortBy === 'amount') return (b.amount || 0) - (a.amount || 0)
      if (sortBy === 'days') return (b.delayDays || 0) - (a.delayDays || 0)
      // 'nearly' intentionally reorders as ticks land — it's the opt-in view.
      if (sortBy === 'nearly') return (ticksOf(b.id) - ticksOf(a.id)) || (score(b) - score(a))
      // priority: ₹ × days-waiting. Kept independent of the checklist so rows
      // don't jump while Milan is ticking — the Ready tile/callout is the queue.
      return score(b) - score(a)
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, query, projectFilter, statusFilter, seg, sortBy, checks])

  const anyFilter = !!(query || projectFilter || statusFilter || seg !== 'all')
  function clearFilters() {
    setQuery(''); setProjectFilter(''); setStatusFilter(''); setSeg('all')
  }

  async function toggle(id: string, field: CheckKey) {
    if (!canEdit) return
    const cur = checks[id] ?? EMPTY
    const next = { ...cur, [field]: !cur[field] }
    setChecks(prev => ({ ...prev, [id]: next }))   // optimistic
    try {
      const res = await fetch('/api/bills-pipeline/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billId: id, [field]: next[field] }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.reason ?? 'save failed')
    } catch (e) {
      setChecks(prev => ({ ...prev, [id]: cur }))   // revert
      toast.error(`Couldn't save — ${e instanceof Error ? e.message : 'try again'}`)
    }
  }

  // Remarks: update locally as the user types; save on blur.
  function setNoteLocal(id: string, note: string) {
    setChecks(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), note } }))
  }
  async function saveNote(id: string) {
    if (!canEdit) return
    const note = (checks[id]?.note ?? '').slice(0, 500)
    try {
      const res = await fetch('/api/bills-pipeline/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billId: id, note }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.reason ?? 'save failed')
    } catch (e) {
      toast.error(`Couldn't save remark — ${e instanceof Error ? e.message : 'try again'}`)
    }
  }

  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
        No bills in the pipeline yet. Click <b>Refresh</b> above to pull the latest from Zoho.
      </div>
    )
  }

  const TILES = [
    { key: 'all' as const,        label: 'To verify',    b: board.all,        col: 'text-slate-800', ring: 'ring-slate-800' },
    { key: 'ready' as const,      label: 'Ready to push', b: board.ready,     col: 'text-green-700', ring: 'ring-green-600' },
    { key: 'oneaway' as const,    label: 'One doc away', b: board.oneaway,     col: 'text-amber-700', ring: 'ring-amber-500' },
    { key: 'notstarted' as const, label: 'Not started',  b: board.notstarted, col: 'text-gray-600',  ring: 'ring-gray-400' },
    { key: 'stalled' as const,    label: 'Stalled >21d', b: board.stalled,    col: 'text-red-600',   ring: 'ring-red-500' },
  ]

  return (
    <div className="space-y-3">
      {/* Scoreboard — click a tile to work that queue */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TILES.map(t => (
          <button key={t.key} onClick={() => setSeg(s => (s === t.key ? 'all' : t.key))}
            className={cn('rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5',
              seg === t.key ? `border-transparent ring-2 ${t.ring}` : 'border-gray-200')}>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{t.label}</div>
            <div className={cn('mt-1 text-2xl font-bold tabular-nums', t.col)}>{t.b.n}</div>
            <div className="text-[11.5px] text-gray-500">{cr(t.b.v)}</div>
          </button>
        ))}
      </div>

      {/* Ready-to-push callout — Mayank's action queue */}
      {board.ready.n > 0 && seg !== 'ready' && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <p className="m-0 text-sm text-green-900">
            <b>{board.ready.n} bill{board.ready.n === 1 ? '' : 's'} fully verified — {cr(board.ready.v)} ready to push.</b> All four documents are in.
          </p>
          <button onClick={() => setSeg('ready')} className="ml-auto whitespace-nowrap rounded-full bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700">Show these →</button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search vendor, invoice no…"
            className="h-9 w-60 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <select
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-indigo-400"
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 max-w-[200px] rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-indigo-400"
        >
          <option value="">All stages</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <ArrowDownWideNarrow className="h-4 w-4 text-gray-400" />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 outline-none focus:border-indigo-400">
            <option value="priority">Priority (₹ × wait)</option>
            <option value="amount">Biggest ₹</option>
            <option value="days">Longest wait</option>
            <option value="nearly">Nearly done</option>
          </select>
        </label>
        {anyFilter && (
          <button onClick={clearFilters} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            Clear
          </button>
        )}
        <div className="ml-auto text-sm text-gray-500">
          {filtered.length} of {bills.length}
        </div>
      </div>

      {/* Table — sized to fit without a right-side scroll on desktop */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5 text-center" title="Documents verified out of 4">Docs</th>
              <th className="px-2 py-2.5">Task ID</th>
              <th className="px-2 py-2.5">Vendor</th>
              <th className="px-2 py-2.5">Project / Area</th>
              <th className="px-2 py-2.5 whitespace-nowrap">Zoho Date</th>
              <th className="px-2 py-2.5 whitespace-nowrap">Inv Date</th>
              <th className="px-2 py-2.5">Invoice No</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5">Stage</th>
              <th className="px-2 py-2.5 text-right">Delay</th>
              {CHECK_FIELDS.map(f => (
                <th key={f.key} className="px-1.5 py-2.5 text-center" title={f.label}>{f.short}</th>
              ))}
              <th className="px-2 py-2.5">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => {
              const c = checks[b.id] ?? EMPTY
              const t = ticksOf(b.id)
              const ready = t === 4
              return (
                <tr key={b.id} className={cn('border-t border-gray-100', i % 2 ? 'bg-gray-50/50' : 'bg-white', ready && 'bg-green-50/70')}>
                  <td className="px-2 py-2.5 text-gray-400 tabular-nums">
                    {ready ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : i + 1}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
                      t === 4 ? 'bg-green-100 text-green-700' : t === 0 ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-800')}>
                      {t}/4
                    </span>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap font-medium text-gray-700">{b.prefix || '—'}</td>
                  <td
                    className="max-w-[180px] truncate px-2 py-2.5 font-medium text-gray-900"
                    title={b.vendor || undefined}
                  >
                    {b.vendor || '—'}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{b.project}</span>
                      {b.tasklist && (
                        <span className="max-w-[130px] truncate text-gray-700" title={b.tasklist}>{prettyArea(b.tasklist)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(b.zohoDate)}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(b.invoiceDate)}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">{b.invoiceNo || '—'}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">₹{inr(b.amount)}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-700">{b.status}</td>
                  <td className={cn('px-2 py-2.5 text-right font-semibold tabular-nums', b.stalled ? 'text-red-600' : 'text-gray-600')}>
                    {b.delayDays}d
                  </td>
                  {CHECK_FIELDS.map(f => (
                    <td key={f.key} className="px-1.5 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={c[f.key]}
                        disabled={!canEdit}
                        onChange={() => toggle(b.id, f.key)}
                        className="h-4 w-4 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed"
                        aria-label={`${f.label} for ${b.vendor}`}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2.5">
                    <input
                      type="text"
                      value={c.note ?? ''}
                      disabled={!canEdit}
                      onChange={e => setNoteLocal(b.id, e.target.value)}
                      onBlur={() => saveNote(b.id)}
                      placeholder={canEdit ? 'Add remark…' : '—'}
                      title={c.note || undefined}
                      className="w-full min-w-[130px] max-w-[190px] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-gray-700 outline-none hover:border-gray-200 focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-100 disabled:cursor-not-allowed"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Delay is counted from the bill&apos;s Zoho entry date. Ticks are saved automatically and persist across refreshes.
        Approvals are still made in Zoho — this checklist is your verification tracker.
      </p>
    </div>
  )
}
