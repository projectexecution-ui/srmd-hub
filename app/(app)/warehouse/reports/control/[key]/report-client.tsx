'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { exportXlsx, exportPdf } from '@/lib/warehouse/export'
import type { ExportSpec } from '@/lib/warehouse/export'
import type { Cell, ReportView, Tone } from '@/lib/warehouse/exceptions'
import { FileDown, FileSpreadsheet, Search, CheckCircle2, HelpCircle } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'
const btnCls =
  'rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600 ' +
  'hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50'

const TONE_TEXT: Record<Tone, string> = {
  bad: 'text-rose-600 font-semibold',
  warn: 'text-amber-700 font-semibold',
  good: 'text-emerald-700 font-semibold',
  muted: 'text-slate-400',
}
const TONE_KPI: Record<Tone, string> = {
  bad: 'text-rose-600', warn: 'text-amber-700', good: 'text-emerald-700', muted: 'text-slate-400',
}

function quickRanges(today: string) {
  const [y, m] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastM = m === 1 ? 12 : m - 1
  const lastY = m === 1 ? y - 1 : y
  const lastEnd = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate()
  const fyStart = m >= 4 ? y : y - 1
  return [
    { label: 'This month', from: `${y}-${pad(m)}-01`, to: today },
    { label: 'Last month', from: `${lastY}-${pad(lastM)}-01`, to: `${lastY}-${pad(lastM)}-${pad(lastEnd)}` },
    { label: 'This FY', from: `${fyStart}-04-01`, to: today },
    { label: 'Everything', from: '', to: '' },
  ]
}

export function ReportClient({
  view, usesPeriod, from, to, today, showValues, moneyLed,
}: {
  view: ReportView
  usesPeriod: boolean
  from: string | null
  to: string | null
  today: string
  showValues: boolean
  moneyLed: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = useState('')

  function setParams(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k) }
    router.push(`/warehouse/reports/control/${view.key}?${p.toString()}`)
  }

  /** Search across every cell — these tables have different shapes, and the
   *  person looking usually knows one word: a vendor, an item, a PO number. */
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return view.groups
    return view.groups
      .map(g => ({ ...g, rows: g.rows.filter(r => r.some(c => c.text.toLowerCase().includes(needle))) }))
      .filter(g => g.rows.length > 0)
  }, [view.groups, q])

  const rowCount = groups.reduce((s, g) => s + g.rows.length, 0)
  const periodLabel = !usesPeriod
    ? `As it stands today, ${formatDate(today)}`
    : !from && !to
      ? 'All entries, every period'
      : `${from ? formatDate(from) : 'the beginning'} → ${to ? formatDate(to) : 'today'}`

  function spec(): ExportSpec<Cell[]> {
    return {
      name: `warehouse-${view.key}`,
      title: view.title,
      period: periodLabel,
      notes: [view.question, q.trim() ? `Search: "${q.trim()}"` : ''].filter(Boolean),
      columns: view.columns.map((c, i) => ({
        header: c.header,
        cell: (row: Cell[]) => row[i]?.text ?? '',
        raw: (row: Cell[]) => row[i]?.num ?? null,
        align: c.align,
        width: c.width,
      })),
      groups: groups.map(g => ({ label: g.label, rows: g.rows, footer: g.footer?.map(c => c.text) })),
      caveats: view.caveats,
    }
  }

  return (
    <div className="space-y-3">
      {/* What this report is for, in the words of the person who would ask. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12.5px] text-slate-700 flex items-start gap-2">
        <HelpCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
        <span><b>What this answers:</b> {view.question}</span>
      </div>

      <Card className="p-3 shadow-sm">
        <div className={`grid gap-2 ${usesPeriod ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
          {usesPeriod && (
            <>
              <div>
                <label className={labelCls} htmlFor="rep-from">From</label>
                <input id="rep-from" type="date" className={inputCls} value={from ?? ''} max={today}
                  onChange={e => setParams({ from: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="rep-to">To</label>
                <input id="rep-to" type="date" className={inputCls} value={to ?? ''} max={today}
                  onChange={e => setParams({ to: e.target.value })} />
              </div>
            </>
          )}
          <div>
            <label className={labelCls} htmlFor="rep-q">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input id="rep-q" type="search" className={inputCls + ' pl-8'} value={q}
                onChange={e => setQ(e.target.value)} placeholder="Item, vendor, PO, entry no" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-slate-100">
          {usesPeriod && quickRanges(today).map(r => {
            const on = (from ?? '') === r.from && (to ?? '') === r.to
            return (
              <button key={r.label} type="button" aria-pressed={on}
                onClick={() => setParams({ from: r.from, to: r.to })}
                className={`rounded-full border-2 px-3 py-1.5 min-h-[44px] text-[12px] font-bold transition ${
                  on ? 'border-emerald-500 bg-emerald-600 text-white'
                     : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'}`}>
                {r.label}
              </button>
            )
          })}
          {!usesPeriod && (
            <span className="text-[11.5px] font-semibold text-slate-500">
              This one is a position as it stands today, not a period.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btnCls} disabled={rowCount === 0}
              onClick={() => exportXlsx(spec())}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button type="button" className={btnCls} disabled={rowCount === 0}
              onClick={() => exportPdf(spec())}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>
      </Card>

      {view.kpis.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {view.kpis.map(k => (
            <Card key={k.label} className="p-3 shadow-sm">
              <div className={`text-lg font-extrabold tabular-nums ${k.tone ? TONE_KPI[k.tone] : 'text-slate-800'}`}>
                {k.value}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{k.label}</div>
              {k.hint && <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{k.hint}</div>}
            </Card>
          ))}
        </div>
      )}

      {moneyLed && !showValues && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          This report is mostly about money, and your role does not see rates — so what you can see of it is limited.
        </div>
      )}

      {/* An exception report with nothing in it is the desired outcome. It must
          not look like a failure or an empty screen. */}
      {!view.error && view.groups.length === 0 && (
        <Card className="p-8 text-center shadow-sm">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
          <p className="text-sm font-bold text-slate-800 mt-2">Nothing to report — that is the good outcome.</p>
          <p className="text-[12.5px] text-slate-500 mt-1 max-w-lg mx-auto">{view.emptyGood}</p>
        </Card>
      )}

      {view.groups.length > 0 && rowCount === 0 && (
        <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
          Nothing matches “{q.trim()}” in this report.
        </Card>
      )}

      {groups.map(g => (
        <Card key={g.label} className="p-0 shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-slate-50/70 border-b border-slate-100">
            <span className="text-[12.5px] font-bold text-slate-800">{g.label}</span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[12px]" style={{ minWidth: `${Math.max(560, view.columns.length * 110)}px` }}>
              <thead>
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  {view.columns.map((c, i) => (
                    <th key={`${c.header}-${i}`} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    {row.map((c, ci) => (
                      <td key={ci} className={`px-2 py-1.5 ${view.columns[ci]?.align === 'right' ? 'text-right tabular-nums' : ''} ${
                        c.tone ? TONE_TEXT[c.tone] : 'text-slate-700'}`}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                ))}
                {g.footer && (
                  <tr className="bg-slate-50 font-bold">
                    {g.footer.map((c, ci) => (
                      <td key={ci} className={`px-2 py-1.5 ${view.columns[ci]?.align === 'right' ? 'text-right tabular-nums' : ''} ${
                        c.tone ? TONE_TEXT[c.tone] : 'text-slate-700'}`}>
                        {c.text}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: each row becomes a labelled block. These tables are up to
              eight columns wide, which is unreadable squeezed onto a phone. */}
          <div className="md:hidden divide-y divide-slate-50">
            {g.rows.map((row, ri) => (
              <div key={ri} className="px-3 py-2.5">
                <div className="text-[13px] font-semibold text-slate-800 break-words">{row[0]?.text}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  {row.slice(1).map((c, ci) => (
                    c.text ? (
                      <div key={ci} className="min-w-0">
                        <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">
                          {view.columns[ci + 1]?.header}
                        </span>
                        <span className={`block text-[12px] break-words ${c.tone ? TONE_TEXT[c.tone] : 'text-slate-700'}`}>
                          {c.text}
                        </span>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {view.caveats.length > 0 && (
        <div className="px-1 space-y-1">
          {view.caveats.map(c => (
            <p key={c} className="text-[11px] text-slate-400 leading-snug">· {c}</p>
          ))}
        </div>
      )}
    </div>
  )
}
