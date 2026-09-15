import {
  loadStock, loadItems, loadLists, storableLocations, locationLabel, loadMyProjectIds, listsOf,
} from '@/lib/stores/queries'
import { getMyProfile } from '@/lib/auth'
import {
  fmtQty, stockScopeFor, visibleLocationIds, emptyScopeReason,
} from '@/lib/stores/core'
import { formatINR } from '@/lib/utils'
import { Section, Empty, Scroller, th, thNum, td, tdNum } from '../ui'
import { OpeningStockForm } from './OpeningStockForm'

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
 */
export default async function StockPage({
  searchParams,
}: { searchParams: Promise<{ asOn?: string }> }) {
  const { asOn } = await searchParams
  const valid = asOn && /^\d{4}-\d{2}-\d{2}$/.test(asOn) ? asOn : undefined

  const profile = await getMyProfile()
  const mine = profile ? await loadMyProjectIds(profile.id) : []
  const scope = stockScopeFor(profile?.role, mine)

  const [stock, items, lists] = await Promise.all([loadStock(valid), loadItems(), loadLists()])
  const byItem = new Map(items.map(i => [i.id, i]))
  const allPlaces = storableLocations(lists)

  const allowed = new Set(visibleLocationIds(
    scope,
    listsOf(lists, 'location').map(l => ({ id: l.id, parentId: l.parentId, projectId: l.projectId })),
  ))
  const places = allPlaces.filter(l => allowed.has(l.id))
  const scopeNote = emptyScopeReason(scope, places.length)

  const rows = stock
    .filter(s => scope.kind === 'all' || (s.locationId != null && allowed.has(s.locationId)))
    .map(s => ({
      ...s,
      name: byItem.get(s.itemId)?.name ?? 'Unknown item',
      unit: byItem.get(s.itemId)?.unit ?? '',
      where: locationLabel(lists, s.locationId) ?? 'Not placed',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where))

  const value = rows.reduce((s, r) => s + (r.lastRate ?? 0) * r.qty, 0)

  return (
    <div className="space-y-6">
      <Section
        title="Stock"
        note={valid ? `As on ${valid} — the same fold, stopped earlier` : 'Right now, folded from every movement'}
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
        {rows.length === 0 ? (
          <Empty
            // A scoped reader seeing nothing is a different fact from an empty
            // store, and telling them the store is empty would be a lie.
            title={scopeNote ? 'Nothing here for you' : 'Nothing in stock yet'}
            hint={scopeNote
              ?? 'Stock arrives two ways: through the gate, or as an opening balance below. Until there is some, nothing can be issued — an item can only be picked from stock.'}
          />
        ) : (
          <>
            <Scroller min={680}>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Where</th>
                    <th className={thNum}>In hand</th>
                    <th className={th}>Unit</th>
                    <th className={thNum}>Last rate</th>
                    <th className={thNum}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={`${r.itemId}-${r.locationId}`} className={r.qty <= 0 ? 'opacity-55' : ''}>
                      <td className={td}>{r.name}</td>
                      <td className={td}>{r.where}</td>
                      <td className={`${tdNum} font-semibold ${r.qty < 0 ? 'text-rose-700' : ''}`}>{fmtQty(r.qty)}</td>
                      <td className={td}>{r.unit}</td>
                      <td className={tdNum}>{r.lastRate == null ? '—' : formatINR(r.lastRate)}</td>
                      <td className={tdNum}>{r.lastRate == null ? '—' : formatINR(r.lastRate * r.qty)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className={`${td} font-bold`} colSpan={5}>Value of what we hold</td>
                    <td className={`${tdNum} font-bold`}>{formatINR(value)}</td>
                  </tr>
                </tbody>
              </table>
            </Scroller>
            {rows.some(r => r.qty < 0) && (
              <p className="text-[12px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                A negative balance means more went out than ever came in — usually an opening quantity that was
                never set. It is shown rather than hidden, because hiding it is how a store stops being believed.
              </p>
            )}
          </>
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
