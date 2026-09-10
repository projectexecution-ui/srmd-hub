import Link from 'next/link'
import { formatDateTime } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadProjectDiscussions } from '@/lib/revamp/tab-data'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { IndentsTree } from './IndentsTree'
import { OrdersView } from './OrdersView'
import type { BoardParams } from '@/lib/revamp/indents-board'
import { MentionText } from '@/components/mentions/MentionText'
import { MessageSquare } from 'lucide-react'

// ── WO / PO ─────────────────────────────────────────────────────────────────

/** The WO / PO tab: All orders · Work orders · POs · BOQ upload. The tree is
 *  the orders tree (Budget → By order) with what is still waiting in IN4 as
 *  yellow rows. Aksha, 10 Sep 2026: indents belong on Indents, not here. */
export async function WoPoTab({ projectId, view = 0 }: { projectId: string; view?: number }) {
  if (view === 3) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-2">
        <h2 className="text-sm font-bold text-gray-900">BOQ upload</h2>
        <p className="text-[13px] text-gray-600 max-w-2xl">A work order’s BOQ is uploaded as a Cost Control working sheet — the sheet is read, priced and sent for approval there. Orders themselves come from IN4 and are not uploaded.</p>
        <Link href="/cost-control/working-sheets/new-quick" className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]">Upload a BOQ as a working sheet</Link>
      </section>
    )
  }
  return <OrdersView projectId={projectId} kind={view === 1 ? 'wo' : view === 2 ? 'po' : undefined} />
}

// ── Indent → PO ─────────────────────────────────────────────────────────────

/** The Indents tab — the Internal Estimate's shape, live from IN4, with the
 *  approvals waiting in IN4 on top and the whole Indent → PO → GRN cycle on
 *  each indent. The upload-based views left on 10 Sep 2026 (clean-up round 2). */
export async function ProcurementTab({ projectId, params = {} }: { projectId: string; view?: number; params?: BoardParams }) {
  return <IndentsTree projectId={projectId} params={params} />
}

// ── Discussions ─────────────────────────────────────────────────────────────

export async function DiscussionsTab({ projectId }: { projectId: string }) {
  // Comments on the Internal Estimate baseline follow the baseline's own gate.
  const reviewer = await checkIsCcReviewer()
  const { comments, mentionUsers, mentioningMe } = await loadProjectDiscussions(projectId, { includeInternal: reviewer })

  // Anything aimed at you first, then newest. A mention is the only part of a
  // thread that is actually a task, and today it can only be found by opening
  // each sheet in turn.
  const ordered = [...comments].sort((a, b) =>
    Number(b.mentionsMe) - Number(a.mentionsMe) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <section className="space-y-3">
      <header className="flex items-start gap-2.5">
        <MessageSquare className="h-4 w-4 mt-0.5 text-gray-400" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">
            Discussions
            {comments.length > 0 && (
              <span className="ml-2 text-[12px] font-normal text-gray-500">
                {comments.length} comment{comments.length === 1 ? '' : 's'}
                {mentioningMe > 0 && (
                  <span className="font-semibold text-blue-700"> · {mentioningMe} mentioning you</span>
                )}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500">
            Every comment written on this project&rsquo;s budget sheets — the conversation for the
            project as a whole, which today can only be read one sheet at a time.
          </p>
        </div>
      </header>

      {comments.length === 0 ? (
        <EmptyState
          title="Nothing said yet"
          description="No comments have been written on any of this project's budget sheets."
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {ordered.map(c => (
            <div
              key={c.id}
              className={`px-4 py-3 ${c.mentionsMe ? 'bg-blue-50/50 border-l-2 border-l-blue-500' : ''}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold text-gray-900">
                  {c.author}
                  {c.mentionsMe && (
                    <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[12px] font-bold text-blue-800 align-middle">
                      mentions you
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-gray-400">{formatDateTime(c.createdAt)}</p>
              </div>
              {/* MentionText, the same renderer the per-sheet comments panel
                  uses, so an @name looks identical in both places instead of
                  arriving here as plain text. */}
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                <MentionText text={c.body} users={mentionUsers} />
              </p>
              <Link
                href={`/cost-control/working-sheets/${c.wsId}`}
                className="inline-block mt-1.5 text-[12px] font-medium text-indigo-700 hover:underline"
              >
                on {c.wsCode ?? 'a sheet'} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
