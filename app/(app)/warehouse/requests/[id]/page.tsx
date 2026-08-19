import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getMyPermissions, can, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getRequestDetail } from '@/lib/warehouse/request-data'
import { getShowValues } from '@/lib/warehouse/data'
import { approveBlocker, issuableBlocker } from '@/lib/warehouse/requests'
import { RequestClient } from './request-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requirePermission('warehouse', 'view')
  const { id } = await params

  const [{ request, error }, perms, me, showValues] = await Promise.all([
    getRequestDetail(id),
    getMyPermissions(),
    getMyUser(),
    getShowValues(),
  ])
  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <QueryError message={error} what="this request" />
      </div>
    )
  }
  if (!request) notFound()

  const canApprove = can(perms, 'warehouse', 'admin')
  const canEdit = can(perms, 'warehouse', 'edit')
  const state = {
    reqNo: request.reqNo,
    status: request.status,
    stagesNeeded: request.stagesNeeded,
    stagesDone: request.stagesDone,
    requestedBy: request.requestedById,
    approvers: request.approvals.map(() => null as string | null),
  }

  // The same rules the actions enforce, resolved here so the buttons explain
  // themselves rather than refusing after the fact.
  const whyNotApprove = approveBlocker(
    { ...state, approvers: [] },
    me?.id ?? null,
    canApprove,
  )
  const whyNotIssue = issuableBlocker(state)
  const mine = !!me?.id && request.requestedById === me.id

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/warehouse/requests" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Requests
      </Link>
      <PageHeader
        title={request.reqNo}
        subtitle={`${request.storeName} → ${request.destination}`}
      />
      <RequestClient
        request={request}
        showValues={showValues}
        canApprove={canApprove && !whyNotApprove}
        whyNotApprove={whyNotApprove}
        canIssue={canEdit && !whyNotIssue}
        whyNotIssue={whyNotIssue}
        canCancel={canEdit && (mine || canApprove)}
      />
    </div>
  )
}
