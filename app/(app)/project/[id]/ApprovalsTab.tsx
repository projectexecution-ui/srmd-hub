// Approvals, inside a project (build order §4).
//
// This is the SAME card as /cost-control/approvals — same loader, same
// component, same figures — narrowed to one project. The point of the revamp
// is that you open a project and its approvals are a tab inside it, not that
// approvals get redesigned; anyone who already knows the live screen should
// recognise this one immediately.
//
// What is deliberately NOT repeated: the coloured project card with the
// project's name, code and ERP budget. The workspace header three lines above
// already carries all three, and printing the same identity twice on one
// screen is how a page starts to feel cluttered. The card here begins at its
// first category band.
//
// ACCESS: the live page is management-only (checkIsCcReviewer, else redirect)
// because these cards carry project-level financials. The tab is marked
// reviewerOnly in lib/revamp/workspace.ts for the same reason, so an engineer
// never sees it — matching what they get on the live site today.

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { getCcSettings } from '@/lib/cost-control/settings'
import { getReturnedToEngineer } from '@/lib/cost-control/returned-to-engineer'
import { ReturnedToEngineer } from '@/components/dashboard/ReturnedToEngineer'
import { TransferInboxSection, type TransferInboxRow } from '@/components/cost-control/TransferInboxSection'
import { QueryError } from '@/components/ui/query-error'
import { ApprovalProjectCard } from '@/components/cost-control/ApprovalCards'
import { loadApprovalsInbox, pendingValue, pickFirst } from '@/lib/cost-control/approvals-inbox'
import { formatINR } from '@/lib/utils'
import { Inbox, ArrowRight, Ruler } from 'lucide-react'

/** Sub-tab order, matching the ribbon's pills in lib/revamp/workspace.ts. */
const WAITING_ON_ME = 0
const ALL_PENDING = 1
const RETURNED = 2
const TRANSFERS = 3

export async function ApprovalsTab({ projectId, view }: { projectId: string; view: number }) {
  const [user, supabase, ccSettings] = await Promise.all([
    getMyUser(), createClient(), getCcSettings(),
  ])

  const inbox = await loadApprovalsInbox(supabase, {
    userId: user?.id ?? null, ccSettings, projectId,
  })

  if (inbox.error) return <QueryError message={inbox.error} what="this project's approvals" />

  const { rows, mine } = inbox
  const showAll = view === ALL_PENDING

  if (view === RETURNED) return <ReturnedPanel projectId={projectId} />
  if (view === TRANSFERS) return <TransfersPanel projectId={projectId} />

  const items = showAll ? rows : mine
  const proj = pickFirst(rows[0]?.projects ?? null)

  // The bulk-approve shortcut belongs to one case only: the Internal Estimate
  // baseline the Atm Head uploads. Offered here on the same condition as live.
  const hasThumbruleMine = mine.some(
    r => r.entry_mode === 'thumbrule' && (r.summary_notes ?? '').startsWith('[IB'),
  )

  return (
    <div className="space-y-4 max-w-4xl">
      {/* One line of scope, so the difference between the two budget views is
          stated rather than left for the reader to infer from the pill. */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">
          {showAll
            ? `${rows.length} pending on this project${rows.length ? ` · ${formatINR(pendingValue(rows))}` : ''}`
            : `${mine.length} waiting on you${mine.length ? ` · ${formatINR(pendingValue(mine))}` : ''}`}
          {!showAll && rows.length > mine.length && (
            <span className="text-gray-400"> · {rows.length - mine.length} with someone else</span>
          )}
        </p>
        {ccSettings.show_erp_columns && (inbox.erpBudgetByProject.get(projectId) ?? 0) > 0 && (
          <p className="text-xs text-gray-500 tabular-nums">
            <span className="text-[12px] uppercase tracking-wide text-gray-400">Project budget (ERP)</span>{' '}
            <b className="text-gray-900">{formatINR(inbox.erpBudgetByProject.get(projectId) ?? 0)}</b>
          </p>
        )}
      </div>

      {hasThumbruleMine && !showAll && (
        <Link
          href="/cost-control/approvals/thumbrule"
          className="block rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 hover:bg-amber-50/80 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 flex-wrap">
              <Ruler className="h-4 w-4 text-amber-700 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-900">Bulk approve Thumbrule sheets</span>
              <span className="text-xs text-amber-700">— review rate × area on one page, approve in one click</span>
            </div>
            <ArrowRight className="h-4 w-4 text-amber-700 flex-shrink-0" />
          </div>
        </Link>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500 text-sm">
          <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <div>
            {showAll
              ? 'No budgets are pending on this project.'
              : 'Nothing on this project is waiting on you.'}
          </div>
          {/* Never a dead end: if others are holding budgets here, say so and
              offer the view that shows them. */}
          {!showAll && rows.length > 0 && (
            <p className="mt-2 text-sm">
              {rows.length} {rows.length === 1 ? 'budget is' : 'budgets are'} with someone else —
              {' '}<span className="text-blue-700">switch to All pending</span> to see them.
            </p>
          )}
        </div>
      ) : (
        <ApprovalProjectCard
          projectId={projectId}
          items={items}
          enrich={inbox.enrich}
          approvedByDisc={inbox.approvedByDisc}
          approvedBySub={inbox.approvedBySub}
          erpBudget={inbox.erpBudgetByProject.get(projectId) ?? 0}
          parent={proj?.parent_project_id ? inbox.parentMap.get(proj.parent_project_id) ?? null : null}
          haveApproved={inbox.haveApproved}
          showErpColumns={ccSettings.show_erp_columns}
          ctx={inbox.ctx}
          showProjectHeader={false}
          showAll={showAll}
        />
      )}
    </div>
  )
}

/** Budgets this person sent back, still with the engineer. Nobody's to
 *  approve, but this is where the chasing happens. */
async function ReturnedPanel({ projectId }: { projectId: string }) {
  const returned = await getReturnedToEngineer()
  const items = returned.items.filter(i => i.projectId === projectId)

  if (returned.error) return <QueryError message={returned.error} what="returned budgets" />

  return (
    <div className="space-y-3 max-w-4xl">
      {items.length === 0 ? (
        <EmptyPanel
          title="Nothing is back with an engineer"
          detail="Budgets you return on this project appear here until the engineer resubmits them."
        />
      ) : (
        <ReturnedToEngineer items={items} />
      )}
    </div>
  )
}

/** Budget moving between work categories on this project. */
async function TransfersPanel({ projectId }: { projectId: string }) {
  const supabase = await createClient()
  // The RPC applies the same eligibility as the approve call, so a row shown
  // here can always be acted on, and one that cannot never appears.
  const { data, error } = await supabase.rpc('cc_transfer_inbox')
  if (error) return <QueryError message={error.message} what="budget transfers" />

  const rows = ((data ?? []) as TransferInboxRow[]).filter(t => t.project_id === projectId)

  return (
    <div className="space-y-3 max-w-4xl">
      {rows.length === 0 ? (
        <EmptyPanel
          title="No transfers waiting on you here"
          detail="Budget moved between categories on this project appears here while it needs your decision."
        />
      ) : (
        <TransferInboxSection rows={rows} />
      )}
    </div>
  )
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
      <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
      <p className="text-sm text-gray-600">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">{detail}</p>
    </div>
  )
}
