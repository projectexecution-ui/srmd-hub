import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { searchItems } from '@/lib/warehouse/admin-data'
import { getLists } from '@/lib/warehouse/data'
import { ItemsClient } from './items-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; retired?: string }>
}) {
  await requirePermission('warehouse', 'view')
  const sp = await searchParams
  const q = sp.q ?? ''
  const includeRetired = sp.retired === '1'

  const [{ rows, total, error }, lists, perms] = await Promise.all([
    searchItems(q, { includeRetired }),
    getLists(),
    getMyPermissions(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Item master"
        subtitle="Every material the warehouse knows. Fix a name or a category, retire what is finished with, and fold a duplicate into the row that should have had it all along."
      />
      {error && <QueryError message={error} what="the item master" />}
      <ItemsClient
        rows={rows}
        total={total}
        q={q}
        includeRetired={includeRetired}
        units={lists.unit}
        categories={lists.category}
        canAdmin={can(perms, 'warehouse', 'admin')}
      />
    </div>
  )
}
