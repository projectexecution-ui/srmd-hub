import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { searchItems, getCategoryCounts } from '@/lib/warehouse/admin-data'
import { getLists } from '@/lib/warehouse/data'
import { ItemsClient } from './items-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

/** How many cards to draw at once. V1 rendered all 514 of its items; V2 has
 *  2,803, and 2,803 cards is a slow page on a phone. The chips and the search
 *  are what narrow it — this is only the backstop. */
const PAGE = 240

export default async function WarehouseItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; retired?: string }>
}) {
  await requirePermission('warehouse', 'view')
  const sp = await searchParams
  const q = sp.q ?? ''
  const category = sp.cat ?? ''
  const includeRetired = sp.retired === '1'

  const [items, cats, lists, perms] = await Promise.all([
    searchItems(q, { includeRetired, category: category || undefined, limit: PAGE }),
    getCategoryCounts(includeRetired),
    getLists(),
    getMyPermissions(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Item Master"
        subtitle="Catalogue of materials, by category. Fix a name or a unit, retire what is finished with, and fold a duplicate into the row that should have had it."
      />
      {items.error && <QueryError message={items.error} what="the item master" />}
      {cats.error && <QueryError message={cats.error} what="the category counts" />}

      <ItemsClient
        rows={items.rows}
        shown={items.rows.length}
        matching={items.total}
        grandTotal={cats.total}
        categories={cats.counts}
        q={q}
        activeCategory={category}
        includeRetired={includeRetired}
        units={lists.unit}
        categoryNames={lists.category}
        canAdmin={can(perms, 'warehouse', 'admin')}
      />
    </div>
  )
}
