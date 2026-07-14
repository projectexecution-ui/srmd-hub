'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StuckBillRow {
  id:          string
  prefix:      string
  zohoDate:    string
  vendor:      string
  project:     string
  invoiceDate: string
  invoiceNo:   string
  amount:      number
  status:      string
  delayDays:   number
  stalled:     boolean
  atTrust:     boolean
}

export interface ChecklistState {
  ms_sheet:       boolean
  abstract_sheet: boolean
  po_wo:          boolean
  drawing:        boolean
}

const CHECK_FIELDS: Array<{ key: keyof ChecklistState; label: string; short: string }> = [
  { key: 'ms_sheet',       label: 'MS Sheet',      short: 'MS' },
  { key: 'abstract_sheet', label: 'Abstract Sheet', short: 'Abs' },
  { key: 'po_wo',          label: 'PO / WO',       short: 'PO/WO' },
  { key: 'drawing',        label: 'Drawing',       short: 'Dwg' },
]

const EMPTY: ChecklistState = { ms_sheet: false, abstract_sheet: false, po_wo: false, drawing: false }

function inr(n: number): string {
  const v = Math.round(n || 0)
  const s = Math.abs(v).toString()
  if (s.length <= 3) return (v < 0 ? '-' : '') + s
  return (v < 0 ? '-' : '') + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
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
  const [onlyPending, setOnlyPending] = useState(false)

  const isReady = (id: string) => {
    const c = checks[id] ?? EMPTY
    return c.ms_sheet && c.abstract_sheet && c.po_wo && c.drawing
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return bills.filter(b => {
      if (onlyPending && isReady(b.id)) return false
      if (!q) return true
      return [b.vendor, b.invoiceNo, b.project, b.prefix, b.status]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, query, onlyPending, checks])

  const readyCount = bills.filter(b => isReady(b.id)).length

  async function toggle(id: string, field: keyof ChecklistState) {
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

  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
        No bills in the pipeline yet. Click <b>Refresh</b> above to pull the latest from Zoho.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search vendor, invoice no, project…"
            className="h-9 w-72 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          Only pending checklist
        </label>
        <div className="ml-auto text-sm text-gray-500">
          {filtered.length} of {bills.length} bills · <span className="font-medium text-green-700">{readyCount} fully checked</span>
        </div>
      </div>

      {/* Table — sized to fit without a right-side scroll on desktop */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[940px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2.5">#</th>
              <th className="px-2 py-2.5">Vendor</th>
              <th className="px-2 py-2.5">Proj</th>
              <th className="px-2 py-2.5 whitespace-nowrap">Inv Date</th>
              <th className="px-2 py-2.5">Invoice No</th>
              <th className="px-2 py-2.5 text-right">Amount</th>
              <th className="px-2 py-2.5">Status</th>
              <th className="px-2 py-2.5 text-right">Delay</th>
              {CHECK_FIELDS.map(f => (
                <th key={f.key} className="px-1.5 py-2.5 text-center" title={f.label}>{f.short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => {
              const c = checks[b.id] ?? EMPTY
              const ready = isReady(b.id)
              return (
                <tr key={b.id} className={cn('border-t border-gray-100', i % 2 ? 'bg-gray-50/50' : 'bg-white', ready && 'bg-green-50/70')}>
                  <td className="px-2 py-2.5 text-gray-400">
                    {ready ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : i + 1}
                  </td>
                  <td className="px-2 py-2.5 font-medium text-gray-900">{b.vendor || '—'}</td>
                  <td className="px-2 py-2.5">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{b.project}</span>
                  </td>
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Delay is counted from each bill&apos;s invoice date. Ticks are saved automatically and persist across refreshes.
        Approvals are still made in Zoho — this checklist is your verification tracker.
      </p>
    </div>
  )
}
