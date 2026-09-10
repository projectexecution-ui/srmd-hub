import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { TransferInboxSection, type TransferInboxRow } from '@/components/cost-control/TransferInboxSection'
import { getCcSettings } from '@/lib/cost-control/settings'
import { formatINR } from '@/lib/utils'
import { getReturnedToEngineer } from '@/lib/cost-control/returned-to-engineer'
import { ReturnedToEngineer } from '@/components/dashboard/ReturnedToEngineer'
import { ApprovalProjectCard } from '@/components/cost-control/ApprovalCards'
import {
  loadApprovalsInbox, groupByProject, pendingValue, pickFirst,
} from '@/lib/cost-control/approvals-inbox'
import { Inbox, ArrowRight, Ruler } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * My Approvals — every budget waiting on this person, grouped by project.
 *
 * The loading and the card both moved out of this file: the loader to
 * lib/cost-control/approvals-inbox.ts and the card to
 * components/cost-control/ApprovalCards.tsx, so the project workspace's
 * Approvals tab shows the same card with the same numbers instead of a second
 * implementation. This page is what it always was — the cross-project view of
 * that shared pair.
 */
export default async function ApprovalsInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  await requirePermission('cost-control', 'view')
  // Management only — this page carries project-level financials.
  if (!(await checkIsCcReviewer())) redirect('/cost-control')
  // ?all=1 shows every pending budget (all approvers), not just my queue.
  const showAll = (await searchParams).all === '1'

  const user = await getMyUser()
  const supabase = await createClient()
  // Toggles decide whether ₹/sft and the ERP Budget·WO·Paid strip show — the
  // SAME switches the Internal Estimate page respects, so the numbers here and
  // there stay in lock-step.
  const ccSettings = await getCcSettings()

  const inbox = await loadApprovalsInbox(supabase, { userId: user?.id ?? null, ccSettings })

  if (inbox.error) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <PageHeader title="My Approvals" subtitle="Working sheets waiting for your decision" back="/cost-control" />
        <QueryError message={inbox.error} what="the approvals inbox" />
      </div>
    )
  }

  const { rows, mine } = inbox

  // Which sheets to show — my queue by default, everything pending via ?all=1.
  const { byProject, projOrder } = groupByProject(showAll ? rows : mine)

  // Bulk-approve is a rate x area shortcut, and it belongs to ONE case: the
  // Internal Estimate baseline the Atm Head uploads for internal figures. It was
  // gated on `mine.length > 0` — i.e. on having anything at all pending — so it
  // sat above ordinary line-item budgets offering to bulk-approve sheets that
  // have line items to scrutinise.
  const hasThumbruleMine = mine.some(
    r => r.entry_mode === 'thumbrule' && (r.summary_notes ?? '').startsWith('[IB'),
  )

  // What this person sent back and is still waiting on. Not part of the queue
  // above — it is nobody's to approve — but this is the page he opens to see
  // where his budgets stand, so the chasing list belongs here too.
  const returned = await getReturnedToEngineer()

  // Budget transfers waiting on this same person. The RPC applies the same
  // eligibility as the approve call, so a row shown here can always be acted
  // on and one that cannot never appears.
  const { data: transferRows } = await supabase.rpc('cc_transfer_inbox')
  const transfers = (transferRows ?? []) as TransferInboxRow[]
  const transferValue = transfers.reduce((sum, t) => sum + Number(t.amount ?? 0), 0)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="My Approvals"
        subtitle={
          mine.length > 0 || transfers.length > 0
            ? [
                mine.length > 0 ? `${mine.length} budget${mine.length === 1 ? '' : 's'} · ${formatINR(pendingValue(mine))}` : null,
                transfers.length > 0 ? `${transfers.length} transfer${transfers.length === 1 ? '' : 's'} · ${formatINR(transferValue)}` : null,
              ].filter(Boolean).join(' · ') + ' waiting on you'
            : 'Nothing waiting on you right now'
        }
        back="/cost-control"
      />

      {/* View-all toggle — always visible, for every approver, so the full
          pending list is one tap away (not tucked inside a stage). */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          {showAll
            ? `All pending budgets · ${rows.length} across ${projOrder.length} project${projOrder.length === 1 ? '' : 's'}`
            : `${mine.length} waiting on you across ${projOrder.length} project${projOrder.length === 1 ? '' : 's'}`}
        </p>
        <Link
          href={showAll ? '/cost-control/approvals' : '/cost-control/approvals?all=1'}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          {showAll ? 'Show only mine' : 'View all pending budgets'} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Budget being moved between work categories. Renders nothing when
          none are waiting on this person. */}
      <TransferInboxSection rows={transfers} />

      {hasThumbruleMine && (
        <Link
          href="/cost-control/approvals/thumbrule"
          className="block rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 hover:bg-amber-50/80 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <Ruler className="h-4 w-4 text-amber-700" />
              <span className="text-sm font-semibold text-amber-900">Bulk approve Thumbrule sheets</span>
              <span className="text-xs text-amber-700">— review rate × area on one page, approve in one click</span>
            </div>
            <ArrowRight className="h-4 w-4 text-amber-700" />
          </div>
        </Link>
      )}

      {projOrder.length === 0 && transfers.length > 0 ? null : projOrder.length === 0 ? (
        <Card className="p-10 text-center text-gray-500 text-sm">
          <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <div>{showAll ? 'No budgets are pending right now.' : 'Nothing is waiting on you right now.'}</div>
          {!showAll && rows.length > 0 && (
            <Link href="/cost-control/approvals?all=1" className="inline-block mt-2 text-blue-700 hover:underline text-sm">
              View all pending budgets →
            </Link>
          )}
        </Card>
      ) : (
        projOrder.map(pid => {
          const items = byProject.get(pid) ?? []
          const proj = pickFirst(items[0].projects)
          return (
            <ApprovalProjectCard
              key={pid}
              projectId={pid}
              items={items}
              enrich={inbox.enrich}
              approvedByDisc={inbox.approvedByDisc}
              approvedBySub={inbox.approvedBySub}
              erpBudget={inbox.erpBudgetByProject.get(pid) ?? 0}
              parent={proj?.parent_project_id ? inbox.parentMap.get(proj.parent_project_id) ?? null : null}
              haveApproved={inbox.haveApproved}
              showErpColumns={ccSettings.show_erp_columns}
              ctx={inbox.ctx}
              showProjectHeader
              showAll={showAll}
            />
          )
        })
      )}

      {/* Below the queue on purpose: what you must approve comes first, what you
          sent back comes after. Same lane and same data as the dashboard, so the
          two can never tell a different story. Self-hides when empty. */}
      <ReturnedToEngineer items={returned.items} mine={returned.mine} />
    </div>
  )
}
