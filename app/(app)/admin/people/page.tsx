import { adminViewer } from '@/lib/admin/viewer'
import { doorById, resolveTab, visibleTabs } from '@/lib/admin/doors'
import { AdminDoor, NothingHere } from '../Door'
import { loadPeopleData } from './load'
import { PeopleClient } from './PeopleClient'
import { AccountsBody } from '../users/body'
import { RolesBody } from '../permissions/body'

export const dynamic = 'force-dynamic'

/** The six grids keep their old deep links: ?tab=bills still opens the Bills
 *  e-mail grid, inside the Per person tab. */
const GRID_TABS = new Set(['powers', 'signs', 'works', 'indents', 'bills', 'alerts'])

/**
 * People — the first door (Aksha, 11 Sep 2026; widened 23 Sep 2026, C1).
 *
 *   Per person   one card per person, or the six grids for many at once
 *   Accounts     what /admin/users was — sign-ins, roles, access requests
 *   Roles        what /admin/permissions was — the role × screen grid
 *
 * Three screens that answered "what can Mayank do" are one door. Each tab
 * still writes the tables it always wrote.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string; person?: string }> }) {
  const [v, { tab: requested, person }] = await Promise.all([adminViewer(), searchParams])
  const door = doorById('people')!
  const gridTab = requested && GRID_TABS.has(requested) ? requested : undefined
  const tabs = visibleTabs(door, v)
  const current = resolveTab(door, gridTab ? 'people' : requested, v)
  if (!current) return <NothingHere door={door} />

  return (
    <AdminDoor door={door} tabs={tabs} current={current}>
      {current.id === 'people' && <PeopleClient data={await loadPeopleData()} initialTab={gridTab} initialPerson={person} />}
      {current.id === 'accounts' && <AccountsBody />}
      {current.id === 'roles' && <RolesBody />}
    </AdminDoor>
  )
}
