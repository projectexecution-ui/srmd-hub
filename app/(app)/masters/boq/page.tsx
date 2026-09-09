import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadBoqOverview, loadBoqCategory, loadBoqSearch, matchesQuery, lastOrderLinks, type BoqGroup, type BoqItem } from '@/lib/revamp/masters-in4'
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
 * appeared in and the rates it was ordered at. Live from IN4.
 *
 * Aksha, 10 Sep 2026: "unable to find any BOQ properly … link it to the last
 * used WO." So: a search box on the first screen that looks across every
 * category, and on every item the last work order it was on — contractor,
 * date, rate — with the WO itself (IN4's print), and the project's WO / PO
 * tab when the sub-project is linked.
 */
export default async function BoqMasterPage({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { cat, q = '' } = await searchParams
  const catId = cat == null ? null : Number(cat)
  if (catId != null && Number.isInteger(catId) && catId >= 0) return <CategoryView id={catId} q={q} />
  if (q.trim()) return <SearchView q={q} />
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
      <MasterSearchBox action="/masters/boq" initial="" placeholder="Find a BOQ item in any category — e.g. plaster, epoxy grouting, PCC…" />
      <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>IN4 has no separate BOQ master; its BOQ items live inside work orders. Type an item above to find it across every category, or open a category to browse. Every item shows the last work order it was on, with the contractor, the date and the rate — and opens that WO.</span>
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
        searchPlaceholder="Filter the categories…"
        emptyMessage={in4 === 'live' ? 'IN4 holds no work-order BOQ items.' : 'The BOQ items are read live from IN4, which was not reached.'}
      />
    </div>
  )
}

/** Items across every category that match the words typed, newest work order first. */
async function SearchView({ q }: { q: string }) {
  const { items, capped, in4, in4Error } = await loadBoqSearch(q)
  return (
    <div className="space-y-4">
      <Link href="/masters/boq" className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[44px]">
        <ArrowLeft className="h-3.5 w-3.5" /> All categories
      </Link>
      <PageHeader title="BOQ Master" subtitle={`${items.length.toLocaleString('en-IN')}${capped ? '+' : ''} BOQ item${items.length === 1 ? '' : 's'} match “${q}” — newest work order first.`} />
      <In4Note in4={in4} error={in4Error} what="the BOQ items" />
      <MasterSearchBox action="/masters/boq" initial={q} placeholder="Find a BOQ item in any category…" />
      {capped && <p className="text-[12px] text-amber-700">Only the first 300 are shown — add a word to narrow it.</p>}
      <div className="rounded-lg border border-gray-200 bg-white">
        <ItemsTable items={items} showCategory />
        {items.length === 0 && in4 === 'live' && <p className="px-4 py-8 text-center text-[13px] text-gray-500">No BOQ item in IN4 matches “{q}”. Try one word, or a different spelling.</p>}
      </div>
    </div>
  )
}

async function CategoryView({ id, q }: { id: number; q: string }) {
  const { category, groups, in4, in4Error } = await loadBoqCategory(id)
  const needle = q.trim()
  const shown = needle
    ? groups
      .map(g => matchesQuery(needle, g.name) ? g : { ...g, items: g.items.filter(it => matchesQuery(needle, it.subname, it.description, it.subcategory, it.last?.party, it.last?.ref)) })
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
        <MasterSearchBox action="/masters/boq" initial={q} keep={{ cat: String(id) }} placeholder="Search an item in this category by name, description or contractor…" />
        {needle && <p className="text-[12px] text-gray-500">{shown.reduce((t, g) => t + g.items.length, 0).toLocaleString('en-IN')} item{shown.reduce((t, g) => t + g.items.length, 0) === 1 ? '' : 's'} match “{needle}” in {shown.length} BOQ name{shown.length === 1 ? '' : 's'} · <Link href={`/masters/boq?q=${encodeURIComponent(needle)}`} className="text-indigo-700 hover:underline">search every category</Link></p>}

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {shown.map(g => <Group key={g.name} g={g} open={!!needle} />)}
          {shown.length === 0 && in4 === 'live' && (
            <p className="px-4 py-8 text-center text-[13px] text-gray-500">
              {needle ? <>Nothing here matches “{needle}”. <Link href={`/masters/boq?q=${encodeURIComponent(needle)}`} className="text-indigo-700 hover:underline">Search every category</Link>.</> : 'IN4 holds no work-order BOQ items under this category.'}
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

/** The last work order, as one cell: who · when · at what rate, with the links. */
function LastWo({ it }: { it: BoqItem }) {
  const o = it.last
  if (!o) return <span className="text-gray-400">—</span>
  const links = lastOrderLinks(o)
  return (
    <span className="block text-[12px]">
      <span className="text-gray-900">{o.party ?? 'contractor not named'}</span>
      <span className="block text-[11px] text-gray-500 tabular-nums">{[o.date ? formatDate(o.date) : null, o.rate != null ? `@ ${formatINR(o.rate)}` : null, o.project].filter(Boolean).join(' · ')}</span>
      <span className="block text-[11px] mt-0.5">
        {links.map((l, i) => (
          <span key={l.href}>
            {i > 0 && <span className="text-gray-300"> · </span>}
            {l.external ? <a href={l.href} target="_blank" rel="noopener" className="text-indigo-700 hover:underline">{l.label}</a> : <Link href={l.href} className="text-indigo-700 hover:underline">{l.label}</Link>}
          </span>
        ))}
      </span>
    </span>
  )
}

function ItemsTable({ items, showCategory = false, indent = false }: { items: BoqItem[]; showCategory?: boolean; indent?: boolean }) {
  const pl = indent ? 'pl-10' : 'pl-3'
  return (
    <>
      {/* Desktop */}
      <table className="w-full text-[12px] hidden md:table table-fixed">
        <thead className="text-left uppercase tracking-wide text-gray-400">
          <tr>
            <th className={`${pl} pr-2 py-1.5 w-[40%]`}>Item</th>
            <th className="px-2 py-1.5 w-[7%]">Unit</th>
            <th className="px-2 py-1.5 w-[9%] text-right">Used in</th>
            <th className="px-2 py-1.5 w-[16%] text-right">Rate (min – max)</th>
            <th className="px-2 py-1.5 w-[28%]">Last work order</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-gray-100 align-top">
              <td className={`${pl} pr-2 py-1.5`}>
                {it.subname && <p className="font-medium text-gray-900">{it.subname}</p>}
                {it.description && it.description !== it.subname && <p className="text-gray-600">{it.description}</p>}
                <p className="text-[11px] text-gray-400">{[showCategory ? it.category?.replace(/^\d+\s+/, '') : null, showCategory && it.name ? it.name : null, it.subcategory?.replace(/^\d+\s+/, '')].filter(Boolean).join(' › ')}</p>
                {it.workOrders > 1 && it.subname && <Link href={`/masters/rates?view=boq&q=${encodeURIComponent(it.subname.slice(0, 60))}`} className="text-[11px] text-indigo-700 hover:underline">who charged what →</Link>}
              </td>
              <td className="px-2 py-1.5 text-gray-700">{it.uom ?? '—'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{it.workOrders} WO{it.workOrders === 1 ? '' : 's'}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-900">{rateRange(it.minRate, it.maxRate)}</td>
              <td className="px-2 py-1.5"><LastWo it={it} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile — the same items as cards. */}
      <ul className="md:hidden divide-y divide-gray-100">
        {items.map((it, i) => (
          <li key={i} className={`${pl} pr-3 py-2 text-[12px]`}>
            {it.subname && <p className="font-medium text-gray-900">{it.subname}</p>}
            {it.description && it.description !== it.subname && <p className="text-gray-600">{it.description}</p>}
            {showCategory && <p className="text-[11px] text-gray-400">{[it.category?.replace(/^\d+\s+/, ''), it.name].filter(Boolean).join(' › ')}</p>}
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-gray-700">
              <span><span className="text-gray-400">Unit </span>{it.uom ?? '—'}</span>
              <span><span className="text-gray-400">Used in </span>{it.workOrders} WO{it.workOrders === 1 ? '' : 's'}</span>
              <span><span className="text-gray-400">Rate </span>{rateRange(it.minRate, it.maxRate)}</span>
            </p>
            <div className="mt-1"><span className="text-[11px] text-gray-400">Last WO </span><LastWo it={it} /></div>
          </li>
        ))}
      </ul>
    </>
  )
}

function Group({ g, open }: { g: BoqGroup; open: boolean }) {
  const key = `boq:${g.name}`
  const body = <div className="bg-slate-50/60 border-t border-gray-100"><ItemsTable items={g.items} indent /></div>
  return (
    <div>
      <div className="px-3 py-2 flex items-center gap-1 text-[13px]">
        {open ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={key} count={g.items.length} label="BOQ items" />}
        <span className="font-semibold text-gray-900">{g.name}</span>
        <span className="ml-auto text-[12px] text-gray-500 tabular-nums whitespace-nowrap">
          {g.items.length} item{g.items.length === 1 ? '' : 's'} · used in {g.workOrders.toLocaleString('en-IN')} WO{g.workOrders === 1 ? '' : 's'}
        </span>
      </div>
      {open ? body : <RowDetail id={key}>{body}</RowDetail>}
    </div>
  )
}
