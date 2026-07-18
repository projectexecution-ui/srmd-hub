// Management confidence scorecard (cc_cumulative_versions, reviewer-only).
// One glance before approving: how much of the ask is MEASURED vs an ESTIMATE
// (no drawing), whether the rows reconcile to the total, and — on a revision —
// how many rates moved. Green = safe to review; amber = look closer / return.
// Presentational; the Return-to-engineer action lives in WSApprovalActions.

import { formatINR } from '@/lib/utils'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

interface Props {
  measured: number
  estimate: number
  reconciles: boolean
  total: number
  /** Rate changes vs the prior approved version (revisions only). */
  rateChanges?: number | null
  /** Estimate rows still missing a reason (should be 0 once submitted). */
  estimatesMissingReason?: number
}

export function ConfidenceScorecard({ measured, estimate, reconciles, total, rateChanges = null, estimatesMissingReason = 0 }: Props) {
  const items = measured + estimate
  const measPct = items > 0 ? Math.round((measured / items) * 100) : 100
  const estPct = 100 - measPct
  // Soft verdict — the reviewer decides; this only flags what to look at.
  const concern = !reconciles || estimatesMissingReason > 0 || estPct >= 50
  const ok = !concern

  return (
    <div className={`rounded-xl border overflow-hidden ${ok ? 'border-emerald-200' : 'border-amber-300'}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 ${ok ? 'bg-emerald-50/70' : 'bg-amber-50/70'}`}>
        <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${ok ? 'text-emerald-800' : 'text-amber-800'}`}>
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {ok ? 'OK to review' : 'Look closer before approving'}
        </span>
        <span className="ml-auto text-xs font-semibold tabular-nums text-gray-700">{formatINR(total)}</span>
      </div>
      <div className="px-4 py-3 space-y-2 bg-white">
        {items > 0 && (
          <div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
              <div className="h-full bg-emerald-500" style={{ width: `${measPct}%` }} />
              <div className="h-full bg-amber-500" style={{ width: `${estPct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] font-medium flex-wrap">
              <span className="inline-flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{measured} measured ({measPct}%)</span>
              {estimate > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{estimate} estimate — no drawing ({estPct}%)</span>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-4 text-xs flex-wrap pt-1">
          <span className={`inline-flex items-center gap-1 ${reconciles ? 'text-emerald-700' : 'text-rose-700 font-semibold'}`}>
            {reconciles ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {reconciles ? 'Rows reconcile to the total' : 'Rows don’t add up to the total'}
          </span>
          {rateChanges != null && rateChanges > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {rateChanges} rate change{rateChanges > 1 ? 's' : ''} vs approved</span>
          )}
          {estimatesMissingReason > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {estimatesMissingReason} estimate{estimatesMissingReason > 1 ? 's' : ''} with no reason</span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 pt-0.5">
          Click any quantity to open its take-off. {ok ? 'Nothing flagged — approve or spot-check.' : 'Use “Return to engineer” below if the working isn’t good enough.'}
        </p>
      </div>
    </div>
  )
}
