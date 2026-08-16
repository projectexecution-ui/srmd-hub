import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getMyPermissions, can, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getEntryDetail } from '@/lib/warehouse/admin-data'
import { todayIST } from '@/lib/warehouse/ledger'
import { EntryClient } from './entry-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseEntryPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  await requirePermission('warehouse', 'view')
  const { kind, id } = await params
  if (kind !== 'in' && kind !== 'out') notFound()

  const [{ entry, error }, perms, me] = await Promise.all([
    getEntryDetail(kind, id),
    getMyPermissions(),
    getMyUser(),
  ])
  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <QueryError message={error} what="this entry" />
      </div>
    )
  }
  if (!entry) notFound()

  // The same rule the action enforces, shown up front so the button explains
  // itself instead of refusing after the fact.
  const canAdmin = can(perms, 'warehouse', 'admin')
  const canEdit = can(perms, 'warehouse', 'edit')
  const mine = !!me?.id && entry.createdBy === me.id
  const sameDay = entry.day === todayIST()
  const mayVoid = canAdmin || (canEdit && mine && sameDay)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/warehouse/entries" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Gate register
      </Link>
      <PageHeader
        title={entry.entryNo}
        subtitle={`${entry.kind === 'in' ? 'Taken in at' : 'Went out of'} ${entry.storeName}`}
      />
      <EntryClient
        entry={entry}
        mayVoid={mayVoid}
        mayReturn={canEdit}
        whyNotVoid={
          mayVoid ? null
            : !canEdit ? 'You can see this entry but not change it.'
            : !mine ? `${entry.createdByName ?? 'Someone else'} recorded this, so only an admin or Atm Head can void it.`
            : 'This was recorded on an earlier day, so only an admin or Atm Head can void it now — the figure has already been reported on.'
        }
      />
    </div>
  )
}
