// "Spent more than ERP released" — the HOD's point 4.
//
// The project view already turned a row red past 95% used, which reads as
// "nearly full" rather than "overspent". On SRAH three Civil lines are genuinely
// past their released budget (Steel Works by ₹4.03 L), and IN4 is the one saying
// so — WOs were issued above the budget. This just makes it impossible to miss.
//
// Committed (WO/PO) counts as well as Paid: money promised to a contractor is
// already gone from the budget's point of view, and it is the earlier warning.

export interface ErpFigures {
  budget: number
  wo: number
  paid: number
}

/** Rupees spent or committed beyond the released ERP budget; 0 when within it.
 *
 *  Rounded to whole rupees before comparing, because BPH/IN4 amounts carry
 *  paise: SRAH's "307 Dowels & Re-barring" is ₹59,206 budget against
 *  ₹59,206.20 paid, and flagging a 20-paise overrun as an overspend would
 *  train people to ignore the marker. */
export function overBudgetAmount(f: ErpFigures | null | undefined): number {
  if (!f) return 0
  const budget = Math.round(Number(f.budget) || 0)
  // No released budget yet is not an overrun — it is work not yet funded, and
  // the "Awaiting approval" column is already the signal for that.
  if (budget <= 0) return 0
  const worst = Math.max(Math.round(Number(f.wo) || 0), Math.round(Number(f.paid) || 0))
  return Math.max(0, worst - budget)
}

/** Which figure drove the overrun — so the label can say why. Paid wins ties:
 *  money actually out of the door is the stronger statement. */
export function overBudgetDriver(f: ErpFigures | null | undefined): 'paid' | 'committed' | null {
  if (overBudgetAmount(f) === 0 || !f) return null
  return Math.round(Number(f.paid) || 0) >= Math.round(Number(f.wo) || 0) ? 'paid' : 'committed'
}
