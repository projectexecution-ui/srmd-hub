import { loadStock, loadItems, loadLists, storableLocations, locationLabel } from '@/lib/stores/queries'
import { fmtQty } from '@/lib/stores/core'
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
 */
export default async function StockPage({
  searchParams,
}: { searchParams: Promise<{ asOn?: string }> }) {
  const { asOn } = await searchParams
  const valid = asOn && /^\d{4}-\d{2}-\d{2}$/.test(asOn) ? asOn : undefined

  const [stock, items, lists] = await Promise.all([loadStock(valid), loadItems(), loadLists()])
  const byItem = new Map(items.map(i => [i.id, i]))
  const places = storableLocations(lists)

  const rows = stock
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
            title="Nothing in stock yet"
            hint="Stock arrives two ways: through the gate, or as an opening balance below. Until there is some, nothing can be issued — an item can only be picked from stock."
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
