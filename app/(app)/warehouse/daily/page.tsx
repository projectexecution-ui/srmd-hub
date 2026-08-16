import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getDayMovements } from '@/lib/warehouse/daily-data'
import { getShowValues } from '@/lib/warehouse/data'
import { todayIST } from '@/lib/warehouse/ledger'
import { DailyClient } from './daily-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseDailyPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>
}) {
  await requirePermission('warehouse', 'view')
  const sp = await searchParams
  const today = todayIST()
  // A malformed ?d= falls back to today rather than showing an empty day that
  // looks like "nothing moved".
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : today

  const [{ rows, error }, showValues] = await Promise.all([
    getDayMovements(day),
    getShowValues(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Daily movement"
        subtitle="Everything the ledger recorded on one day — what left, what arrived, what moved across the yard, and what was corrected. Read from the ledger, so a count correction and a voided entry show up here too."
      />
      {error && <QueryError message={error} what="today’s movements" />}
      <DailyClient rows={rows} day={day} today={today} showValues={showValues} />
    </div>
  )
}
