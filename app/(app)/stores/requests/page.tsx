import Link from 'next/link'
import {
  loadRequests, loadItems, loadLists, loadStock, storableLocations, locationLabel, listsOf,
  loadProjectOptions, loadRecentItemIds, loadMyProjectIds,
} from '@/lib/stores/queries'
import { RequestsClient } from './RequestsClient'
import { getMyProfile } from '@/lib/auth'
import { stockScopeFor, visibleLocationIds, emptyScopeReason } from '@/lib/stores/core'
import { sayStatus } from '@/lib/stores/status'
import { guardStoreTab } from '../guard'

export const dynamic = 'force-dynamic'

/**
 * Named by WHO IS HOLDING IT, not by what the status column says — and named
 * in lib/stores/status.ts, so the chip on the card and the filter above it can
 * never drift apart again. Aksha asked for those words on 16 Sep 2026; his own
 * wording was "Request raised by Engineer for Site - Approval", shortened to
 * something that reads at a glance from across a desk.
 */
const FILTERS = [
  { key: 'pending',  label: sayStatus('pending').label },
  { key: 'approved', label: sayStatus('approved').label },
  { key: '',         label: 'Everything' },
]

export default async function RequestsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const blocked = await guardStoreTab('requests')
  if (blocked) return blocked

  const { status } = await searchParams
  const active = FILTERS.find(f => f.key === status)?.key ?? 'pending'

  const [requests, items, lists, stock, projects, recentItemIds, allRequests] = await Promise.all([
    loadRequests({ status: active || null }),
    loadItems(),
    loadLists(),
    loadStock(),
    loadProjectOptions(),
    loadRecentItemIds(),
    loadRequests({}),
  ])

  // A count on the chip, so "is anything on me?" is answered without a click.
  const countFor = (key: string) =>
    key === '' ? allRequests.length : allRequests.filter(r => r.status === key).length

  // An engineer asks for their own site and sees their own site's stock; a
  // storekeeper holds material for eleven sites and sees all of it. Aksha,
  // 15 Sep 2026: "per Eng sees thier own project stock only - but the
  // storekeeper can see all stock of all projects of all storage location".
  const profile = await getMyProfile()
  const mine = profile ? await loadMyProjectIds(profile.id) : []
  const scope = stockScopeFor(profile?.role, mine)

  const allowed = new Set(visibleLocationIds(
    scope,
    listsOf(lists, 'location').map(l => ({ id: l.id, parentId: l.parentId, projectId: l.projectId })),
  ))

  const locations = storableLocations(lists)
    .filter(l => scope.kind === 'all' || allowed.has(l.id))
    .map(l => ({ id: l.id, label: locationLabel(lists, l.id) ?? l.name }))

  // Which projects this person may RAISE for. Keepers can raise for anyone —
  // they are covering for a site that has phoned them.
  const askableProjects = scope.kind === 'all'
    ? projects
    : projects.filter(pr => mine.includes(pr.id))

  const visibleStock = stock.filter(
    st => scope.kind === 'all' || (st.locationId != null && allowed.has(st.locationId)))

  const scopeNote = emptyScopeReason(scope, askableProjects.length)

  // Which approver each item implies — the button can then say who it is
  // going to instead of naming both and meaning one.
  const discCode = new Map(
    listsOf(lists, 'discipline').map(d => [d.id, d.code]))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <Link
            key={f.key || 'all'}
            href={f.key ? `/stores/requests?status=${f.key}` : '/stores/requests?status='}
            className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold min-h-[44px] inline-flex items-center ${
              active === f.key ? 'bg-indigo-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {f.label}
            {countFor(f.key) > 0 && (
              <span className={`ml-1.5 tabular-nums ${active === f.key ? 'text-white/80' : 'text-gray-400'}`}>
                {countFor(f.key)}
              </span>
            )}
          </Link>
        ))}
      </div>

      <RequestsClient
        requests={requests}
        projects={askableProjects}
        scopeNote={scopeNote}
        recentItemIds={recentItemIds}
        items={items.filter(i => i.isActive).map(i => ({
          id: i.id, name: i.name, unit: i.unit,
          disciplineCode: discCode.get(i.disciplineId ?? '') ?? null,
        }))}
        locations={locations}
        modes={listsOf(lists, 'delivery_mode').filter(m => m.isActive).map(m => ({ id: m.id, name: m.name }))}
        stock={visibleStock.map(s => ({ itemId: s.itemId, locationId: s.locationId, qty: s.qty }))}
      />
    </div>
  )
}
