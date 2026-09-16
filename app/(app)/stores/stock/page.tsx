import {
  loadStock, loadItems, loadLists, storableLocations, locationLabel, loadMyProjectIds, listsOf,
} from '@/lib/stores/queries'
import { getMyProfile } from '@/lib/auth'
import { stockScopeFor, visibleLocationIds, emptyScopeReason } from '@/lib/stores/core'
import { stockLines } from '@/lib/stores/desk'
import { formatDate } from '@/lib/utils'
import { Section, Empty } from '../ui'
import { OpeningStockForm } from './OpeningStockForm'
import { StockClient } from './StockClient'
import { guardStoreTab } from '../guard'

export const dynamic = 'force-dynamic'

/**
 * What we hold, and where.
 *
 * Folded from the ledger — including the "as on" figure, which is the same
 * fold stopped earlier rather than a second calculation. That is why the
 * stock screen can never disagree with the register.
 *
 * WHAT YOU SEE DEPENDS ON YOUR JOB, not your seniority. Aksha, 15 Sep 2026:
 * "per Eng sees thier own project stock only - but the storekeeper can see all
 * stock of all projects of all storage location". A storekeeper HOLDS material
 * for eleven sites; hiding ten of them would stop them working. An engineer is
 * asking for their own site and has no business browsing another project's
 * shelves.
 *
 * The ARRANGING — search, the discipline groups, the two views, the export —
 * all lives in StockClient and lib/stores/desk.ts. This page reads, scopes,
 * and hands over.
 */
export default async function StockPage({
  searchParams,
}: { searchParams: Promise<{ asOn?: string }> }) {
  const blocked = await guardStoreTab('stock')
  if (blocked) return blocked

  const { asOn } = await searchParams
  const valid = asOn && /^\d{4}-\d{2}-\d{2}$/.test(asOn) ? asOn : undefined

  const profile = await getMyProfile()
  const mine = profile ? await loadMyProjectIds(profile.id) : []
  const scope = stockScopeFor(profile?.role, mine)

  const [stock, items, lists] = await Promise.all([loadStock(valid), loadItems(), loadLists()])
  const byItem = new Map(items.map(i => [i.id, i]))
  const locationRows = listsOf(lists, 'location')
  const byLocation = new Map(locationRows.map(l => [l.id, l]))
  const disciplineName = new Map(listsOf(lists, 'discipline').map(d => [d.id, d.name]))

  const allowed = new Set(visibleLocationIds(
    scope,
    locationRows.map(l => ({ id: l.id, parentId: l.parentId, projectId: l.projectId })),
  ))
  const places = storableLocations(lists).filter(l => allowed.has(l.id))
  const scopeNote = emptyScopeReason(scope, places.length)

  const lines = stockLines(
    stock.filter(s => scope.kind === 'all' || (s.locationId != null && allowed.has(s.locationId))),
    {
      name: id => byItem.get(id)?.name ?? 'Unknown item',
      unit: id => byItem.get(id)?.unit ?? '',
      discipline: id => disciplineName.get(byItem.get(id)?.disciplineId ?? '') ?? null,
      where: id => locationLabel(lists, id) ?? 'Not placed',
      // The site a spot hangs off, for the store view's bands. A spot with no
      // parent IS its own site — some places are a single shed.
      site: id => (id ? byLocation.get(id)?.parentName ?? byLocation.get(id)?.name ?? 'Not placed' : 'Not placed'),
      // Where no delivery ever carried a rate, the item master fills the gap —
      // which is what makes editing a rate in Masters actually value the stock.
      itemRate: id => byItem.get(id)?.lastRate ?? null,
    },
  )

  return (
    <div className="space-y-6">
      <Section
        title="Stock"
        note={valid
          ? `As on ${formatDate(valid)} — the same fold, stopped earlier`
          : 'Right now, folded from every movement'}
        right={
          <form className="flex items-end gap-2" action="/stores/stock">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">As on</span>
              <input type="date" name="asOn" defaultValue={valid ?? ''}
                className="rounded-lg border border-gray-300 px-2.5 py-2 text-[13px] min-h-[44px]" />
            </label>
            <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px]">
              Show
            </button>
          </form>
        }
      >
        {lines.length === 0 ? (
          <Empty
            // A scoped reader seeing nothing is a different fact from an empty
            // store, and telling them the store is empty would be a lie.
            title={scopeNote ? 'Nothing here for you' : 'Nothing in stock yet'}
            hint={scopeNote
              ?? 'Stock arrives two ways: through the gate, or as an opening balance below. Until there is some, nothing can be issued — an item can only be picked from stock.'}
          />
        ) : (
          <StockClient
            lines={lines}
            places={places.map(l => ({ id: l.id, label: locationLabel(lists, l.id) ?? l.name }))}
            period={valid ? `As on ${formatDate(valid)}` : 'Right now'}
            scopeNote={scope.kind === 'all' ? null : 'Your own projects only'}
          />
        )}
      </Section>

      <Section
        title="Opening stock"
        note="What was already on the ground before CT Hub started counting"
      >
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-3 mb-3">
          <p className="text-[12.5px] text-blue-900">
            <b>Your Odoo export replaces this.</b> Once the Excel arrives this becomes one upload with a
            preview, the way the budget upload works. Typing it by hand is the stop-gap, not the plan.
          </p>
        </div>
        <OpeningStockForm
          items={items.filter(i => i.isActive).map(i => ({ id: i.id, name: i.name, unit: i.unit, lastRate: i.lastRate }))}
          locations={places.map(l => ({ id: l.id, label: locationLabel(lists, l.id) ?? l.name }))}
        />
      </Section>
    </div>
  )
}
