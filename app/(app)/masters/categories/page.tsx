import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadCategoryMaster, type Category } from '@/lib/revamp/masters-in4'

export const dynamic = 'force-dynamic'

/**
 * Budget Categories — IN4's main categories and their sub-categories, the
 * same two levels every budget, work order and bill in IN4 is filed under.
 * Work orders are counted against each so a category that is only a name
 * reads as such. Sub-categories open under their main; IN4's inactive ones
 * are shown only when asked for, greyed.
 */
export default async function CategoriesMasterPage({ searchParams }: { searchParams: Promise<{ inactive?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { inactive } = await searchParams
  const showInactive = inactive === '1'
  const { mains, counts } = await loadCategoryMaster()
  const visible = showInactive ? mains : mains
    .filter(m => m.isActive || m.subs.some(s => s.isActive))
    .map(m => ({ ...m, subs: m.subs.filter(s => s.isActive) }))

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <PageHeader
          title="Budget Categories"
          subtitle={`${counts.mains} main categories, ${counts.subs} sub-categories — IN4’s own list, as budgets and orders use it.`}
        />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="grid grid-cols-3 gap-2 flex-1 min-w-[280px]">
            <Kpi label="Main categories" value={counts.mains} />
            <Kpi label="Sub-categories" value={counts.subs} />
            <Kpi label="Inactive in IN4" value={counts.inactive} />
          </div>
          <Link
            href={showInactive ? '/masters/categories' : '/masters/categories?inactive=1'}
            className="text-[13px] font-semibold text-indigo-700 hover:underline min-h-[44px] inline-flex items-center px-2"
          >
            {showInactive ? 'Hide inactive' : `Show the ${counts.inactive} inactive too`}
          </Link>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {visible.map(m => <MainRow key={m.id} m={m} />)}
        </div>
      </div>
    </RowDetailProvider>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="text-[15px] font-semibold tabular-nums text-gray-900">{value.toLocaleString('en-IN')}</p>
    </div>
  )
}

function MainRow({ m }: { m: Category }) {
  return (
    <div>
      <div className={`px-3 py-2 flex items-center gap-1 text-[13px] ${m.isActive ? '' : 'text-gray-400'}`}>
        <RowDetailToggle id={`cat:${m.id}`} count={m.subs.length} />
        {m.code && <span className="font-mono text-[12px] text-gray-500 w-9 flex-shrink-0">{m.code}</span>}
        <span className={`font-semibold ${m.isActive ? 'text-gray-900' : ''}`}>{m.name.replace(/^\d+\s+/, '')}</span>
        {m.shortName && m.shortName !== m.name && <span className="text-[12px] text-gray-400 hidden sm:inline">{m.shortName}</span>}
        {!m.isActive && <span className="text-[11px] rounded border border-gray-300 px-1">inactive</span>}
        <span className="ml-auto text-[12px] text-gray-500 tabular-nums whitespace-nowrap">
          {m.subs.length} sub · {m.workOrders.toLocaleString('en-IN')} WO{m.workOrders === 1 ? '' : 's'}
        </span>
      </div>
      <RowDetail id={`cat:${m.id}`}>
        <ul className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
          {m.subs.map(s => (
            <li key={s.id} className={`pl-10 pr-3 py-1.5 text-[12px] flex items-center gap-2 ${s.isActive ? '' : 'text-gray-400'}`}>
              {s.code && <span className="font-mono text-gray-500 w-12 flex-shrink-0">{s.code}</span>}
              <span className={s.isActive ? 'text-gray-900' : ''}>{s.name.replace(/^\d+\s+/, '')}</span>
              {!s.isActive && <span className="text-[11px] rounded border border-gray-300 px-1">inactive</span>}
              <span className="ml-auto tabular-nums text-gray-500 whitespace-nowrap">{s.workOrders.toLocaleString('en-IN')} WO{s.workOrders === 1 ? '' : 's'}</span>
            </li>
          ))}
          {m.subs.length === 0 && <li className="pl-10 pr-3 py-1.5 text-[12px] text-gray-500 italic">No sub-categories under this one in IN4.</li>}
        </ul>
      </RowDetail>
    </div>
  )
}
