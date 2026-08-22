'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { exportXlsx, exportPdf } from '@/lib/warehouse/export'
import type { ExportSpec } from '@/lib/warehouse/export'
import {
  REGISTER_META, GROUP_LABEL, groupRows, registerTotals, categoryOf,
} from '@/lib/warehouse/registers'
import type { GroupBy, RegisterKind, RegisterRow } from '@/lib/warehouse/registers'
import { FileDown, FileSpreadsheet, Search } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'
const btnCls =
  'rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600 ' +
  'hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center justify-center gap-1.5 disabled:opacity-50'

/** Quick periods, because nobody wants to type two dates to answer "last month". */
function quickRanges(today: string) {
  const [y, m] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastM = m === 1 ? 12 : m - 1
  const lastY = m === 1 ? y - 1 : y
  const lastEnd = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate()
  // Financial year, India: 1 April to 31 March.
  const fyStart = Number(today.slice(5, 7)) >= 4 ? y : y - 1
  return [
    { label: 'This month', from: `${y}-${pad(m)}-01`, to: today },
    { label: 'Last month', from: `${lastY}-${pad(lastM)}-01`, to: `${lastY}-${pad(lastM)}-${pad(lastEnd)}` },
    { label: 'This FY', from: `${fyStart}-04-01`, to: today },
    { label: 'Everything', from: '', to: '' },
  ]
}

export function RegisterClient({
  kind, rows, from, to, today, group, showValues, failed,
}: {
  kind: RegisterKind
  rows: RegisterRow[]
  from: string
  to: string
  today: string
  group: GroupBy
  showValues: boolean
  failed: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const meta = REGISTER_META[kind]
  const [q, setQ] = useState('')

  const isIn = kind === 'srm-in' || kind === 'vendor-in'
  const isVendor = kind === 'vendor-in' || kind === 'vendor-out'

  function setParams(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v); else p.delete(k)
    }
    router.push(`/warehouse/reports/${kind}?${p.toString()}`)
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r =>
      r.itemName.toLowerCase().includes(needle)
      || (r.party ?? '').toLowerCase().includes(needle)
      || (r.projectName ?? '').toLowerCase().includes(needle)
      || r.entryNo.toLowerCase().includes(needle))
  }, [rows, q])

  const groups = useMemo(() => groupRows(shown, group), [shown, group])
  const totals = useMemo(() => registerTotals(shown), [shown])

  const periodLabel = !from && !to
    ? 'All entries, every period'
    : `${from ? formatDate(from) : 'the beginning'} → ${to ? formatDate(to) : 'today'}`

  const qtyLabel = Object.entries(totals.qtyByUnit)
    .map(([unit, n]) => `${formatQty(n)} ${unit}`)
    .join(' · ')

  function spec(): ExportSpec<RegisterRow> {
    const caveats: string[] = []
    if (isIn) {
      caveats.push('Quantity is GOOD quantity — damaged material never became stock and is shown apart.')
      caveats.push('Short = what the challan promised against what was actually taken in.')
    }
    if (kind === 'vendor-out') {
      caveats.push('Matched to its IN by the party name recorded at the gate.')
    }
    if (showValues) {
      caveats.push('Amount is quantity × the rate on the entry.')
      if (totals.amountPartial) caveats.push('Some lines carry no rate, so the amount understates.')
    }
    return {
      name: `warehouse-${kind}`,
      title: meta.title,
      period: periodLabel,
      notes: [
        `Grouped by ${GROUP_LABEL[group].toLowerCase()}`,
        q.trim() ? `Search: "${q.trim()}"` : '',
      ].filter(Boolean),
      columns: [
        { header: 'Date', cell: r => formatDate(r.day), width: 12 },
        { header: 'Entry', cell: r => r.entryNo, width: 18 },
        ...(isIn ? [{ header: 'PO', cell: (r: RegisterRow) => r.poNo ?? '—', width: 16 }] : []),
        { header: isVendor ? 'Party' : 'Supplier', cell: r => r.party ?? '—', width: 22 },
        { header: 'Item', cell: r => r.itemName, width: 30 },
        { header: 'Category', cell: r => categoryOf(r), width: 18 },
        { header: 'Qty', cell: r => `${formatQty(r.qty)} ${r.unit}`, raw: r => r.qty, align: 'right' },
        ...(isIn
          ? [
              { header: 'Short', cell: (r: RegisterRow) => r.shortQty ? formatQty(r.shortQty) : '—', raw: (r: RegisterRow) => r.shortQty ?? 0, align: 'right' as const },
              { header: 'Damaged', cell: (r: RegisterRow) => r.damagedQty ? formatQty(r.damagedQty) : '—', raw: (r: RegisterRow) => r.damagedQty ?? 0, align: 'right' as const },
              {
                header: 'Differs from IN4',
                cell: (r: RegisterRow) => r.differsFromPo
                  ? `IN4: ${r.orderedText ?? '—'}${r.differNote ? ` · ${r.differNote}` : ''}`
                  : '',
                width: 30,
              },
            ]
          : []),
        { header: 'Project', cell: r => r.projectName ?? '—', width: 20 },
        { header: 'Store', cell: r => r.storeName, width: 20 },
        ...(showValues
          ? [
              { header: 'Rate', cell: (r: RegisterRow) => r.rate == null ? '—' : formatINR(r.rate), raw: (r: RegisterRow) => r.rate, align: 'right' as const },
              { header: 'Amount', cell: (r: RegisterRow) => r.amount == null ? 'no rate' : formatINR(r.amount), raw: (r: RegisterRow) => r.amount, align: 'right' as const, width: 16 },
            ]
          : []),
      ],
      groups: groups.map(g => ({
        label: `${g.label} — ${g.totals.entries} ${g.totals.entries === 1 ? 'entry' : 'entries'}`,
        rows: g.rows,
        footer: footerFor(g.rows.length, g.totals.amount, g.totals.amountPartial),
      })),
      total: footerFor(shown.length, totals.amount, totals.amountPartial, true),
      caveats,
    }

    function footerFor(lines: number, amount: number, partial: boolean, grand = false) {
      const cols: Array<string | number | null> = [
        grand ? 'TOTAL' : 'Subtotal',
        `${lines} ${lines === 1 ? 'line' : 'lines'}`,
      ]
      if (isIn) cols.push('')                                // PO
      cols.push('', '', '')                                  // party, item, category
      cols.push('')                                          // qty (per-unit, shown in the notes)
      if (isIn) cols.push('', '', '')                        // short, damaged, differs-from-IN4
      cols.push('', '')                                      // project, store
      if (showValues) cols.push('', partial ? `${formatINR(amount)} +` : formatINR(amount))
      return cols
    }
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className={labelCls} htmlFor="reg-from">From</label>
            <input id="reg-from" type="date" className={inputCls} value={from} max={today}
              onChange={e => setParams({ from: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-to">To</label>
            <input id="reg-to" type="date" className={inputCls} value={to} max={today}
              onChange={e => setParams({ to: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-group">Group by</label>
            <select id="reg-group" className={inputCls} value={group}
              onChange={e => setParams({ group: e.target.value })}>
              {meta.groupOptions.map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-q">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input id="reg-q" type="search" className={inputCls + ' pl-8'} value={q}
                onChange={e => setQ(e.target.value)} placeholder="Item, party, project, entry no" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2.5 pt-2.5 border-t border-slate-100">
          {quickRanges(today).map(r => {
            const on = from === r.from && to === r.to
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
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btnCls} disabled={shown.length === 0}
              onClick={() => exportXlsx(spec())}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button type="button" className={btnCls} disabled={shown.length === 0}
              onClick={() => exportPdf(spec())}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>
      </Card>

      <div className={`grid gap-2 ${showValues ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
        <Kpi label={totals.entries === 1 ? 'gate entry' : 'gate entries'} value={String(totals.entries)} />
        <Kpi label="item lines" value={String(totals.lines)} />
        <Kpi label="quantity" value={qtyLabel || '—'} small />
        {showValues && (
          <Kpi label="amount" value={formatINR(totals.amount)}
            hint={totals.amountPartial ? 'understated — some lines have no rate' : undefined} />
        )}
      </div>

      {/* The one exception on this register that somebody must actually go and
          fix: IN4 says one thing, the truck brought another. */}
      {isIn && shown.some(r => r.differsFromPo) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <b>{shown.filter(r => r.differsFromPo).length} {shown.filter(r => r.differsFromPo).length === 1 ? 'line was' : 'lines were'} not
          what IN4 ordered.</b> Recorded at the gate as what actually came — needs correcting in IN4 and
          checking against the bill.
        </div>
      )}

      {isIn && (totals.shortQty > 0 || totals.damagedQty > 0) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">
          {totals.shortQty > 0 && (
            <>Short by <b className="tabular-nums">{formatQty(totals.shortQty)}</b> against the challans in this period. </>
          )}
          {totals.damagedQty > 0 && (
            <><b className="tabular-nums">{formatQty(totals.damagedQty)}</b> arrived damaged and was never added to good stock.</>
          )}
        </div>
      )}

      {!failed && rows.length === 0 && (
        <Card className="p-8 text-center shadow-sm space-y-2">
          <p className="text-sm font-bold text-slate-700">Nothing in this register for {periodLabel}.</p>
          <p className="text-[12.5px] text-slate-500 max-w-lg mx-auto">{emptyHint(kind)}</p>
          <Link href={isIn ? '/warehouse/in' : '/warehouse/out'}
            className="inline-block text-[12.5px] font-bold text-emerald-700 hover:text-emerald-900">
            {isIn ? 'Record a Gate IN entry' : 'Record an OUT entry'} →
          </Link>
        </Card>
      )}

      {rows.length > 0 && shown.length === 0 && (
        <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
          Nothing matches “{q.trim()}” in this period.
        </Card>
      )}

      {groups.map(g => (
        <Card key={g.key} className="p-0 shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-slate-50/70 border-b border-slate-100 flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800">{g.label}</span>
            <span className="text-[11.5px] text-slate-500">
              {g.totals.entries} {g.totals.entries === 1 ? 'entry' : 'entries'} · {g.totals.lines} lines
            </span>
            {showValues && g.totals.amount > 0 && (
              <span className="ml-auto text-[12.5px] font-bold tabular-nums text-slate-700">
                {formatINR(g.totals.amount)}{g.totals.amountPartial ? ' +' : ''}
              </span>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead>
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="text-left px-3 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Entry</th>
                  {isIn && <th className="text-left px-2 py-1.5">PO</th>}
                  <th className="text-left px-2 py-1.5">{isVendor ? 'Party' : 'Supplier'}</th>
                  <th className="text-left px-2 py-1.5">Item</th>
                  {group !== 'category' && <th className="text-left px-2 py-1.5">Category</th>}
                  <th className="text-right px-2 py-1.5">Qty</th>
                  {isIn && <th className="text-right px-2 py-1.5">Short</th>}
                  {isIn && <th className="text-right px-2 py-1.5">Dmg</th>}
                  <th className="text-left px-2 py-1.5">Project</th>
                  <th className="text-left px-2 py-1.5">Store</th>
                  {showValues && <th className="text-right px-3 py-1.5">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={`${r.entryId}-${r.itemId}-${i}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(r.day)}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">{r.entryNo}</td>
                    {isIn && <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{r.poNo ?? '—'}</td>}
                    <td className="px-2 py-1.5 text-slate-700">{r.party ?? '—'}</td>
                    <td className="px-2 py-1.5 text-slate-800">
                      {r.itemName}
                      {r.differsFromPo && (
                        <span className="block text-[10.5px] text-amber-800 mt-0.5">
                          not what IN4 ordered{r.orderedText ? <> — IN4 said <i>{r.orderedText}</i></> : ''}
                          {r.differNote ? ` · ${r.differNote}` : ''}
                        </span>
                      )}
                    </td>
                    {group !== 'category' && (
                      <td className="px-2 py-1.5 text-slate-500">{categoryOf(r)}</td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatQty(r.qty)} <span className="font-normal text-slate-400">{r.unit}</span>
                    </td>
                    {isIn && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-rose-600">
                        {r.shortQty ? formatQty(r.shortQty) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {isIn && (
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-amber-700">
                        {r.damagedQty ? formatQty(r.damagedQty) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-slate-600">{r.projectName ?? '—'}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.storeName}</td>
                    {showValues && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 whitespace-nowrap">
                        {r.amount == null ? <span className="text-[11px] text-slate-400">no rate</span> : formatINR(r.amount)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per line. */}
          <div className="md:hidden divide-y divide-slate-50">
            {g.rows.map((r, i) => (
              <div key={`${r.entryId}-${r.itemId}-${i}`} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 break-words">{r.itemName}</span>
                  <span className="text-[13.5px] font-extrabold tabular-nums text-slate-900 flex-shrink-0 whitespace-nowrap">
                    {formatQty(r.qty)} <span className="text-[11px] font-normal text-slate-400">{r.unit}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap text-[11.5px] text-slate-500">
                  <span className="font-mono text-[10.5px]">{r.entryNo}</span>
                  <span>{formatDate(r.day)}</span>
                  {r.party && <span className="truncate max-w-[45%]">{r.party}</span>}
                  {r.projectName && <span className="truncate max-w-[45%]">{r.projectName}</span>}
                </div>
                {(r.shortQty || r.damagedQty || (showValues && r.amount != null)) && (
                  <div className="mt-1 flex items-baseline gap-x-3 flex-wrap text-[11.5px] tabular-nums">
                    {r.shortQty ? <span className="font-bold text-rose-600">short {formatQty(r.shortQty)}</span> : null}
                    {r.damagedQty ? <span className="font-bold text-amber-700">damaged {formatQty(r.damagedQty)}</span> : null}
                    {showValues && r.amount != null && (
                      <span className="ml-auto font-semibold text-slate-700">{formatINR(r.amount)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {groups.length > 1 && showValues && (
        <Card className="p-3 shadow-sm bg-slate-50/60">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[12.5px] font-extrabold text-slate-700">Total — {periodLabel}</span>
            <span className="text-[11.5px] text-slate-500">{qtyLabel}</span>
            <span className="ml-auto text-[15px] font-extrabold tabular-nums text-slate-900">
              {formatINR(totals.amount)}{totals.amountPartial ? ' +' : ''}
            </span>
          </div>
          {totals.amountPartial && (
            <p className="text-[11px] text-slate-500 mt-1">
              Some lines have no rate on record, so the total understates — that is what the “+” means.
            </p>
          )}
        </Card>
      )}

      <p className="text-[11px] text-slate-400 px-1">
        {isIn
          ? 'Quantity is good quantity: damaged material never became stock and is shown in its own column.'
          : kind === 'vendor-out'
            ? 'Matched to what he brought in by the party name recorded at the gate.'
            : 'What sites actually consumed. Store moves and vendor returns are not in here — neither is consumption.'}
      </p>
    </div>
  )
}

function Kpi({ label, value, hint, small }: { label: string; value: string; hint?: string; small?: boolean }) {
  return (
    <Card className="p-3 shadow-sm">
      <div className={`font-extrabold tabular-nums text-slate-800 ${small ? 'text-[13px] leading-tight' : 'text-lg'}`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</div>}
    </Card>
  )
}

function emptyHint(kind: RegisterKind): string {
  switch (kind) {
    case 'vendor-in':
      return 'This register only shows material a vendor brought under his own name — a Gate IN entry marked "Vendor" rather than "SRM". Purchases we paid for are in SRM IN.'
    case 'vendor-out':
      return 'This shows a vendor taking his own material back, recorded on the OUT screen with "Back to vendor" as the destination.'
    case 'srm-in':
      return 'This register shows what we bought and took in — Gate IN entries marked "SRM".'
    case 'srm-out':
      return 'This register shows what went out to a site to be used. Store moves and vendor returns are deliberately excluded, because neither is consumption.'
  }
}
