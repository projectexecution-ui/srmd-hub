import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getLocationTree, getShowValues } from '@/lib/warehouse/data'
import { getStockView, getStockCategories } from '@/lib/warehouse/report-data'
import { todayIST } from '@/lib/warehouse/ledger'
import { StockClient } from './stock-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ asOn?: string; loc?: string; cat?: string }>
}) {
  const sp = await searchParams
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'warehouse', 'edit')
  // The guard sees quantities, never value. (#22)
  const showValues = await getShowValues()

  // A future date would silently show today's figures and read as a forecast.
  const today = todayIST()
  const asOn = sp.asOn && sp.asOn <= today ? sp.asOn : today

  const [sites, categories, view] = await Promise.all([
    getLocationTree(),
    getStockCategories(),
    getStockView({ asOn, locationId: sp.loc || null, category: sp.cat || null }),
  ])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Stock"
        subtitle="What lies where, as on a date — built from the ledger, so the figure on screen and the entries behind it can never disagree."
      />

      {view.error && <QueryError message={view.error} what="the stock register" />}

      <StockClient
        asOn={asOn}
        today={today}
        groups={view.groups}
        totals={view.totals}
        sites={sites}
        categories={categories}
        masterItems={view.masterItems}
        selectedLocation={sp.loc || ''}
        selectedCategory={sp.cat || ''}
        showValues={showValues}
        canEdit={canEdit}
        failed={Boolean(view.error)}
      />
    </div>
  )
}

