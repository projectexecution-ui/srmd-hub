import {
  loadRequests, loadItems, loadLists, loadStock, storableLocations, locationLabel, listsOf,
  loadProjectOptions, loadRecentItemIds, loadMyProjectIds,
} from '@/lib/stores/queries'
import { RequestsClient } from '../requests/RequestsClient'
import { getMyProfile } from '@/lib/auth'
import { stockScopeFor, visibleLocationIds } from '@/lib/stores/core'
import { Section } from '../ui'
import { crossProjectOn } from '@/lib/stores/settings'
import { guardStoreTab } from '../guard'

export const dynamic = 'force-dynamic'

/**
 * The storekeeper's own queue: approved requests waiting to go out.
 *
 * Aksha, 16 Sep 2026: "The Request section is Looking very confusing... i
 * would like Issue as a seperate section ( of Storekeeper so its easy to make
 * out". One screen was doing three jobs — asking, approving and handing out —
 * for three different people, and the storekeeper had to read past an engineer's
 * request form to find the button that was theirs.
 *
 * The screen itself is RequestsClient in `issue` mode rather than a second
 * component: the issue form carries the stock checks, and a copy of those is a
 * copy that drifts.
 */
export default async function IssuePage() {
  const blocked = await guardStoreTab('issue')
  if (blocked) return blocked

  const [requests, items, lists, stock, projects, recentItemIds] = await Promise.all([
    loadRequests({ status: 'approved' }),
    loadItems(),
    loadLists(),
    loadStock(),
    loadProjectOptions(),
    loadRecentItemIds(),
  ])
  const crossProject = await crossProjectOn()

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

  const discCode = new Map(listsOf(lists, 'discipline').map(d => [d.id, d.code]))
  const visibleStock = stock.filter(
    st => scope.kind === 'all' || (st.locationId != null && allowed.has(st.locationId)))

  return (
    <Section
      title="To issue"
      note={requests.length > 0
        ? `${requests.length} approved request${requests.length === 1 ? '' : 's'} waiting to be handed out`
        : 'Approved requests appear here for the storekeeper to hand out'}
    >
      <RequestsClient
        crossProject={crossProject}
        mode="issue"
        requests={requests}
        projects={projects}
        recentItemIds={recentItemIds}
        items={items.filter(i => i.isActive).map(i => ({
          id: i.id, name: i.name, unit: i.unit,
          disciplineCode: discCode.get(i.disciplineId ?? '') ?? null,
        }))}
        locations={locations}
        modes={listsOf(lists, 'delivery_mode').filter(m => m.isActive).map(m => ({ id: m.id, name: m.name }))}
        stock={visibleStock.map(s => ({ itemId: s.itemId, locationId: s.locationId, qty: s.qty }))}
      />
    </Section>
  )
}
