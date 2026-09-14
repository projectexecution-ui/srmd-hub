/** How a bill adds up, and the bills already raised on the same work order.
 *
 *  Aksha, 14 Sep 2026: "Live Example should also carry the Calculation and Live
 *  Bills - why u hav not added". Fair — the examples carried a single claimed
 *  figure, and a single figure teaches nobody how a running-account bill
 *  actually works. He also works in final GST-inclusive amounts, so the step
 *  from basic to gross is the part that matters most.
 *
 *  WHAT THIS IS BUILT ON, AND WHAT IT IS NOT
 *
 *  IN4's certificate carries the whole ladder and it reconciles to the rupee.
 *  Worked on ENP/SRASSK/NGH/2025-26/500 and the four after it:
 *
 *      certified 160,482 × 1.18            = gross 189,369   ✓
 *      189,369 − retention 48,144 − 2 − paid 138,014 = 3,209 ✓ outstanding
 *
 *  Across the 3,107 work-order certificates, gross − retention − advance −
 *  recoveries − deductions − paid = outstanding holds on 2,494 of them (80%);
 *  the rest carry part-payments and adjustments IN4 does not break out.
 *
 *  `in4_wo_abstract_items` is deliberately NOT used for the breakup. It looks
 *  like the measurement sheet and it does not reconcile: of 4,379 abstracts
 *  only 14 have lines summing to their certificate's certified amount
 *  (line totals of 38,500 against 160,482 certified, 812,000 against 284,564),
 *  and the line counts are sparse — 1, 1, 7, 1, 0 on one work order. Showing
 *  that as "the calculation" would put an authoritative-looking table of wrong
 *  numbers in front of an approver. Item-level measurement stays with IN4
 *  until the Abstract maker is built properly.
 *
 *  GST is NOT assumed to be 18%. 1,871 of 3,107 certificates (60%) have no tax
 *  at all — gross equals certified — which matches what IN4 does with labour
 *  and reimbursement bills. The rate is read off each bill, never applied.
 *
 *  Pure: the page fetches, this decides. */

export interface CertMoney {
  certificateId: number
  displayNo: string | null
  invoiceNo: string | null
  createdOn: string | null
  statusName: string | null
  /** Basic, before tax. */
  certified: number
  /** Including tax — the figure Aksha works in. */
  gross: number
  retention: number
  advanceRecovery: number
  recoveries: number
  deductions: number
  paid: number
  outstanding: number
}

export interface LadderStep {
  label: string
  amount: number
  /** A subtraction, so the screen can show it as a minus and indent it. */
  deduct?: boolean
  /** A running total — the bold lines. */
  total?: boolean
  /** The bit of arithmetic that produced it, in words. */
  note?: string
}

export interface BillLadder {
  steps: LadderStep[]
  /** Tax as a percentage, when it divides cleanly. Null when there is none,
   *  or when it is an odd figure that should not be dressed up as a rate. */
  gstPct: number | null
  /** Retention over the basic value, as IN4 actually deducted it. */
  retentionPct: number | null
  netPayable: number
  stillOwed: number
  /** False when the parts do not add up to what IN4 says is outstanding. The
   *  screen must say so rather than quietly showing a total that is wrong —
   *  this is an approval record. */
  reconciles: boolean
  /** By how much, when it does not. */
  outBy: number
  /** What IN4 itself says is still owed, so a screen can show both figures
   *  side by side rather than picking one. */
  in4Outstanding: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
/** A rate only if it lands on a sensible fraction — otherwise it is a number
 *  somebody worked out for that bill, and calling it a rate invents a rule. */
const pctOf = (part: number, whole: number): number | null => {
  if (!(whole > 0) || !(part > 0)) return null
  const pct = r2((part / whole) * 100)
  // It is a RATE only if applying it back reproduces the figure to the rupee.
  // 12.5% of 1,00,000 is exactly 12,500, so that is a rate. 11.37% gives
  // 11,370 against an actual 11,373 — that is a number somebody worked out for
  // one bill, and printing it as a rate invents a rule nobody agreed.
  return Math.abs(whole * (pct / 100) - part) < 1 ? pct : null
}

export function billLadder(c: CertMoney): BillLadder {
  const tax = r2(c.gross - c.certified)
  const gstPct = tax > 0 ? pctOf(tax, c.certified) : null
  const retentionPct = pctOf(c.retention, c.certified)

  const netPayable = r2(c.gross - c.retention - c.advanceRecovery - c.recoveries - c.deductions)
  const stillOwed = r2(netPayable - c.paid)

  const steps: LadderStep[] = [
    { label: 'Basic value certified', amount: c.certified, total: true,
      note: 'What the work is worth before tax' },
  ]

  if (tax > 0) {
    steps.push({ label: 'GST', amount: tax,
      note: gstPct != null ? `${gstPct}% on the basic value` : 'as charged on this bill' })
  } else {
    steps.push({ label: 'GST', amount: 0, note: 'none on this bill — 60% of IN4 bills carry no tax' })
  }

  steps.push({ label: 'Gross bill', amount: c.gross, total: true,
    note: 'The figure to compare against the work order' })

  if (c.retention > 0) {
    steps.push({ label: 'Retention held', amount: c.retention, deduct: true,
      note: retentionPct != null ? `${retentionPct}% of the basic value` : 'as deducted on this bill' })
  }
  if (c.advanceRecovery > 0) {
    steps.push({ label: 'Advance recovered', amount: c.advanceRecovery, deduct: true,
      note: 'Mobilisation or material advance being taken back' })
  }
  if (c.recoveries > 0) steps.push({ label: 'Other recoveries', amount: c.recoveries, deduct: true })
  if (c.deductions > 0) steps.push({ label: 'Deductions', amount: c.deductions, deduct: true })

  steps.push({ label: 'Net payable', amount: netPayable, total: true,
    note: 'What the contractor is owed on this bill' })

  if (c.paid > 0) {
    steps.push({ label: 'Already paid', amount: c.paid, deduct: true })
    steps.push({ label: 'Still owed', amount: stillOwed, total: true })
  }

  const outBy = r2(stillOwed - c.outstanding)
  return {
    steps, gstPct, retentionPct, netPayable, stillOwed,
    reconciles: Math.abs(outBy) < 1,
    outBy,
    in4Outstanding: c.outstanding,
  }
}

/** Every bill raised on one work order, oldest first, with the running position.
 *
 *  This is the "live bills" half: an approver looking at RA-6 wants to see the
 *  five before it and what is left, not take the claim on trust. */
export interface WoBillRow {
  certificateId: number
  ra: number
  displayNo: string | null
  invoiceNo: string | null
  on: string | null
  status: string | null
  certified: number
  gross: number
  retention: number
  paid: number
  outstanding: number
  /** Gross billed on this order up to and including this bill. */
  cumulativeGross: number
  /** Ordered value less that — what is left after this bill. */
  leftToBill: number
  dead: boolean
}

export interface WoHistory {
  rows: WoBillRow[]
  ordered: number
  billedGross: number
  leftToBill: number
  retentionHeld: number
  paid: number
  /** Bills that are cancelled or reversed — counted nowhere, shown greyed, but
   *  never silently dropped: 83 cancelled certificates carry ₹4.3 Cr and the
   *  first person to reconcile by hand goes looking for them. */
  deadCount: number
}

const DEAD = new Set(['cancelled', 'reversed'])

export function woHistory(certs: CertMoney[], orderedGross: number): WoHistory {
  const sorted = [...certs].sort((a, b) =>
    (a.createdOn ?? '').localeCompare(b.createdOn ?? '') || a.certificateId - b.certificateId)

  let cum = 0
  let ra = 0
  const rows: WoBillRow[] = sorted.map(c => {
    const dead = DEAD.has((c.statusName ?? '').trim().toLowerCase())
    if (!dead) { cum = r2(cum + c.gross); ra += 1 }
    return {
      certificateId: c.certificateId,
      ra: dead ? 0 : ra,
      displayNo: c.displayNo,
      invoiceNo: c.invoiceNo,
      on: c.createdOn,
      status: c.statusName,
      certified: c.certified,
      gross: c.gross,
      retention: c.retention,
      paid: c.paid,
      outstanding: c.outstanding,
      cumulativeGross: cum,
      leftToBill: Math.max(0, r2(orderedGross - cum)),
      dead,
    }
  })

  const live = rows.filter(r => !r.dead)
  return {
    rows,
    ordered: orderedGross,
    billedGross: cum,
    leftToBill: Math.max(0, r2(orderedGross - cum)),
    retentionHeld: r2(live.reduce((s, r) => s + r.retention, 0)),
    paid: r2(live.reduce((s, r) => s + r.paid, 0)),
    deadCount: rows.length - live.length,
  }
}
