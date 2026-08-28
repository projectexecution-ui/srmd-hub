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
// derived and displayed instead, and taking it out of IN4 is a separate human
// act that Billing/Coordinator ticks off (cc_set_erp_reduced).
//
// The same rule reads upwards: a whole work category is closable when every
// sub-category under it that carries money is closed or closable. These
// functions are mirrored by fn_cc_sub_closable / cc_set_completion in
// 20260828_cc_completion_closes_the_line.sql, which is what actually enforces
// it — the DB refuses a new request on a closed line, so a stale page cannot
// talk its way past the rule.

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

/** One sub-category, as the work-category rule sees it. */
export interface SubLine {
  /** Already closed. It no longer holds the category open. */
  completed: boolean
  figures: ErpFigures | null | undefined
}

/** Does this sub-category carry money at all? A row with no budget and nothing
 *  committed is not unfinished work — it is an empty row, and it must not hold
 *  a whole category open. (SWD Chambers in the screenshot: every column a dash.) */
export function hasMoney(f: ErpFigures | null | undefined): boolean {
  if (!f) return false
  return Math.round(Number(f.budget) || 0) > 0 || Math.round(Number(f.wo) || 0) > 0
}

/** Which sub-categories are stopping this work category from being closed?
 *  Empty array = it can be closed. Mirrors fn_cc_sub_closable + the category
 *  check in cc_set_completion — keep the two in step. */
export function blockersForDiscipline<T extends SubLine>(subs: T[]): T[] {
  return subs.filter(s => !s.completed && hasMoney(s.figures) && !canMarkComplete(s.figures))
}

/** A work category is closable when it has money somewhere under it and every
 *  sub-category carrying money is closed or closable. */
export function canCompleteDiscipline(subs: SubLine[]): boolean {
  if (!subs.some(s => s.completed || hasMoney(s.figures))) return false
  return blockersForDiscipline(subs).length === 0
}

/** How many still-open sub-categories a "close the category" click will close.
 *  Shown in the confirm, so nobody is surprised by the cascade. */
export function cascadeCount(subs: SubLine[]): number {
  return subs.filter(s => !s.completed && canMarkComplete(s.figures)).length
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
