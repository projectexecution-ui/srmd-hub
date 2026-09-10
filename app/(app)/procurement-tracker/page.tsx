import { Radio } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { LiveTracker } from './live'
import type { BoardParams } from '@/lib/revamp/indents-board'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Indent → PO Tracker — live from IN4, every project, with the cycle on every
 * indent (the same rows as each project's Indents tab).
 *
 * The upload-based tracker, its chase notes and its daily follow-up digest
 * were removed on 10 Sep 2026 (clean-up round 2, Aksha: "use live IN4
 * database here … remove chase feature, it's not required for me now").
 */
export default async function ProcurementTrackerPage({ searchParams }: { searchParams: Promise<BoardParams> }) {
  await requirePermission('procurement-tracker', 'view')
  const { months: m, ...params } = await searchParams
  const months = Math.max(1, Math.min(60, Number(m) || 12))
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">Indent → PO Tracker</h1>
        <p className="text-[13px] text-gray-500 mt-0.5 inline-flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-emerald-600" /> Live from IN4 — every project, the whole cycle, what is late.</p>
      </header>
      <LiveTracker params={{ ...params, months: m }} months={months} />
    </div>
  )
}
