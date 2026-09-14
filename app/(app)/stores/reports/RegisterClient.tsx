'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import {
  REGISTERS, groupRows, totals, qtyLine, periodLabel, filterNotes,
  type GroupBy, type RegisterRow, type RegisterSpec, type RegisterFilter,
} from '@/lib/stores/registers'
import { fmtQty } from '@/lib/stores/core'
import { formatINR } from '@/lib/utils'
import { GROUPS } from '@/lib/stores/registers'
import { inputClass, Empty, Scroller, th, td, tdNum } from '../ui'

/**
 * One register, on screen and on paper.
 *
 * The four registers share this component because they are the same shape —
 * a period, some rows, a grouping, a total. Writing four would be four places
 * for a column to go missing from one of them.
 *
 * The export builds from the SAME grouped rows the screen renders, so a
 * printed register and the screen it came from cannot disagree.
 */
export function RegisterClient({
  spec, rows, filter, parties, projects, disciplines, names,
}: {
  spec: RegisterSpec
  rows: RegisterRow[]
  filter: RegisterFilter
  parties: string[]
  projects: Array<{ id: string; name: string }>
  disciplines: Array<{ id: string; name: string }>
  names: { project?: string | null; discipline?: string | null }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [by, setBy] = useState<GroupBy>('project')
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => groupRows(rows, by), [rows, by])
  const grand = useMemo(() => totals(rows), [rows])
  const period = periodLabel(filter)
  const notes = filterNotes(filter, names)

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString())
    if (v) next.set(k, v); else next.delete(k)
    router.push(`/stores/reports/${spec.kind}?${next.toString()}`)
  }

  /** Excel and PDF from one spec — see lib/stores/export.ts for why. */
  const download = async (as: 'xlsx' | 'pdf') => {
    setBusy(true)
    try {
      const { exportRegister } = await import('@/lib/stores/export')
      await exportRegister(as, {
        title: spec.title, period, notes, groups, grand,
        showMoney: rows.some(r => r.amount != null),
      })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {/* ── the four, as tabs ─────────────────────────────────────────── */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 no-print">
        <div className="flex gap-1.5 min-w-max">
          {REGISTERS.map(r => (
            <Link
              key={r.kind} href={`/stores/reports/${r.kind}`}
              className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap min-h-[44px] inline-flex items-center ${
                r.kind === spec.kind ? 'bg-indigo-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r.title}
            </Link>
          ))}
          <Link href="/stores/stock"
            className="rounded-lg px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap min-h-[44px] inline-flex items-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
            Total Stock →
          </Link>
        </div>
      </div>

      <div>
        <h2 className="text-[17px] font-bold text-gray-900">{spec.title}</h2>
        <p className="text-[12.5px] text-gray-500">{spec.blurb}</p>
      </div>

      {/* ── the map's filters ─────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">From</span>
          <input type="date" className={inputClass} defaultValue={filter.from ?? ''} onChange={e => setParam('from', e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">To</span>
          <input type="date" className={inputClass} defaultValue={filter.to ?? ''} onChange={e => setParam('to', e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Party</span>
          <select className={inputClass} defaultValue={filter.party ?? ''} onChange={e => setParam('party', e.target.value)}>
            <option value="">Everyone</option>
            {parties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Project</span>
          <select className={inputClass} defaultValue={filter.projectId ?? ''} onChange={e => setParam('project', e.target.value)}>
            <option value="">Every project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Discipline</span>
          <select className={inputClass} defaultValue={filter.disciplineId ?? ''} onChange={e => setParam('discipline', e.target.value)}>
            <option value="">Every discipline</option>
            {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 no-print">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Group by</span>
        {GROUPS.map(g => (
          <button
            key={g.key} type="button" onClick={() => setBy(g.key)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold min-h-[40px] ${
              by === g.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {g.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button type="button" disabled={busy || rows.length === 0} onClick={() => download('xlsx')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px] disabled:opacity-50">
            <Download className="h-4 w-4" /> Excel
          </button>
          <button type="button" disabled={busy || rows.length === 0} onClick={() => download('pdf')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-indigo-800 min-h-[44px] disabled:opacity-50">
            <Printer className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {/* ── the page itself ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-[13.5px] font-bold text-gray-900">{spec.title}</p>
          <p className="text-[12px] text-gray-600">{period}{notes.length > 0 && <> · {notes.join(' · ')}</>}</p>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <Empty
              title="Nothing in this period"
              hint="Widen the dates, or clear a filter. An empty register is an answer — it is not an error."
            />
          </div>
        ) : (
          <Scroller min={980}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Entry</th>
                  <th className={th}>Party</th>
                  <th className={th}>Item</th>
                  <th className={th}>Discipline</th>
                  <th className={th}>Where</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={th}>Unit</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <>
                    <tr key={`h-${g.label}`} className="bg-gray-100">
                      <td className={`${td} font-bold text-gray-900`} colSpan={6}>{g.label}</td>
                      <td className={`${tdNum} font-semibold`} colSpan={2}>{qtyLine(g.totals)}</td>
                      <td className={td}></td>
                      <td className={`${tdNum} font-semibold`}>
                        {g.totals.amount > 0 ? formatINR(g.totals.amount) : '—'}
                      </td>
                    </tr>
                    {g.rows.map((r, i) => (
                      <tr key={`${g.label}-${r.entryId}-${r.itemId}-${i}`}>
                        <td className={`${td} whitespace-nowrap`}>{r.day}</td>
                        <td className={`${td} font-mono text-[12px]`}>
                          {r.entryNo}
                          {r.linkedNo && <span className="block text-[11px] text-gray-400">({r.linkedNo})</span>}
                        </td>
                        <td className={td}>{r.party ?? '—'}</td>
                        <td className={td}>{r.itemName}</td>
                        <td className={td}>{r.discipline ?? '—'}</td>
                        <td className={td}>{r.place ?? '—'}</td>
                        <td className={tdNum}>{fmtQty(r.qty)}</td>
                        <td className={td}>{r.unit}</td>
                        <td className={tdNum}>{r.rate == null ? '—' : formatINR(r.rate)}</td>
                        <td className={tdNum}>{r.amount == null ? '—' : formatINR(r.amount)}</td>
                      </tr>
                    ))}
                  </>
                ))}
                <tr className="bg-gray-900 text-white">
                  <td className="px-3 py-2.5 text-[13px] font-bold" colSpan={6}>
                    Total — {grand.entries} entr{grand.entries === 1 ? 'y' : 'ies'} · {grand.lines} lines
                  </td>
                  <td className="px-3 py-2.5 text-[13px] font-bold text-right tabular-nums" colSpan={2}>{qtyLine(grand)}</td>
                  <td></td>
                  <td className="px-3 py-2.5 text-[13px] font-bold text-right tabular-nums">
                    {grand.amount > 0 ? formatINR(grand.amount) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </Scroller>
        )}

        {grand.amountPartial && rows.length > 0 && (
          <p className="px-4 py-2.5 text-[12px] text-amber-900 bg-amber-50 border-t border-amber-200">
            The ₹ total is <b>understated</b> — some lines have no known rate. Odoo carried none, so anything
            from the opening stock is unpriced until rates are loaded.
          </p>
        )}
      </div>
    </div>
  )
}
