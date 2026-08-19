import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getMyPermissions, can, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getRequestDetail, getApprovalRules, myWarehouseRole } from '@/lib/warehouse/request-data'
import { getShowValues } from '@/lib/warehouse/data'
import { issuableBlocker } from '@/lib/warehouse/requests'
import { movesFor, personBlocker } from '@/lib/warehouse/approval-matrix'
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

  const [{ request, error }, perms, me, showValues, { rules }, role] =
    await Promise.all([
      getRequestDetail(id),
      getMyPermissions(),
      getMyUser(),
      getShowValues(),
      getApprovalRules(),
      myWarehouseRole(),
    ])

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <QueryError message={error} what="this request" />
      </div>
    )
  }
  if (!request) notFound()

  const canEdit = can(perms, 'warehouse', 'edit')
  const isAdmin = can(perms, 'warehouse', 'admin')
  const mine = !!me?.id && request.requestedById === me.id

  // The buttons come from the RULES, not from code: whatever chain is configured
  // at /admin/approvals is what appears here.
  const moves = movesFor(rules, request.status, role, request.estValue).map(m => ({
    toStage: m.toStage,
    needsRemarks: m.needsRemarks,
    label: m.toStage === 'rejected' ? 'Reject'
      : m.toStage === 'checked' ? 'Check and pass on'
      : m.toStage === 'approved' ? 'Approve'
      : `Move to ${m.toStage}`,
  }))

  // A person-level refusal is not configuration and must not read like one.
  // The SAME arguments the action uses. Passing an empty list here made the
  // screen offer a button the action would then refuse — a silent blocker.
  const personal = personBlocker(me?.id ?? null, request.requestedById, request.approverIds)
  const whyNoMoves = personal
    ?? (moves.length === 0 && (request.status === 'pending' || request.status === 'checked')
      ? 'Your role cannot move this request on. The chain is set in Admin ▸ Approvals.'
      : null)

  const whyNotIssue = issuableBlocker({
    reqNo: request.reqNo, status: request.status,
    stagesNeeded: request.stagesNeeded, stagesDone: request.stagesDone,
    requestedBy: request.requestedById, approvers: [],
  })

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
        moves={personal ? [] : moves}
        whyNoMoves={whyNoMoves}
        canIssue={canEdit && !whyNotIssue}
        whyNotIssue={whyNotIssue}
        canCancel={canEdit && (mine || isAdmin)}
      />
    </div>
  )
}
