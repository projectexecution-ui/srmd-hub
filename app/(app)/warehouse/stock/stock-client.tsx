'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { exportXlsx, exportPdf } from '@/lib/warehouse/export'
import type { ExportSpec } from '@/lib/warehouse/export'
import type { StockGroup, StockLine, StockTotals } from '@/lib/warehouse/ledger'
import type { WhSite } from '@/lib/warehouse/types'
import { FileDown, FileSpreadsheet, ClipboardList, Search, AlertTriangle } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'
const btnCls =
  'rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600 ' +
  'hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50'

export function StockClient({
  asOn, today, groups, totals, sites, disciplines,
  selectedLocation, selectedDiscipline, showValues, canEdit, failed,
}: {
  asOn: string
  today: string
  groups: StockGroup[]
  totals: StockTotals
  sites: WhSite[]
  disciplines: string[]
  selectedLocation: string
  selectedDiscipline: string
  showValues: boolean
  canEdit: boolean
  failed: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value); else next.delete(key)
    router.push(`/warehouse/stock?${next.toString()}`)
  }

  /** Search and the low/nil filter are client-side: the rows are already here,
   *  and a round trip per keystroke would make the screen feel broken. */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return groups
      .map(g => ({
        ...g,
        lines: g.lines.filter(l =>
          (!needle || l.itemName.toLowerCase().includes(needle))
          && (!onlyFlagged || l.flag !== null)),
      }))
      .filter(g => g.lines.length > 0)
      .map(g => ({ ...g, value: g.lines.reduce((s, l) => s + l.value, 0) }))
  }, [groups, q, onlyFlagged])

  const shownLines = shown.flatMap(g => g.lines)
  const shownValue = shownLines.reduce((s, l) => s + l.value, 0)
  const isFiltered = Boolean(q.trim() || onlyFlagged || selectedLocation || selectedDiscipline)

  const asOnLabel = asOn === today ? `Today, ${formatDate(asOn)}` : `As on ${formatDate(asOn)}`

  function spec(): ExportSpec<StockLine> {
    const notes = [
      selectedLocation ? `Store: ${locName(sites, selectedLocation)}` : 'All storage locations',
      selectedDiscipline ? `Discipline: ${selectedDiscipline}` : 'All disciplines',
      onlyFlagged ? 'Only items that are low or nil' : '',
      q.trim() ? `Item search: "${q.trim()}"` : '',
    ].filter(Boolean)

    const caveats = [
      'In hand = In − Out + Transfer ± count corrections, from the movement ledger.',
      'Damaged material is tracked separately and is never counted as good stock.',
    ]
    if (showValues) {
      caveats.push('Value uses the last rate seen for each item. It is indicative, not a valuation.')
      if (totals.valuePartial) {
        caveats.push('Some items in stock have no known rate, so the value shown understates the total.')
      }
    }

    return {
      name: 'warehouse-stock',
      title: 'Stock register',
      period: asOnLabel,
      notes,
      columns: [
        { header: 'Item', cell: l => l.itemName, width: 34 },
        { header: 'Unit', cell: l => l.unit, width: 8 },
        { header: 'In', cell: l => formatQty(l.inQty), raw: l => l.inQty, align: 'right' },
        { header: 'Out', cell: l => formatQty(l.outQty), raw: l => l.outQty, align: 'right' },
        { header: 'Transfer', cell: l => l.transferQty === 0 ? '—' : `${l.transferQty > 0 ? '+' : '−'}${formatQty(Math.abs(l.transferQty))}`, raw: l => l.transferQty, align: 'right' },
        { header: 'Count corr.', cell: l => l.adjustQty === 0 ? '—' : `${l.adjustQty > 0 ? '+' : '−'}${formatQty(Math.abs(l.adjustQty))}`, raw: l => l.adjustQty, align: 'right' },
        { header: 'In hand', cell: l => formatQty(l.inHand), raw: l => l.inHand, align: 'right' },
        { header: 'Damaged', cell: l => l.damagedQty ? formatQty(l.damagedQty) : '—', raw: l => l.damagedQty, align: 'right' },
        { header: 'Flag', cell: l => l.flag === 'nil' ? 'NIL' : l.flag === 'low' ? 'LOW' : '', width: 8 },
        ...(showValues
          ? [{ header: 'Value', cell: (l: StockLine) => l.rate == null ? 'no rate' : formatINR(l.value), raw: (l: StockLine) => l.rate == null ? null : l.value, align: 'right' as const, width: 16 }]
          : []),
      ],
      groups: shown.map(g => ({
        label: `${g.siteName} — ${g.locationName}`,
        rows: g.lines,
        footer: [
          `${g.lines.length} ${g.lines.length === 1 ? 'item' : 'items'}`,
          '', '', '', '', '', '', '', '',
          ...(showValues ? [formatINR(g.value)] : []),
        ],
      })),
      total: [
        `${shownLines.length} lines · ${shown.length} ${shown.length === 1 ? 'store' : 'stores'}`,
        '', '', '', '', '', '', '', '',
        ...(showValues ? [formatINR(shownValue)] : []),
      ],
      caveats,
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters. The as-on date is the whole point of the screen, so it sits
          first and reads as a sentence. */}
      <Card className="p-3 shadow-sm">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className={labelCls} htmlFor="stock-ason">Stock as on</label>
            <input id="stock-ason" type="date" className={inputCls} value={asOn} max={today}
              onChange={e => setParam('asOn', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="stock-loc">Store</label>
            <select id="stock-loc" className={inputCls} value={selectedLocation}
              onChange={e => setParam('loc', e.target.value)}>
              <option value="">All storage locations</option>
              {sites.map(s => (
                <optgroup key={s.id} label={s.name}>
                  {s.spots.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="stock-disc">Discipline</label>
            <select id="stock-disc" className={inputCls} value={selectedDiscipline}
              onChange={e => setParam('disc', e.target.value)}>
              <option value="">All disciplines</option>
              {disciplines.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="stock-q">Find an item</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input id="stock-q" type="search" className={inputCls + ' pl-8'} value={q}
                onChange={e => setQ(e.target.value)} placeholder="Item name" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-slate-100">
          <button type="button" onClick={() => setOnlyFlagged(v => !v)}
            aria-pressed={onlyFlagged}
            className={`rounded-full border-2 px-3 py-1.5 min-h-[36px] text-[12px] font-bold transition ${
              onlyFlagged
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300'}`}>
            Only low or nil
          </button>
          {asOn !== today && (
            <span className="text-[11.5px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1">
              Historic view — {formatDate(asOn)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btnCls} disabled={shownLines.length === 0}
              onClick={() => exportXlsx(spec())}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button type="button" className={btnCls} disabled={shownLines.length === 0}
              onClick={() => exportPdf(spec())}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </button>
            {canEdit && (
              <Link href="/warehouse/count"
                className="rounded-lg bg-violet-700 hover:bg-violet-800 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white inline-flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> Count a store
              </Link>
            )}
          </div>
        </div>
      </Card>

      {/* KPIs. Book value first because that is what management asks for. */}
      <div className={`grid gap-2 ${showValues ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
        {showValues && (
          <Kpi label="book value" value={formatINR(shownValue)}
            hint={totals.valuePartial ? 'understated — some items have no rate' : undefined} />
        )}
        <Kpi label={shownLines.length === 1 ? 'item in stock' : 'items in stock'}
          value={String(new Set(shownLines.filter(l => l.inHand > 0).map(l => l.itemId)).size)} />
        <Kpi label="low or nil" value={String(shownLines.filter(l => l.flag).length)}
          tone={shownLines.some(l => l.flag) ? 'bad' : undefined} />
        {showValues
          ? <Kpi label="count shortage" value={formatINR(totals.countShortValue)}
              tone={totals.countShortValue > 0 ? 'bad' : undefined}
              hint={totals.countShortQty > 0 ? `${formatQty(totals.countShortQty)} written off by counts` : 'no count corrections yet'} />
          : <Kpi label="stores" value={String(shown.length)} />}
      </div>

      {!failed && groups.length === 0 && (
        <Card className="p-8 text-center shadow-sm space-y-2">
          <p className="text-sm font-bold text-slate-700">Nothing in stock as on {formatDate(asOn)}.</p>
          <p className="text-[12.5px] text-slate-500 max-w-md mx-auto">
            Stock appears here the moment a Gate IN entry is recorded — this screen is the ledger added up,
            so it stays empty until something has actually come in.
          </p>
          {canEdit && (
            <Link href="/warehouse/in" className="inline-block text-[12.5px] font-bold text-emerald-700 hover:text-emerald-900">
              Record a Gate IN entry →
            </Link>
          )}
        </Card>
      )}

      {groups.length > 0 && shown.length === 0 && (
        <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
          No item matches {q.trim() ? <>“{q.trim()}”</> : 'this filter'}
          {onlyFlagged && ' among the low or nil items'}.
        </Card>
      )}

      {shown.map(g => (
        <Card key={g.locationId} className="p-0 shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-slate-50/70 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{g.siteName}</span>
            <span className="text-[13px] font-bold text-slate-800">{g.locationName}</span>
            <span className="text-[11.5px] text-slate-500">
              {g.lines.length} {g.lines.length === 1 ? 'item' : 'items'}
            </span>
            {showValues && (
              <span className="ml-auto text-[12.5px] font-bold tabular-nums text-slate-700">{formatINR(g.value)}</span>
            )}
          </div>

          {/* Desktop: the register as a table. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="text-left px-3 py-1.5">Item</th>
                  <th className="text-right px-2 py-1.5">In</th>
                  <th className="text-right px-2 py-1.5">Out</th>
                  <th className="text-right px-2 py-1.5">Transfer</th>
                  <th className="text-right px-2 py-1.5">Count corr.</th>
                  <th className="text-right px-2 py-1.5">In hand</th>
                  <th className="text-right px-2 py-1.5">Damaged</th>
                  {showValues && <th className="text-right px-3 py-1.5">Value</th>}
                </tr>
              </thead>
              <tbody>
                {g.lines.map(l => (
                  <tr key={l.itemId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-1.5 text-slate-800">
                      {l.itemName}
                      {l.flag && <Flag flag={l.flag} />}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatQty(l.inQty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatQty(l.outQty)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums"><Signed n={l.transferQty} /></td>
                    <td className="px-2 py-1.5 text-right tabular-nums"><Signed n={l.adjustQty} /></td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${l.flag === 'nil' ? 'text-rose-600' : 'text-slate-900'}`}>
                      {formatQty(l.inHand)} <span className="font-normal text-slate-400">{l.unit}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">
                      {l.damagedQty ? formatQty(l.damagedQty) : '—'}
                    </td>
                    {showValues && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                        {l.rate == null
                          ? <span className="text-[11px] text-slate-400">no rate</span>
                          : formatINR(l.value)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per item — a 9-column table is unreadable on a phone. */}
          <div className="md:hidden divide-y divide-slate-50">
            {g.lines.map(l => (
              <div key={l.itemId} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 break-words">
                    {l.itemName}
                    {l.flag && <Flag flag={l.flag} />}
                  </span>
                  <span className={`text-[14px] font-extrabold tabular-nums flex-shrink-0 ${
                    l.flag === 'nil' ? 'text-rose-600' : 'text-slate-900'}`}>
                    {formatQty(l.inHand)} <span className="text-[11px] font-normal text-slate-400">{l.unit}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-x-3 gap-y-0.5 flex-wrap text-[11.5px] text-slate-500 tabular-nums">
                  <span>In {formatQty(l.inQty)}</span>
                  <span>Out {formatQty(l.outQty)}</span>
                  {l.transferQty !== 0 && <span>Transfer <Signed n={l.transferQty} /></span>}
                  {l.adjustQty !== 0 && <span>Count <Signed n={l.adjustQty} /></span>}
                  {l.damagedQty > 0 && <span className="text-amber-700">Damaged {formatQty(l.damagedQty)}</span>}
                  {showValues && l.rate != null && (
                    <span className="ml-auto font-semibold text-slate-700">{formatINR(l.value)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {shown.length > 1 && (
        <Card className="p-3 shadow-sm bg-slate-50/60">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[12.5px] font-extrabold text-slate-700">
              Total — {isFiltered ? 'matching lines' : 'all locations'}
            </span>
            <span className="text-[11.5px] text-slate-500">
              {shownLines.length} lines across {shown.length} stores
            </span>
            {showValues && (
              <span className="ml-auto text-[15px] font-extrabold tabular-nums text-slate-900">{formatINR(shownValue)}</span>
            )}
          </div>
          {showValues && totals.valuePartial && (
            <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-500" />
              Some items in stock have no rate on record, so this understates. The value uses the last rate
              seen at the gate — it is an indication, not a valuation.
            </p>
          )}
        </Card>
      )}

      <p className="text-[11px] text-slate-400 px-1">
        In hand = In − Out + Transfer ± count corrections, added up from the movement ledger to {formatDate(asOn)}.
        Damaged material is held apart and never counted as good stock.
      </p>
    </div>
  )
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'bad'; hint?: string }) {
  return (
    <Card className="p-3 shadow-sm">
      <div className={`text-lg font-extrabold tabular-nums ${tone === 'bad' ? 'text-rose-600' : 'text-slate-800'}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</div>}
    </Card>
  )
}

function Signed({ n }: { n: number }) {
  if (n === 0) return <span className="text-slate-300">—</span>
  return (
    <span className={n > 0 ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
      {n > 0 ? '+' : '−'}{formatQty(Math.abs(n))}
    </span>
  )
}

function Flag({ flag }: { flag: 'low' | 'nil' }) {
  return (
    <span className={`ml-1.5 text-[9px] font-extrabold uppercase rounded-full px-1.5 py-0.5 align-middle ${
      flag === 'nil' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
      {flag}
    </span>
  )
}

function locName(sites: WhSite[], id: string): string {
  const sp = sites.flatMap(s => s.spots).find(s => s.id === id)
  return sp ? `${sp.siteName} — ${sp.name}` : 'that store'
}
