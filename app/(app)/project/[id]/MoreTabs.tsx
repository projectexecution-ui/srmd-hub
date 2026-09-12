import Link from 'next/link'
import { IndentsTree } from './IndentsTree'
import { OrdersView } from './OrdersView'
import type { BoardParams } from '@/lib/revamp/indents-board'

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
//
// Moved out on 12 Sep 2026. The tab is now the Site Register
// (app/(app)/project/[id]/site-register/RegisterTab.tsx): entries with one
// responsible person and a response date, rather than a replay of comments
// left on budget sheets. Those comments are still shown there, read only,
// under the "Comments on budget sheets" panel — nothing was migrated, because
// a comment belongs to the sheet it was written on.
