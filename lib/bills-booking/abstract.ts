/** The abstract sheet — the measurement behind a bill, line by line.
 *
 *  Aksha, 14 Sep 2026: "where is the Abstract Sheet filled in Example ???"
 *  It was nowhere. The examples recorded an abstract NUMBER and never showed
 *  the sheet, which is the part anybody checking a bill actually reads.
 *
 *  I ALSO GOT THIS WRONG ONCE, so the correction is written down here.
 *
 *  I first concluded the abstract mirror was unusable, because joining
 *  `in4_wo_abstract_items.abstract_id` to `in4_wo_certificates.certificate_id`
 *  made only 14 of 4,379 abstracts add up. That join is nonsense:
 *  `abstract_id` is the ABSTRACT's own id, in its own id space, and it has
 *  nothing to do with the certificate id. The abstract even carries its own
 *  document number — `Abs/SRASSK/NGH/2025-26/481` — beside the certificate's
 *  `ENP/...`.
 *
 *  The real link is the contractor's invoice number: the abstract's `bill_no`
 *  against the certificate's `invoice_no`. On THAT join, 2,085 abstracts reach
 *  a certificate and 2,039 of them — 97.8% — have lines summing to the
 *  certified amount within ₹2. Worked by hand on WO/SRASSK/NGH/2025-26/271:
 *
 *      Abs/…/481, bill KP362SRA51 → 75,943 + 84,539 = 160,482
 *      certificate ENP/…/500 certified                = 160,482  ✓
 *
 *  A wrong join key, not bad data. Everything below is built on the right one.
 *
 *  Pure: the page fetches, this decides. */

/** One line of the work order's BOQ — what was ordered. */
export interface BoqLine {
  itemId: number
  name: string | null
  description: string | null
  uom: string | null
  orderedQty: number
  rate: number
  orderedAmt: number
}

/** One measured line on an abstract — what was executed. */
export interface AbstractLine {
  abstractId: number
  itemId: number
  /** The abstract's own document number, Abs/… — not the certificate's ENP. */
  abstractNo: string | null
  /** The contractor's invoice number, which is what ties it to a certificate. */
  billNo: string | null
  on: string | null
  qty: number
  rate: number
  amt: number
}

export interface SheetRow {
  itemId: number
  item: string
  uom: string | null
  orderedQty: number
  rate: number
  orderedAmt: number
  /** Measured on THIS bill. */
  thisQty: number
  thisAmt: number
  /** Everything measured on this item up to and including this bill. */
  cumulativeQty: number
  cumulativeAmt: number
  /** Ordered less cumulative — what is still to do on this line. */
  balanceQty: number
  balanceAmt: number
  /** True when this bill finishes the line. */
  complete: boolean
  /** Measured beyond what was ordered — worth seeing before it is approved. */
  overrun: boolean
}

export interface AbstractSheet {
  abstractNo: string | null
  billNo: string | null
  on: string | null
  rows: SheetRow[]
  /** Sums across the rows on screen. */
  thisBill: number
  cumulative: number
  ordered: number
  balance: number
  /** What IN4 certified for this bill. */
  certified: number
  /** Whether the lines add up to it. Shown either way — a measurement sheet
   *  that quietly disagrees with the money is the thing worth catching. */
  reconciles: boolean
  outBy: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const q3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Build the sheet for one bill.
 *
 * `earlier` is every line measured on the same work order BEFORE this abstract
 * — that is what makes the cumulative column, and it is why a running-account
 * bill can be checked at all: this bill's quantity is only meaningful against
 * what has already been billed and what was ordered.
 */
export function buildAbstractSheet(
  mine: AbstractLine[],
  earlier: AbstractLine[],
  boq: BoqLine[],
  certified: number,
): AbstractSheet {
  const boqBy = new Map(boq.map(b => [b.itemId, b]))

  const priorQty = new Map<number, number>()
  const priorAmt = new Map<number, number>()
  for (const e of earlier) {
    priorQty.set(e.itemId, (priorQty.get(e.itemId) ?? 0) + e.qty)
    priorAmt.set(e.itemId, (priorAmt.get(e.itemId) ?? 0) + e.amt)
  }

  // One row per item on this bill, even where the same item was split across
  // two lines of the same abstract.
  const merged = new Map<number, { qty: number; amt: number; rate: number }>()
  for (const l of mine) {
    const cur = merged.get(l.itemId)
    if (cur) { cur.qty += l.qty; cur.amt += l.amt }
    else merged.set(l.itemId, { qty: l.qty, amt: l.amt, rate: l.rate })
  }

  const rows: SheetRow[] = [...merged.entries()].map(([itemId, m]) => {
    const b = boqBy.get(itemId)
    const orderedQty = b?.orderedQty ?? 0
    const cumulativeQty = q3((priorQty.get(itemId) ?? 0) + m.qty)
    const cumulativeAmt = r2((priorAmt.get(itemId) ?? 0) + m.amt)
    const balanceQty = q3(orderedQty - cumulativeQty)
    return {
      itemId,
      // The BOQ's own wording. IN4 repeats a heading across many lines, so the
      // description is preferred where it exists — it is what distinguishes them.
      item: (b?.description?.trim() || b?.name?.trim() || `Item ${itemId}`),
      uom: b?.uom ?? null,
      orderedQty,
      rate: m.rate || b?.rate || 0,
      orderedAmt: b?.orderedAmt ?? 0,
      thisQty: q3(m.qty),
      thisAmt: r2(m.amt),
      cumulativeQty,
      cumulativeAmt,
      balanceQty: Math.abs(balanceQty) < 0.001 ? 0 : balanceQty,
      balanceAmt: r2((b?.orderedAmt ?? 0) - cumulativeAmt),
      // Within a thousandth of the ordered quantity is finished, not 0.001 short.
      complete: orderedQty > 0 && Math.abs(balanceQty) < 0.001,
      overrun: orderedQty > 0 && balanceQty < -0.001,
    }
  })

  // Biggest money on this bill first — that is the order somebody checking
  // would work in.
  rows.sort((a, b) => b.thisAmt - a.thisAmt)

  const thisBill = r2(rows.reduce((s, r) => s + r.thisAmt, 0))
  const outBy = r2(thisBill - certified)
  const first = mine[0]

  return {
    abstractNo: first?.abstractNo ?? null,
    billNo: first?.billNo ?? null,
    on: first?.on ?? null,
    rows,
    thisBill,
    cumulative: r2(rows.reduce((s, r) => s + r.cumulativeAmt, 0)),
    ordered: r2(rows.reduce((s, r) => s + r.orderedAmt, 0)),
    balance: r2(rows.reduce((s, r) => s + r.balanceAmt, 0)),
    certified,
    // ₹2, because IN4 rounds each line and the total can drift by a rupee
    // either way — 85,511 + 199,054 = 284,565 against 284,564 certified.
    reconciles: certified > 0 ? Math.abs(outBy) <= 2 : true,
    outBy,
  }
}
