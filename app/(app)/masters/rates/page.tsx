import Link from 'next/link'
import { Info, FileText } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { searchMaterialRates, loadMaterialRateOverview, searchBoqRates, type MaterialRates } from '@/lib/revamp/rates'
import { formatINR, formatDate } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../MasterTable'
import { MasterSearchBox } from '../MasterSearchBox'
import { ViewPills } from '../ViewPills'
import { In4Note } from '../In4Note'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const qty = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const rate = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * Rates — what SRMD actually paid, from IN4's own orders. The engineer's
 * question before an indent or a BOQ ("what did we pay last time, to whom?")
 * and the Head's ("are we paying two prices for one thing?"), answered from
 * every PO line and every work-order BOQ line IN4 holds.
 */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; spread?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '', view, spread } = await searchParams
  const boq = view === 'boq'
  const pills = (
    <ViewPills base="/masters/rates" view={boq ? 'boq' : 'materials'} keep={{ q }} options={[
      { key: 'materials', label: 'Material purchase rates' },
      { key: 'boq', label: 'BOQ work rates' },
    ]} />
  )
  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <PageHeader
          title="Rates"
          subtitle="What we actually paid — every purchase order line and every work-order BOQ line in IN4, grouped the way the question is asked."
        />
        {pills}
        {boq ? <BoqRates q={q} /> : <MaterialRatesView q={q} onlySpread={spread === '1'} />}
      </div>
    </RowDetailProvider>
  )
}

async function MaterialRatesView({ q, onlySpread }: { q: string; onlySpread: boolean }) {
  if (q.trim()) {
    const { materials, in4, in4Error } = await searchMaterialRates(q)
    return (
      <>
        <MasterSearchBox action="/masters/rates" initial={q} placeholder="Search a material by name or code — e.g. cement, GI pipe, Pidilite…" />
        <In4Note in4={in4} error={in4Error} what="purchase rates" />
        {in4 === 'live' && materials.length === 0 && (
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            No purchase order in IN4 carries a material matching “{q}”. <Link href={`/masters/items?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">Look in the Item master</Link> — it may exist there without ever being bought.
          </p>
        )}
        <p className="text-[12px] text-gray-500">{materials.length} material{materials.length === 1 ? '' : 's'} match, {materials.reduce((t, m) => t + m.lines.length, 0).toLocaleString('en-IN')} PO lines. Biggest spend first.</p>
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {materials.map(m => <MaterialCard key={m.materialId} m={m} open={materials.length <= 3} />)}
        </div>
      </>
    )
  }
  const { rows, in4, in4Error } = await loadMaterialRateOverview()
  const shown = onlySpread ? rows.filter(r => r.suppliers > 1 && r.spread >= 0.2) : rows
  const table: MasterRow[] = shown.map(r => ({
    id: String(r.materialId),
    href: `/masters/rates?q=${encodeURIComponent(r.material)}`,
    tone: r.suppliers > 1 && r.spread >= 0.2 ? 'warn' : undefined,
    cells: {
      material: { text: r.material, tone: 'strong', sub: r.uom ?? undefined },
      spend: { text: formatINR(r.spend) },
      lines: { text: `${r.lines} line${r.lines === 1 ? '' : 's'}`, sub: `${r.suppliers} supplier${r.suppliers === 1 ? '' : 's'}` },
      range: { text: r.minRate === r.maxRate ? rate(r.minRate) : `${rate(r.minRate)} – ${rate(r.maxRate)}`, tone: r.suppliers > 1 && r.spread >= 0.2 ? 'warn' : 'default', sub: r.suppliers > 1 && r.spread >= 0.2 ? `${Math.round(r.spread * 100)}% apart` : undefined },
      last: { text: r.lastDate ? formatDate(r.lastDate) : '—', tone: 'muted' },
    },
  }))
  return (
    <>
      <MasterSearchBox action="/masters/rates" initial={q} placeholder="Search a material by name or code — e.g. cement, GI pipe, Pidilite…" />
      <In4Note in4={in4} error={in4Error} what="purchase rates" />
      <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>The 300 materials SRMD has spent most on. Amber rows were bought from more than one supplier at rates 20% or more apart — open one to see who charged what. Type a name to see any material’s full history.</span>
      </p>
      <MasterTable
        columns={[
          { key: 'material', label: 'Material' },
          { key: 'spend', label: 'Spent', align: 'right', width: 'w-32' },
          { key: 'lines', label: 'PO lines', width: 'w-32' },
          { key: 'range', label: 'Rate (min – max)', align: 'right', width: 'w-48' },
          { key: 'last', label: 'Last bought', width: 'w-28' },
        ]}
        sortableKeys={['material', 'spend', 'last']}
        rows={table}
        filters={[{ key: 'spread', label: 'Two prices for one thing', test: r => r.tone === 'warn' }]}
        exportName="material-rates"
        searchPlaceholder="Narrow this list…"
        emptyMessage="No purchase rates in IN4."
      />
    </>
  )
}

function MaterialCard({ m, open }: { m: MaterialRates; open: boolean }) {
  const key = `rate:${m.materialId}`
  const wide = m.suppliers.length > 1 && m.spread >= 0.2
  return (
    <div>
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
        {open ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={m.lines.length} label="purchase lines" />}
        <span className="font-semibold text-gray-900">{m.material}</span>
        {m.uom && <span className="text-[12px] text-gray-500">per {m.uom}</span>}
        <span className="tabular-nums text-gray-800">Last {m.lastRate != null ? rate(m.lastRate) : '—'}{m.lastDate ? ` on ${formatDate(m.lastDate)}` : ''}{m.lastSupplier ? ` from ${m.lastSupplier}` : ''}</span>
        <span className={`tabular-nums ${wide ? 'text-amber-700 font-semibold' : 'text-gray-600'}`}>Range {m.minRate === m.maxRate ? rate(m.minRate) : `${rate(m.minRate)} – ${rate(m.maxRate)}`}{wide ? ` (${Math.round(m.spread * 100)}% apart)` : ''}</span>
        <span className="tabular-nums text-gray-600">Avg {rate(m.avgRate)}</span>
        <span className="text-gray-600">{m.suppliers.length} supplier{m.suppliers.length === 1 ? '' : 's'}</span>
        {m.cheapest && <span className="text-emerald-700">Cheapest: {m.cheapest.supplier} at {rate(m.cheapest.rate)}</span>}
        <span className="ml-auto tabular-nums text-gray-500">{m.lines.length} PO line{m.lines.length === 1 ? '' : 's'} · {formatINR(m.spend)}</span>
      </div>
      {open ? <Lines m={m} /> : <RowDetail id={key}><Lines m={m} /></RowDetail>}
    </div>
  )
}

function Lines({ m }: { m: MaterialRates }) {
  return (
    <div className="bg-slate-50/60 border-t border-gray-100">
      <table className="w-full text-[12px] hidden md:table">
        <thead className="text-left uppercase tracking-wide text-gray-400">
          <tr><th className="pl-10 pr-2 py-1.5">Date</th><th className="px-2 py-1.5">PO</th><th className="px-2 py-1.5">Supplier</th><th className="px-2 py-1.5">Project</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Rate</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5" /></tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="pl-10 pr-2 py-1.5 text-gray-600">{l.date ? formatDate(l.date) : '—'}</td>
              <td className="px-2 py-1.5 font-mono text-gray-800">{l.poNo ?? l.poId}</td>
              <td className="px-2 py-1.5 text-gray-800">{l.supplierId ? <Link href={`/masters/contacts/supplier/${l.supplierId}`} className="hover:underline">{l.supplier}</Link> : l.supplier}</td>
              <td className="px-2 py-1.5 text-gray-600">{l.project}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.qty)}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${l.rate === m.minRate && m.minRate !== m.maxRate ? 'text-emerald-700' : l.rate === m.maxRate && m.minRate !== m.maxRate ? 'text-amber-700' : 'text-gray-900'}`}>{rate(l.rate)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{formatINR(l.value)}</td>
              <td className="px-2 py-1.5 text-right"><a href={`/api/in4/purchase-order/${l.poId}/print`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-indigo-700 hover:underline"><FileText className="h-3 w-3" /> PO</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden divide-y divide-gray-100">
        {m.lines.map((l, i) => (
          <li key={i} className="pl-10 pr-3 py-2 text-[12px]">
            <p className="flex flex-wrap gap-x-2"><span className="font-mono text-gray-800">{l.poNo ?? l.poId}</span><span className="text-gray-500">{l.date ? formatDate(l.date) : ''}</span><span className="ml-auto font-semibold tabular-nums">{rate(l.rate)}</span></p>
            <p className="text-gray-600">{l.supplier}{l.project ? ` · ${l.project}` : ''} · {qty(l.qty)} = {formatINR(l.value)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

async function BoqRates({ q }: { q: string }) {
  const { lines, capped, in4, in4Error } = await searchBoqRates(q)
  const rates = lines.map(l => l.rate)
  const min = rates.length ? Math.min(...rates) : 0, max = rates.length ? Math.max(...rates) : 0
  const table: MasterRow[] = lines.map((l, i) => ({
    id: `${l.woId}:${i}`,
    cells: {
      item: { text: l.subname ?? l.description ?? '', tone: 'strong', sub: l.description && l.description !== l.subname ? l.description : undefined },
      wo: { text: l.woNo ?? String(l.woId), mono: true, sub: l.date ? formatDate(l.date) : undefined },
      contractor: { text: l.contractor ?? '', sub: l.project ?? undefined },
      qty: { text: `${qty(l.qty)} ${l.uom ?? ''}` },
      rate: { text: rate(l.rate), tone: l.rate === min && min !== max ? 'good' : l.rate === max && min !== max ? 'warn' : 'strong' },
    },
  }))
  return (
    <>
      <MasterSearchBox action="/masters/rates" initial={q} keep={{ view: 'boq' }} placeholder="Search a BOQ item by name or description — e.g. waterproofing, plaster, RCC…" />
      <In4Note in4={in4} error={in4Error} what="work rates" />
      {!q.trim() ? (
        <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>Type what the work is called and every work-order line matching it comes back — contractor, project, date, quantity and rate — newest first, the lowest rate green and the highest amber. For the full list of items by category, see <Link href="/masters/boq" className="text-indigo-700 hover:underline">BOQ Master</Link>.</span>
        </p>
      ) : (
        <>
          <p className="text-[12px] text-gray-500">
            {lines.length} work-order line{lines.length === 1 ? '' : 's'} match “{q}”{capped ? ' (the newest 400 — narrow the search for older ones)' : ''}
            {lines.length > 1 && ` · rates from ${rate(min)} to ${rate(max)}`}
          </p>
          <MasterTable
            columns={[
              { key: 'item', label: 'BOQ item' },
              { key: 'wo', label: 'Work order', width: 'w-44' },
              { key: 'contractor', label: 'Contractor · project' },
              { key: 'qty', label: 'Qty', align: 'right', width: 'w-28' },
              { key: 'rate', label: 'Rate', align: 'right', width: 'w-28' },
            ]}
            sortableKeys={['item', 'wo', 'contractor', 'rate']}
            rows={table}
            exportName={`boq-rates-${q.trim().replace(/[^a-z0-9]+/gi, '-')}`}
            searchPlaceholder="Narrow these lines…"
            emptyMessage={`No work-order line in IN4 matches “${q}”.`}
          />
        </>
      )}
    </>
  )
}
