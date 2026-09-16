import { Warehouse, Package } from 'lucide-react'
import { fmtQty } from '@/lib/stores/core'
import { formatINR, formatNumber } from '@/lib/utils'

export interface StoreGroup {
  siteName: string
  spotName: string
  label: string
  items: Array<{ name: string; unit: string; qty: number; value: number | null }>
  totalItems: number
  totalValue: number
  hasUnpriced: boolean
}

/**
 * Stock the way a storekeeper thinks about it — by the place it is in.
 *
 * Aksha, 16 Sep 2026: "Stock as per Warehouse location is not showing - can u
 * make a new section in this". The map asks for it too, under Total Stock
 * Reports: "Storage Location Wise".
 *
 * The item view answers "where is the cement"; this answers "what is in the
 * NGH B store", which is the question asked when somebody walks into one — at
 * a stock count, or when deciding whether a request can be met from there.
 * Same fold, grouped differently, so the two can never disagree.
 *
 * Grouped by SITE then spot, because that is how the place is named out loud:
 * "CT Warehouse, Container 1".
 */
export function ByStore({ groups }: { groups: StoreGroup[] }) {
  if (groups.length === 0) return null

  // Sites in one band, so "CT Warehouse" is said once however many spots it has.
  const bySite = new Map<string, StoreGroup[]>()
  for (const g of groups) {
    bySite.set(g.siteName, [...(bySite.get(g.siteName) ?? []), g])
  }

  return (
    <div className="space-y-4">
      {[...bySite.entries()].map(([site, spots]) => {
        const siteItems = spots.reduce((s, g) => s + g.totalItems, 0)
        const siteValue = spots.reduce((s, g) => s + g.totalValue, 0)
        const siteUnpriced = spots.some(g => g.hasUnpriced)
        return (
          <section key={site} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <header className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-700 text-white">
                <Warehouse className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <h3 className="text-[14px] font-bold text-gray-900">{site}</h3>
              <span className="ml-auto flex flex-wrap items-baseline gap-x-3 text-[12px] text-gray-500 tabular-nums">
                <span>{formatNumber(siteItems, 0)} item{siteItems === 1 ? '' : 's'}</span>
                {siteValue > 0 && (
                  <span className="font-semibold text-gray-900">
                    {formatINR(siteValue)}{siteUnpriced && <span className="font-normal text-amber-700"> understated</span>}
                  </span>
                )}
              </span>
            </header>

            {spots.map(g => (
              <div key={g.label}>
                {/* Only name the spot when the site has more than one — a store
                    with a single shelf does not need a heading for it. */}
                {spots.length > 1 && (
                  <p className="flex items-center gap-1.5 border-b border-gray-100 bg-white px-4 py-1.5 text-[11.5px] font-semibold text-gray-500">
                    <Package className="h-3.5 w-3.5 text-gray-400" />
                    {g.spotName}
                    <span className="ml-auto tabular-nums font-normal text-gray-400">
                      {formatNumber(g.totalItems, 0)}
                    </span>
                  </p>
                )}
                <ul className="divide-y divide-gray-50">
                  {g.items.map(it => (
                    <li key={`${g.label}-${it.name}`} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-gray-900">{it.name}</span>
                      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-gray-900">
                        {fmtQty(it.qty)} <span className="font-normal text-gray-400">{it.unit}</span>
                      </span>
                      <span className="w-24 shrink-0 text-right text-[12.5px] tabular-nums text-gray-500">
                        {it.value == null ? <span className="text-gray-300">no rate</span> : formatINR(it.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
