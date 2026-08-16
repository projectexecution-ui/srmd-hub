import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getEntries } from '@/lib/warehouse/admin-data'
import { EntriesClient } from './entries-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseEntriesPage() {
  await requirePermission('warehouse', 'view')
  const { rows, error } = await getEntries()

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Gate register"
        subtitle="Every entry recorded, newest first — open one to see what it says, and to void it if it was recorded wrong. Voided entries stay in the list, struck through: a register that hides what was cancelled is the one nobody can audit."
      />
      {error && <QueryError message={error} what="the gate register" />}
      <EntriesClient rows={rows} />
    </div>
  )
}
