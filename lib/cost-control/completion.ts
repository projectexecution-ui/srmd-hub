// "Completed" — closing a sub-category, or a whole work category.
//
// The first rule (the HOD's) only offered the button where WO/PO equalled Paid.
// That is a clean close, and it is still the common case — but it left 122 of
// the 353 lines that carry money permanently uncloseable, because a rupee of a
// work order was still unpaid, plus another 73 that hold budget nobody has
// committed yet. A line can be finished for reasons IN4 cannot see: the work
// stopped, the balance will never be billed, the contract was settled short.
// Deciding that is management's job, not a formula's.
//
// So the button is offered everywhere now, and the rule became a warning
// instead of a gate: the confirm says exactly what is still outstanding before
// anyone commits to it, and the audit trail records who closed it anyway.
//
// Completing does NOT write a reduced figure back to cc_budget_lines. Budget /
// WO / Paid come from IN4 via the BPH sync and nothing else may author them —
// the next sync would silently overwrite anything we wrote. The saving is
// derived and displayed instead, and taking it out of IN4 is a separate human
// act that Billing/Coordinator ticks off (cc_set_erp_reduced).
//
// Mirrored by fn_cc_sub_closable / cc_set_completion in the migrations. The DB
// no longer refuses a close, but it still refuses a new REQUEST on a closed
// line, which is the part that has to hold against a stale page.

import type { ErpFigures } from './over-budget'

/** Money committed on a WO/PO that has not been paid yet. This is what makes a
 *  close a judgement call rather than housekeeping. */
export function outstandingOnLine(f: ErpFigures | null | undefined): number {
  if (!f) return 0
  const wo = Math.round(Number(f.wo) || 0)
  const paid = Math.round(Number(f.paid) || 0)
  return Math.max(0, wo - paid)
}

/** A clean close: everything promised to the contractor has been paid, so
 *  nothing more is coming. No longer a gate — it decides how the confirm is
 *  worded, and whether the row's chip reads as routine or as a judgement.
 *
 *  Compared on whole rupees because BPH amounts carry paise, and NOT with a
 *  tolerance: "WO equals Paid" is a sentence a site engineer can check by eye
 *  against the two columns. */
export function canMarkComplete(f: ErpFigures | null | undefined): boolean {
  if (!f) return false
  const wo = Math.round(Number(f.wo) || 0)
  // Nothing committed yet is not "finished", it is "not started".
  if (wo <= 0) return false
  return wo === Math.round(Number(f.paid) || 0)
}

/** One sub-category, as the work-category rule sees it. */
export interface SubLine {
  /** Already closed. */
  completed: boolean
  figures: ErpFigures | null | undefined
}

/** Does this sub-category carry money at all? A row with no budget and nothing
 *  committed is not unfinished work — it is an empty row. */
export function hasMoney(f: ErpFigures | null | undefined): boolean {
  if (!f) return false
  return Math.round(Number(f.budget) || 0) > 0
    || Math.round(Number(f.wo) || 0) > 0
    || Math.round(Number(f.paid) || 0) > 0
}

/** Sub-categories under a category that still have money committed and unpaid.
 *  Not a blocker any more — what the confirm has to say out loud. */
export function outstandingUnderDiscipline<T extends SubLine>(subs: T[]): T[] {
  return subs.filter(s => !s.completed && outstandingOnLine(s.figures) > 0)
}

/** How many still-open sub-categories a "close the category" click will close:
 *  the ones carrying money. Empty rows have nothing to complete, and the
 *  category-level block covers them anyway. */
export function cascadeCount(subs: SubLine[]): number {
  return subs.filter(s => !s.completed && hasMoney(s.figures)).length
}

/** Budget left over once the line is closed — the money that can come out of
 *  the ERP.
 *
 *  Deliberately nets off the WO as well as the Paid: budget sitting behind an
 *  unpaid work order is committed, not spare, and telling Billing to remove it
 *  would strip cover from an invoice still to arrive. On a clean close (WO ==
 *  Paid) this is identical to budget − paid. */
export function savingsOnCompletion(f: ErpFigures | null | undefined): number {
  if (!f) return 0
  const budget = Math.round(Number(f.budget) || 0)
  const paid = Math.round(Number(f.paid) || 0)
  const wo = Math.round(Number(f.wo) || 0)
  return Math.max(0, budget - Math.max(paid, wo))
}
