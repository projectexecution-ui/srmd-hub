import Link from 'next/link'
import { requirePermission, getMyPermissions, getMyUser, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import {
  getLocationTree, getPostableSpots, getStockRows, getReceivers,
  getRecentCounts, peekNextEntryNo, one,
} from '@/lib/warehouse/data'
import { formatDate } from '@/lib/utils'
import { SCOPE_LABEL } from '@/lib/warehouse/count'
import type { CountScope } from '@/lib/warehouse/count'
import { CountStart } from './count-start'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  counting:  'bg-amber-100 text-amber-800',
  submitted: 'bg-sky-100 text-sky-800',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-rose-100 text-rose-700',
}
const STATUS_LABEL: Record<string, string> = {
  counting: 'being counted', submitted: 'waiting for approval',
  approved: 'approved', rejected: 'sent back',
}

export default async function CountListPage() {
  await requirePermission('warehouse', 'view')
  const [perms, me] = await Promise.all([getMyPermissions(), getMyUser()])
  const canEdit = can(perms, 'warehouse', 'edit')

  const sites = await getLocationTree()
  const [scoping, stock, receivers, recent, nextNo] = await Promise.all([
    getPostableSpots(sites),
    getStockRows(),
    getReceivers(),
    getRecentCounts(),
    peekNextEntryNo('count'),
  ])

  // How much a count of each store would be, shown before he commits to walking
  // it — "39 items" is the difference between doing it now and putting it off.
  const held = new Map<string, number>()
  for (const s of stock) {
    if (s.qty > 0) held.set(s.locationId, (held.get(s.locationId) ?? 0) + 1)
  }

  const openMine = recent.rows.filter(r => r.status === 'counting')
  const waiting = recent.rows.filter(r => r.status === 'submitted')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Physical count"
        subtitle="Walk a store and count what is actually on the shelf. The book quantity is what the register believes — the difference between the two is the only honest measure of what it is missing."
      />

      {!canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          You can see counts but not run one. Ask an admin for edit access on Warehouse V2.
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,400px)_1fr] gap-4 items-start">
        <CountStart
          sites={sites}
          postableSpotIds={scoping.ids}
          scopingOff={scoping.scopingOff}
          itemsPerStore={Object.fromEntries(held)}
          witnesses={receivers.filter(r => r.id !== me?.id)}
          canEdit={canEdit}
          nextCountNo={nextNo}
        />

        <div className="space-y-3 min-w-0">
          {recent.error && <QueryError message={recent.error.message} what="the count register" />}

          {waiting.length > 0 && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">
              <b>{waiting.length} {waiting.length === 1 ? 'count is' : 'counts are'} waiting for approval.</b>{' '}
              Nothing has moved in stock until somebody senior approves it.
            </div>
          )}

          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            {openMine.length > 0 ? 'Open and recent counts' : 'Recent counts'}
          </h3>

          {!recent.error && recent.rows.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
              No count has been run yet. The first one you start will show up here.
            </Card>
          )}

          {recent.rows.map(r => {
            const lines = r.wh_count_lines ?? []
            const reached = lines.filter(l => l.skipped || l.counted_qty !== null).length
            const diffs = lines.filter(l => !l.skipped && l.counted_qty !== null
              && Number(l.counted_qty) !== Number(l.book_qty)).length
            const counter = one(r.counter)
            const scope = SCOPE_LABEL[r.scope as CountScope]
            return (
              <Link key={r.id} href={`/warehouse/count/${r.id}`} className="block">
                <Card className="p-0 shadow-sm overflow-hidden hover:border-emerald-300 hover:shadow transition">
                  <div className="px-3 py-2 bg-slate-50/70 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11.5px] font-bold text-slate-700">{r.count_no}</span>
                    <span className="text-[11px] text-slate-500">{formatDate(r.started_at)}</span>
                    <span className={`text-[9.5px] font-extrabold uppercase rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="text-[11.5px] font-semibold text-slate-800 truncate">
                      {one(r.wh_locations)?.name ?? '—'}
                    </span>
                    <ChevronRight className="ml-auto h-4 w-4 text-slate-400 flex-shrink-0" />
                  </div>
                  <div className="px-3 py-2 flex items-baseline gap-x-3 gap-y-1 flex-wrap text-[12px] text-slate-600">
                    <span className="font-semibold text-slate-700">{scope?.title ?? r.scope}</span>
                    <span className="tabular-nums">{reached} of {lines.length} counted</span>
                    {diffs > 0 && (
                      <span className="tabular-nums font-bold text-rose-600">
                        {diffs} {diffs === 1 ? 'difference' : 'differences'}
                      </span>
                    )}
                    {diffs === 0 && reached === lines.length && lines.length > 0 && (
                      <span className="font-semibold text-emerald-700">everything tallied</span>
                    )}
                    {counter && (
                      <span className="ml-auto text-[11px] text-slate-500 truncate">
                        {counter.full_name || counter.email}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
