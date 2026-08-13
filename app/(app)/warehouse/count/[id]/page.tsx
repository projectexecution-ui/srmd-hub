import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getMyPermissions, getMyUser, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getCount, getItems, getLists, getShowValues, one } from '@/lib/warehouse/data'
import { SCOPE_LABEL } from '@/lib/warehouse/count'
import type { CountScope } from '@/lib/warehouse/count'
import { CountSheet } from './count-sheet'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('warehouse', 'view')
  const [perms, me] = await Promise.all([getMyPermissions(), getMyUser()])
  const canEdit = can(perms, 'warehouse', 'edit')
  const canApprove = can(perms, 'warehouse', 'admin')
  // Same rule as the gate register: quantities for everyone, money only for
  // those who are meant to see it. (#22)
  // One definition for the whole module, driven by the Settings switch.
  const showValues = await getShowValues()

  const { count, lines, error } = await getCount(id)
  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <QueryError message={error.message} what="this count" />
      </div>
    )
  }
  if (!count) notFound()

  const [items, lists] = await Promise.all([getItems(), getLists()])
  const scope = SCOPE_LABEL[count.scope as CountScope]
  const counter = one(count.counter)
  const witness = one(count.witness)
  const approver = one(count.approver)
  const store = one(count.wh_locations)?.name ?? '—'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/warehouse/count" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> All counts
      </Link>
      <PageHeader
        title={count.count_no}
        subtitle={`${scope?.title ?? count.scope} · ${store}`}
      />

      <CountSheet
        countId={count.id}
        countNo={count.count_no}
        store={store}
        scopeTitle={scope?.title ?? count.scope}
        status={count.status}
        blind={count.blind}
        lines={lines}
        reasons={lists.countReason}
        items={items.map(i => ({ id: i.id, name: i.name, unit: i.unit }))}
        counterName={counter?.full_name || counter?.email || null}
        witnessName={witness?.full_name || witness?.email || null}
        approverName={approver?.full_name || approver?.email || null}
        hasWitness={Boolean(count.witness_id)}
        rejectReason={count.reject_reason}
        canEdit={canEdit}
        canApprove={canApprove}
        iAmTheCounter={Boolean(me?.id && me.id === count.counted_by)}
        showValues={showValues}
      />
    </div>
  )
}

