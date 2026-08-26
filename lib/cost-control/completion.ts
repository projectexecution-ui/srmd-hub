// "Mark complete" on a sub-category — the HOD's point 3.
//
// His rule, and it is a good one: only offer the button where the WO/PO
// committed figure and the Paid figure MATCH. That means everything promised to
// the contractor has been paid, so there is nothing more to come and the line
// can be closed. Anywhere else, offering it would invite someone to close a
// line that still has money owed on it.
//
// It also keeps the button rare. Across the portfolio 272 sub-category lines
// carry a WO and 152 of them match exactly, but a project's table has hundreds
// of rows — on SRAH exactly 32 qualify. The button is the exception, not
// another control on every row.
//
// Completing does NOT write a reduced figure back to cc_budget_lines. Budget /
// WO / Paid come from IN4 via the BPH sync and nothing else may author them —
// the next sync would silently overwrite anything we wrote. The saving is
// derived and displayed instead.

import type { ErpFigures } from './over-budget'

/** Is this line closable? WO must exist and equal Paid to the rupee.
 *
 *  Compared on whole rupees because BPH amounts carry paise, and NOT with a
 *  tolerance: exactly 152 lines match on rupees, 155 within ₹100. Three extra
 *  lines are not worth a rule nobody can explain, and "WO equals Paid" is a
 *  sentence a site engineer can check by eye against the two columns. */
export function canMarkComplete(f: ErpFigures | null | undefined): boolean {
  if (!f) return false
  const wo = Math.round(Number(f.wo) || 0)
  const paid = Math.round(Number(f.paid) || 0)
  // Nothing committed yet is not "finished", it is "not started".
  if (wo <= 0) return false
  return wo === paid
}

/** Budget left over once the line is closed — the money that goes back.
 *  Zero (never negative) on a line that overspent; that overrun is the
 *  over-budget marker's story, not a negative saving. */
export function savingsOnCompletion(f: ErpFigures | null | undefined): number {
  if (!f) return 0
  const budget = Math.round(Number(f.budget) || 0)
  const paid = Math.round(Number(f.paid) || 0)
  return Math.max(0, budget - paid)
}
