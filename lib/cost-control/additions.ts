// Naming what sits between the BOQ rows and the approved figure.
//
// The footer used to print one line — "GST / additions +₹9,89,112" — which
// told the approver that something was added but not what. On the standard
// template that gap is always the same ladder:
//
//     subtotal → + contingency % → + GST % → grand total
//
// Three ways to get at it, in descending order of trust:
//
//  1. `stored` — the percentages the engineer confirmed on the review grid,
//     saved with the sheet. Authoritative; used for every sheet raised after
//     Aug 2026.
//  2. Solved — for the sheets raised before we saved it, work the two
//     percentages back out of the subtotal and the grand total. Only accepted
//     when EXACTLY ONE candidate pair reproduces the total to the rupee; on
//     the 23 live sheets with a positive gap this resolves every one, with no
//     ties (0/5/10% contingency, 18% GST throughout).
//  3. Neither — say "not itemised" rather than invent a split.
//
// And the case the old label got outright wrong: on the 29 imported budget
// sheets the rows total MORE than the approved figure, so it was printing a
// negative number under the heading "GST / additions". That is not an
// addition, and it now reads as what it is.

export type AdditionsSource =
  /** Read from the percentages saved with the sheet. */
  | 'sheet'
  /** Worked back out of the subtotal and the grand total. */
  | 'derived'
  /** There is a gap, but nothing names it. */
  | 'unnamed'
  /** The rows add up to MORE than the approved figure. */
  | 'overrun'

export interface AdditionLine {
  label: string
  amount: number
}

export interface AdditionsBreakdown {
  /** grandTotal − rowsTotal. Negative for an overrun. */
  total: number
  lines: AdditionLine[]
  source: AdditionsSource
  /** Shown under the lines when the split was worked out rather than read. */
  note: string | null
}

/** The ladder as saved on the working sheet (all four null on older rows). */
export interface StoredLadder {
  contingencyPct: number | null
  contingencyAmt: number | null
  gstPct: number | null
  gstAmt: number | null
}

/** Contingency rates seen in SRMD sheets, plus the neighbouring round ones. */
const CONTINGENCY_PCTS = [0, 1, 2, 2.5, 3, 5, 7.5, 10]
/** The statutory GST slabs. Nothing else is legal, so nothing else is tried. */
const GST_PCTS = [0, 5, 12, 18, 28]

/** Rupees. Excel rounds each ladder step, so an exact match still drifts a
 *  rupee or two by the grand total. */
const TOLERANCE = 2
/** Below this a "gap" is just floating-point dust from summing the rows. */
const MIN_GAP = 1

const pctLabel = (name: string, pct: number | null): string =>
  pct != null && pct > 0 ? `${name} @ ${pct}%` : name

/** Contingency and GST for one candidate pair, compounded the way the
 *  template computes them: GST applies to subtotal + contingency. */
export function ladderFor(
  subtotal: number, contingencyPct: number | null, gstPct: number | null,
): { contingency: number; gst: number; grandTotal: number } {
  const contingency = contingencyPct != null ? Math.round(subtotal * contingencyPct / 100) : 0
  const gst = gstPct != null ? Math.round((subtotal + contingency) * gstPct / 100) : 0
  return { contingency, gst, grandTotal: subtotal + contingency + gst }
}

/** Work the two percentages back out of the two totals. Returns null unless
 *  exactly one pair fits — a tie means we don't know, and guessing between
 *  them would put a wrong percentage in front of an approver. */
export function solveLadder(
  subtotal: number, grandTotal: number,
): { contingencyPct: number; gstPct: number } | null {
  const hits: { contingencyPct: number; gstPct: number }[] = []
  for (const c of CONTINGENCY_PCTS) {
    for (const g of GST_PCTS) {
      if (c === 0 && g === 0) continue
      const { grandTotal: computed } = ladderFor(subtotal, c, g)
      if (Math.abs(computed - grandTotal) <= TOLERANCE) hits.push({ contingencyPct: c, gstPct: g })
    }
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * What to print between "Rows total" and "Grand total".
 * Returns null when the rows already add up to the approved figure.
 */
export function explainAdditions(
  rowsTotal: number,
  grandTotal: number,
  stored?: StoredLadder | null,
): AdditionsBreakdown | null {
  const total = grandTotal - rowsTotal
  if (Math.abs(total) <= MIN_GAP) return null

  // The rows say more than the sheet is asking for. Not an addition — usually
  // an imported budget whose rows cover a wider scope than this request.
  if (total < 0) {
    return {
      total,
      source: 'overrun',
      lines: [{ label: 'Rows read from the sheet exceed the approved figure', amount: total }],
      note: 'The approved figure is the one that counts — the extra rows are not part of this request.',
    }
  }

  // 1. The percentages the engineer confirmed, if they still reconcile. (A row
  //    edited after upload can leave them stale; fall through rather than show
  //    a split that doesn't add up.)
  if (stored) {
    const c = stored.contingencyAmt ?? 0
    const g = stored.gstAmt ?? 0
    if ((c > 0 || g > 0) && Math.abs(c + g - total) <= TOLERANCE) {
      return { total, source: 'sheet', lines: ladderLines(c, g, stored.contingencyPct, stored.gstPct), note: null }
    }
  }

  // 2. Work it out of the two totals.
  const solved = solveLadder(rowsTotal, grandTotal)
  if (solved) {
    const { contingency, gst } = ladderFor(rowsTotal, solved.contingencyPct, solved.gstPct)
    return {
      total,
      source: 'derived',
      lines: ladderLines(contingency, gst, solved.contingencyPct, solved.gstPct),
      note: 'Worked out from the sheet’s own subtotal and grand total.',
    }
  }

  // 3. Don't invent one.
  return {
    total,
    source: 'unnamed',
    lines: [{ label: 'Other additions in the sheet — not itemised', amount: total }],
    note: null,
  }
}

function ladderLines(
  contingency: number, gst: number, contingencyPct: number | null, gstPct: number | null,
): AdditionLine[] {
  const lines: AdditionLine[] = []
  if (contingency > 0) lines.push({ label: pctLabel('Contingency', contingencyPct), amount: contingency })
  if (gst > 0) lines.push({ label: pctLabel('GST', gstPct), amount: gst })
  return lines
}
