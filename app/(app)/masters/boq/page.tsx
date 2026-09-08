import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadBoqOverview, loadBoqCategory, matchesQuery, type BoqGroup } from '@/lib/revamp/masters-in4'
import { formatINR, formatDate } from '@/lib/utils'
import { MasterTable } from '../MasterTable'
import { In4Note } from '../In4Note'
import { MasterSearchBox } from '../MasterSearchBox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * BOQ Master. IN4 keeps no BOQ master table — a BOQ item exists only inside
 * a work order. What IN4 does hold is every item ever ordered: 1,388 BOQ
 * names, 7,286 descriptions, each under a category, with the work orders it
 * appeared in and the rates it was ordered at. That is shown, by category,
 * and named for what it is. Live from IN4. A search inside a category shows
 * the matching items open.
 */
export default async function BoqMasterPage({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { cat, q = '' } = await searchParams
  const catId = cat == null ? null : Number(cat)
  if (catId != null && Number.isInteger(catId) && catId >= 0) return <CategoryView id={catId} q={q} />
  return <Overview />
}

async function Overview() {
  const { categories, totals, in4, in4Error } = await loadBoqOverview()
  return (
    <div className="space-y-4">
      <PageHeader
        title="BOQ Master"
        subtitle={`${totals.items.toLocaleString('en-IN')} BOQ items under ${totals.names.toLocaleString('en-IN')} BOQ names, from every work order in IN4.`}
      />
      <In4Note in4={in4} error={in4Error} what="the BOQ items" />
      <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>IN4 has no separate BOQ master; its BOQ items live inside work orders. This is every item ever ordered, by category — open a category to see each item with how many work orders used it and at what rates. To find one item by name, use <Link href="/masters/search" className="text-indigo-700 hover:underline">Search</Link>.</span>
      </p>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Categories', n: categories.length },
          { label: 'BOQ names', n: totals.names },
          { label: 'Items (distinct descriptions)', n: totals.items },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label}</p>
            <p className="text-[15px] font-semibold tabular-nums text-gray-900">{s.n.toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>

      <MasterTable
        columns={[
          { key: 'name', label: 'Category' },
          { key: 'names', label: 'BOQ names', align: 'right', width: 'w-28' },
          { key: 'items', label: 'Items', align: 'right', width: 'w-24' },
          { key: 'wos', label: 'Work orders', align: 'right', width: 'w-32' },
        ]}
        sortableKeys={['name', 'names', 'items', 'wos']}
        rows={categories.map(c => ({
          id: String(c.id),
          href: `/masters/boq?cat=${c.id}`,
          cells: {
            name: { text: c.name.replace(/^\d+\s+/, ''), tone: 'strong', sub: c.code ?? undefined },
            names: { text: c.names.toLocaleString('en-IN') },
            items: { text: c.items.toLocaleString('en-IN') },
            wos: { text: c.workOrders.toLocaleString('en-IN') },
          },
        }))}
        exportName="boq-categories"
        searchPlaceholder="Search a category…"
        emptyMessage={in4 === 'live' ? 'IN4 holds no work-order BOQ items.' : 'The BOQ items are read live from IN4, which was not reached.'}
      />
    </div>
  )
}

async function CategoryView({ id, q }: { id: number; q: string }) {
  const { category, groups, in4, in4Error } = await loadBoqCategory(id)
  const needle = q.trim()
  const shown = needle
    ? groups
      .map(g => matchesQuery(needle, g.name) ? g : { ...g, items: g.items.filter(it => matchesQuery(needle, it.subname, it.description, it.subcategory)) })
      .filter(g => g.items.length > 0)
    : groups
  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <Link href="/masters/boq" className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[44px]">
          <ArrowLeft className="h-3.5 w-3.5" /> All categories
        </Link>
        <PageHeader
          title={category ? category.name.replace(/^\d+\s+/, '') : 'Category'}
          subtitle={category
            ? `${category.items.toLocaleString('en-IN')} BOQ items under ${category.names.toLocaleString('en-IN')} BOQ names, from IN4’s work orders.`
            : 'No BOQ items under this category in IN4.'}
        />
        <In4Note in4={in4} error={in4Error} what="the BOQ items" />
        <MasterSearchBox action="/masters/boq" initial={q} keep={{ cat: String(id) }} placeholder="Search an item in this category by name or description…" />
        {needle && <p className="text-[12px] text-gray-500">{shown.reduce((t, g) => t + g.items.length, 0).toLocaleString('en-IN')} item{shown.reduce((t, g) => t + g.items.length, 0) === 1 ? '' : 's'} match “{needle}” in {shown.length} BOQ name{shown.length === 1 ? '' : 's'}</p>}

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {shown.map(g => <Group key={g.name} g={g} open={!!needle} />)}
          {shown.length === 0 && in4 === 'live' && (
            <p className="px-4 py-8 text-center text-[13px] text-gray-500">
              {needle ? <>Nothing here matches “{needle}”. <Link href={`/masters/search?q=${encodeURIComponent(needle)}`} className="text-indigo-700 hover:underline">Search all masters</Link>.</> : 'IN4 holds no work-order BOQ items under this category.'}
            </p>
          )}
        </div>
      </div>
    </RowDetailProvider>
  )
}

const rateRange = (a: number | null, b: number | null) => {
  if (a == null && b == null) return '—'
  if (a == null || b == null || Math.abs(a - b) < 0.005) return formatINR(a ?? b ?? 0)
  return `${formatINR(a)} – ${formatINR(b)}`
}

function Items({ g }: { g: BoqGroup }) {
  return (
    <div className="bg-slate-50/60 border-t border-gray-100">
      {/* Desktop */}
      <table className="w-full text-[12px] hidden md:table table-fixed">
        <thead className="text-left uppercase tracking-wide text-gray-400">
          <tr>
            <th className="pl-10 pr-2 py-1.5 w-[52%]">Item</th>
            <th className="px-2 py-1.5 w-[8%]">Unit</th>
            <th className="px-2 py-1.5 w-[10%] text-right">Used in</th>
            <th className="px-2 py-1.5 w-[18%] text-right">Rate (min – max)</th>
            <th className="px-2 py-1.5 w-[12%] text-right">Last ordered</th>
          </tr>
        </thead>
        <tbody>
          {g.items.map((it, i) => (
            <tr key={i} className="border-t border-gray-100 align-top">
              <td className="pl-10 pr-2 py-1.5">
                {it.subname && <p className="font-medium text-gray-900">{it.subname}</p>}
                {it.description && it.description !== it.subname && <p className="text-gray-600">{it.description}</p>}
                {it.subcategory && <p className="text-[11px] text-gray-400">{it.subcategory.replace(/^\d+\s+/, '')}</p>}
              </td>
              <td className="px-2 py-1.5 text-gray-700">{it.uom ?? '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{it.workOrders} WO{it.workOrders === 1 ? '' : 's'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{rateRange(it.minRate, it.maxRate)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{it.lastUsed ? formatDate(it.lastUsed) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile — the same items as cards. */}
      <ul className="md:hidden divide-y divide-gray-100">
        {g.items.map((it, i) => (
          <li key={i} className="pl-10 pr-3 py-2 text-[12px]">
            {it.subname && <p className="font-medium text-gray-900">{it.subname}</p>}
            {it.description && it.description !== it.subname && <p className="text-gray-600">{it.description}</p>}
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-gray-700">
              <span><span className="text-gray-400">Unit </span>{it.uom ?? '—'}</span>
              <span><span className="text-gray-400">Used in </span>{it.workOrders} WO{it.workOrders === 1 ? '' : 's'}</span>
              <span><span className="text-gray-400">Rate </span>{rateRange(it.minRate, it.maxRate)}</span>
              {it.lastUsed && <span><span className="text-gray-400">Last </span>{formatDate(it.lastUsed)}</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Group({ g, open }: { g: BoqGroup; open: boolean }) {
  const key = `boq:${g.name}`
  return (
    <div>
      <div className="px-3 py-2 flex items-center gap-1 text-[13px]">
        {open ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={g.items.length} label="BOQ items" />}
        <span className="font-semibold text-gray-900">{g.name}</span>
        <span className="ml-auto text-[12px] text-gray-500 tabular-nums whitespace-nowrap">
          {g.items.length} item{g.items.length === 1 ? '' : 's'} · used in {g.workOrders.toLocaleString('en-IN')} WO{g.workOrders === 1 ? '' : 's'}
        </span>
      </div>
      {open ? <Items g={g} /> : <RowDetail id={key}><Items g={g} /></RowDetail>}
    </div>
  )
}
