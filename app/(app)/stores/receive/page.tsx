import {
  loadAwaitingReceipt, loadLists, storableLocations, locationLabel, loadMyProjectIds, listsOf,
} from '@/lib/stores/queries'
import { getMyProfile } from '@/lib/auth'
import { stockScopeFor, visibleLocationIds } from '@/lib/stores/core'
import { Section } from '../ui'
import { ReceiveClient } from './ReceiveClient'
import { guardStoreTab } from '../guard'

export const dynamic = 'force-dynamic'

/**
 * Received at site — the last step of the map's OUT cycle, and the one that
 * had no front door until now.
 *
 * A site sees what is coming to IT; the storekeeper and the heads see all of
 * it, because they are the ones who have to chase what nobody has signed for.
 */
export default async function ReceivePage() {
  const blocked = await guardStoreTab('receive')
  if (blocked) return blocked

  const profile = await getMyProfile()
  const mine = profile ? await loadMyProjectIds(profile.id) : []
  const scope = stockScopeFor(profile?.role, mine)

  const [rows, lists] = await Promise.all([
    loadAwaitingReceipt(scope.kind === 'all' ? null : [...scope.projectIds]),
    loadLists(),
  ])

  // Where it could have been put down at the site end.
  const allowed = new Set(visibleLocationIds(
    scope,
    listsOf(lists, 'location').map(l => ({ id: l.id, parentId: l.parentId, projectId: l.projectId })),
  ))
  const places = storableLocations(lists)
    .filter(l => scope.kind === 'all' || allowed.has(l.id))
    .map(l => ({ id: l.id, label: locationLabel(lists, l.id) ?? l.name }))

  return (
    <Section
      title="Received at site"
      note={rows.length > 0
        ? `${rows.length} load${rows.length === 1 ? '' : 's'} left the store and nobody has signed for ${rows.length === 1 ? 'it' : 'them'} yet`
        : 'Material that has left the store, waiting for somebody at the site to sign'}
    >
      <ReceiveClient rows={rows} places={places} />
    </Section>
  )
}
