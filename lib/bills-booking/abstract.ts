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
  /** What each EARLIER bill measured on this item, oldest first.
   *
   *  Aksha, 15 Sep 2026: "all RA bills should show not only previous Bill
   *  total". A single Previous column tells you how much came before but not
   *  which bill it came on, and on a running account that is exactly what is
   *  being checked — whether RA-3 quietly re-measured what RA-2 already had. */
  history: number[]
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

/** One bill on the order that came BEFORE this one — one column on the sheet.
 *
 *  Aksha, 15 Sep 2026: "can u see there are so many RA - but the Abstract only
 *  shownh 2 or 3 RA". Nine bills on the register, two columns on the sheet.
 *  The columns were built out of the ABSTRACT mirror, and the abstract mirror
 *  is not the bill register:
 *
 *    · 2,012 of 4,057 certified bills have no abstract in the mirror at all,
 *      so they were simply missing from the sheet; and
 *    · IN4 lets one abstract cover several bills — on WO/SRET/WH/2025-26/210
 *      the sheet "RU-WH-CV/01,02 & 03" answers three certificates — so three
 *      bills collapsed into one column, and everything after it was numbered
 *      wrong. The sheet said RA-2 for the bill the register calls RA-4.
 *
 *  So the columns come from the BILL REGISTER now — the same ladder as the
 *  "Bills on …" panel, the same RA numbers — and the measurement is attached
 *  to it. */
export interface EarlierBill {
  /** What the register calls it: "RA-4", or "RA-1–3" where one abstract
   *  answered three bills. Null for an abstract that no bill accounts for. */
  label: string | null
  billNo: string | null
  on: string | null
  /** False when the bill is on the register but IN4 holds no measurement for
   *  it. The column is then blank because nothing was measured — not because
   *  zero was. Saying which is which is the whole point of showing it. */
  measured: boolean
}

/** One bill on the register, oldest first — `ra` is its position, exactly as
 *  `woHistory` numbers it, so the sheet and the bills panel agree. */
export interface LadderBill {
  ra: number
  invoiceNo: string | null
  on: string | null
  certified: number
}

export interface AbstractSheet {
  /** The earlier bills on this work order, oldest first — one column each.
   *  Empty when this is the first bill, which is when the whole group is
   *  dropped rather than drawn as a row of dashes. */
  earlierBills: EarlierBill[]
  /** How many of them IN4 has no measurement sheet for. Said out loud on the
   *  screen: their quantity is missing from Previous and from the cumulative,
   *  and an approver checking a running account has to know that. */
  unmeasured: number
  abstractNo: string | null
  billNo: string | null
  on: string | null
  rows: SheetRow[]
  /** Sums across the rows on screen. */
  thisBill: number
  cumulative: number
  ordered: number
  balance: number
  /** What IN4 certified for this bill. Null when no certificate exists yet —
   *  the Site Head has made the abstract in IN4 and Billing has not keyed the
   *  payment certificate, which is where a bill spends most of its life. There
   *  is then nothing to reconcile against, and claiming a match either way
   *  would be a lie. */
  certified: number | null
  /** Whether the lines add up to it. Null while there is no certified figure.
   *  Shown either way once there is — a measurement sheet that quietly
   *  disagrees with the money is the thing worth catching. */
  reconciles: boolean | null
  outBy: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const q3 = (n: number) => Math.round(n * 1000) / 1000
const key = (s: string | null) => (s ?? '').trim().toLowerCase()

/** Work out the Previous columns: one per earlier bill on the register, with
 *  the abstract that measured it attached.
 *
 *  Three passes, in order of how much they can be trusted:
 *
 *   1. the abstract's bill number IS a bill on the register — the same number
 *      the clerk typed twice, which is the link this whole module runs on;
 *   2. one abstract across a RUN of bills. Proven on the MONEY, never by
 *      reading "01,02 & 03" out of the text: the run's certified amounts have
 *      to add up to the abstract within ₹2. On WO/SRET/WH/2025-26/210 that is
 *      31,27,174 + 3,89,879 + 34,92,189 = 70,09,243 against an abstract of
 *      70,09,244, which is proof; a parsed string would only be a guess;
 *   3. anything left over — an abstract IN4 holds with no bill raised against
 *      it yet — keeps its own column, by date, with no RA number, because
 *      inventing one would put it in a sequence it is not in.
 *
 *  A bill nothing attaches to still gets its column. It is on the register, it
 *  is part of the running account, and leaving it out is what caused this. */
export function earlierColumns(
  earlier: AbstractLine[],
  ladder: LadderBill[],
): { columns: EarlierBill[]; columnOf: Map<string, number> } {
  // The abstracts, grouped by the contractor's bill number, oldest first.
  const groups: Array<{ k: string; billNo: string | null; on: string | null; total: number }> = []
  const byKey = new Map<string, (typeof groups)[number]>()
  for (const e of [...earlier].sort((a, b) =>
    (a.on ?? '').localeCompare(b.on ?? '') || a.abstractId - b.abstractId)) {
    const k = key(e.billNo)
    let g = byKey.get(k)
    if (!g) { g = { k, billNo: e.billNo, on: e.on, total: 0 }; byKey.set(k, g); groups.push(g) }
    g.total = r2(g.total + e.amt)
  }

  const owner = new Array<number>(ladder.length).fill(-1)

  // 1 — same bill number.
  ladder.forEach((b, i) => {
    const g = groups.findIndex(x => x.k && x.k === key(b.invoiceNo))
    if (g >= 0) owner[i] = g
  })

  // 2 — one abstract across a run of bills, only where the money says so. A
  //     run of one is never matched this way: two bills of the same value on
  //     one order is common, and that would pair the wrong ones.
  groups.forEach((g, gi) => {
    if (owner.includes(gi) || !(g.total > 0)) return
    for (let a = 0; a < ladder.length; a++) {
      if (owner[a] !== -1) continue
      let sum = 0
      for (let b = a; b < ladder.length && owner[b] === -1; b++) {
        sum = r2(sum + ladder[b].certified)
        if (b > a && Math.abs(sum - g.total) <= 2) {
          for (let x = a; x <= b; x++) owner[x] = gi
          return
        }
        if (sum - g.total > 2) break
      }
    }
  })

  // Build the columns: the register in order, runs merged, then the orphan
  // abstracts slotted in by date.
  type Col = EarlierBill & { seq: number; k: string | null }
  const cols: Col[] = []
  for (let i = 0; i < ladder.length;) {
    const g = owner[i]
    let j = i
    while (g !== -1 && j + 1 < ladder.length && owner[j + 1] === g) j++
    const from = ladder[i], to = ladder[j]
    const grp = g === -1 ? null : groups[g]
    cols.push({
      label: i === j ? `RA-${from.ra}` : `RA-${from.ra}–${to.ra}`,
      billNo: grp?.billNo ?? from.invoiceNo,
      on: from.on ?? grp?.on ?? null,
      measured: g !== -1,
      seq: i,
      k: grp?.k ?? null,
    })
    i = j + 1
  }
  groups.forEach((g, gi) => {
    if (owner.includes(gi)) return
    cols.push({ label: null, billNo: g.billNo, on: g.on, measured: true, seq: ladder.length + gi, k: g.k })
  })
  cols.sort((a, b) => (a.on ?? '').localeCompare(b.on ?? '') || a.seq - b.seq)

  const columnOf = new Map<string, number>()
  cols.forEach((c, i) => { if (c.k) columnOf.set(c.k, i) })
  return {
    columns: cols.map(({ label, billNo, on, measured }) => ({ label, billNo, on, measured })),
    columnOf,
  }
}

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
  certified: number | null,
  /** Every bill raised on this order BEFORE this one, oldest first. Defaults to
   *  none, which falls back to a column per abstract — what it did before. */
  ladder: LadderBill[] = [],
): AbstractSheet {
  const boqBy = new Map(boq.map(b => [b.itemId, b]))

  const priorQty = new Map<number, number>()
  const priorAmt = new Map<number, number>()
  for (const e of earlier) {
    priorQty.set(e.itemId, (priorQty.get(e.itemId) ?? 0) + e.qty)
    priorAmt.set(e.itemId, (priorAmt.get(e.itemId) ?? 0) + e.amt)
  }

  // The earlier bills as COLUMNS, oldest first — off the bill register, so the
  // RA numbers are the ones on the "Bills on …" panel. See earlierColumns.
  const { columns: earlierBills, columnOf } = earlierColumns(earlier, ladder)

  // qty per (item, earlier bill)
  const perBill = new Map<number, number[]>()
  for (const e of earlier) {
    const col = columnOf.get(key(e.billNo))
    if (col == null) continue
    let row = perBill.get(e.itemId)
    if (!row) { row = new Array(earlierBills.length).fill(0); perBill.set(e.itemId, row) }
    row[col] = q3(row[col] + e.qty)
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
      history: perBill.get(itemId) ?? new Array(earlierBills.length).fill(0),
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
  // Nothing to compare against until Billing keys the certificate.
  const outBy = certified == null ? 0 : r2(thisBill - certified)
  const first = mine[0]

  return {
    earlierBills,
    unmeasured: earlierBills.filter(b => !b.measured).length,
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
    reconciles: certified == null ? null : certified > 0 ? Math.abs(outBy) <= 2 : true,
    outBy,
  }
}
