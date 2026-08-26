// "An Internal Estimate cannot be lower than what ERP already approved — it can
// only be higher." — the HOD's point 5.
//
// Reported, never blocked. 21 of the 135 lines that have both figures already
// break the rule (₹8.75 Cr of shortfall), so a block would refuse numbers that
// are already live, and estimates are routinely loaded before the ERP figures
// arrive. The job here is to make a wrong estimate impossible to miss.
//
// What it actually catches is placeholders. `201 Excavation & Backfilling`
// carries a round ₹12,00,000 on seven different projects against ERP budgets
// three to four times that; SRAH's `801 High Side` says ₹5,00,000 against
// ₹1,72,00,000. Nobody estimated those — someone typed a number to fill the box.

import type { ErpFigures } from './over-budget'

/** Below this, a shortfall is noise rather than a wrong estimate.
 *
 *  SRAH's "1602 Courtyards Works" is ₹5,20,000 estimated against ₹5,20,001
 *  released — a one-rupee gap that means nothing, and a flag that fires on it
 *  is a flag people learn to ignore. Every real violation in the data is
 *  ₹9,332 or more, so nothing genuine is hidden by this. */
export const ESTIMATE_SHORTFALL_FLOOR = 1_000

/** How far the Internal Estimate falls short of the ERP-approved budget.
 *  0 when the estimate is at or above it, when there is no ERP budget to
 *  compare against, or when the gap is inside the noise floor. */
export function estimateShortfall(
  estimate: number | null | undefined,
  erp: ErpFigures | null | undefined,
): number {
  const budget = Math.round(Number(erp?.budget) || 0)
  if (budget <= 0) return 0
  const est = Math.round(Number(estimate) || 0)
  // No estimate at all is a MISSING baseline, not a wrong one — a different
  // problem, counted separately so 208 blank lines do not bury 21 wrong ones.
  if (est <= 0) return 0
  const short = budget - est
  return short >= ESTIMATE_SHORTFALL_FLOOR ? short : 0
}

/** ERP has released money against this line but nobody ever set an estimate.
 *  Reported apart from the shortfall — see the comment above. */
export function hasNoEstimate(
  estimate: number | null | undefined,
  erp: ErpFigures | null | undefined,
): boolean {
  const budget = Math.round(Number(erp?.budget) || 0)
  if (budget <= 0) return false
  return Math.round(Number(estimate) || 0) <= 0
}
