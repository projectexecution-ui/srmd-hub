/** What a purchase-order bill is actually made of.
 *
 *  Aksha, 15 Sep 2026, correcting me on four counts:
 *
 *    "PO comes with Material name and Qty etc"
 *    "Supplier Certificate is raised - pls check post GRN - so instead of
 *     Abstract PO follows GRN"
 *    "Advance are done as per terms"
 *    "the PO value can be taken and tracked as per the Bills recieved"
 *
 *  He is right on all four, and the mirror backs every one of them:
 *
 *  MATERIALS. A purchase order is a BOQ. All 5,080 lines carry a material that
 *  names, a UOM, an ordered quantity, a rate, a value — and `grn_qty`, which is
 *  how much of that line has been received to date. I had called it "no scope"
 *  and made somebody type it. Wrong.
 *
 *  GRN. The supplier certificate is raised against goods received, so the GRN
 *  IS the measurement — the purchase side's abstract sheet. Every one of the
 *  4,494 pay lines carries a `grn_id`, and the lines of a bill sum to that
 *  bill's landed cost on 1,376 of 1,376 certificates — 100%, against the
 *  work-order abstract's 97.8%. The purchase side reconciles more reliably than
 *  the contractor side does.
 *
 *  The MONEY is therefore exact. The QUANTITY is not always: a bill can pay for
 *  part of a receipt, and on 859 of 4,389 line groups the pay line's money and
 *  the receipt line's cost disagree. Checked on the newest bill of
 *  PO/SRASSK/NGH/2026-27/9 — ₹94,400 billed against a receipt that records 160
 *  RMT costing ₹1,88,800, so the bill covers half of it. The quantity is shown
 *  only where the two agree; where they do not, the receipt's own figure is
 *  shown as context and the bill's share is left unstated rather than derived.
 *  Dividing money by money gave a share of 95× on one line in the live data.
 *
 *  ADVANCE. 215 purchase orders took one, ₹9.9 Cr in total, and ₹8.48 Cr has
 *  been recovered out of later bills with 169 of them fully square. That is a
 *  contractual position somebody has to see, not noise to filter out. It stays
 *  out of "billed against the order" — an advance is not a bill, and adding it
 *  would show the order spent twice — and is shown on its own instead.
 *
 *  Pure: the page fetches, this decides. */

const r2 = (n: number) => Math.round(n * 100) / 100
const q3 = (n: number) => Math.round(n * 1000) / 1000

/* ── the GRN behind one bill ─────────────────────────────────────────────── */

/** One line of the supplier's bill, as IN4 holds it. */
export interface PayLine {
  grnId: number | null
  materialId: number | null
  /** Gross for this line — what sums to the certificate. */
  landed: number
  certified: number
}

/** A goods-receipt line: what physically arrived, and what it cost. */
export interface GrnItem {
  grnId: number | null
  materialId: number | null
  qty: number
  /** What the receipt values that quantity at. The only way to tell whether a
   *  bill line covers this whole receipt line or just part of it. */
  cost: number
  no: string | null
  on: string | null
  challanNo: string | null
}

/** A line of the purchase order — the BOQ this is measured against. */
export interface PoLine {
  materialId: number | null
  material: string
  uom: string | null
  orderedQty: number
  rate: number
  orderedAmt: number
  /** Received against this line to date, IN4's own running figure. */
  receivedQty: number
}

export interface GrnRow {
  materialId: number | null
  material: string
  uom: string | null
  /** Billed on THIS bill.
   *
   *  Only filled when IN4's own two tables agree: the pay line's money for that
   *  (receipt, material) equals what the receipt says the goods cost, which
   *  holds on 3,530 of 4,389 line groups (80%). Then the quantity is certain.
   *
   *  It is NOT derived by proportion when they disagree. A bill can pay for
   *  part of a receipt, and dividing money by money to get a quantity produced
   *  a share of 95× on one line in the live data. Putting a made-up quantity in
   *  front of an approver is worse than saying it is not stated — and the money
   *  column, which reconciles to the rupee on every certificate, is what is
   *  being approved. */
  thisQty: number | null
  /** What the receipt recorded, when this bill covers only part of it. Context
   *  for the blank above, so it reads as "part of 160" rather than "unknown". */
  receiptQty: number | null
  thisAmt: number
  orderedQty: number
  rate: number
  /** Received against the order to date. */
  receivedQty: number
  balanceQty: number
  complete: boolean
  /** More received than was ordered — the thing to catch before payment. */
  overrun: boolean
  /** True when the line is not on the purchase order at all: a freight or
   *  handling charge added at receipt. Priced, but not measured. */
  offOrder: boolean
}

export interface GrnSheet {
  rows: GrnRow[]
  /** The goods receipts this bill draws on. Usually one; up to eleven. */
  grns: Array<{ no: string | null; on: string | null; challan: string | null }>
  /** The lines' own total, gross. */
  thisBill: number
  /** What IN4 says the bill is, gross. */
  landed: number
  reconciles: boolean
  outBy: number
  anyOverrun: boolean
}

export function buildGrnSheet(
  lines: PayLine[], receipts: GrnItem[], order: PoLine[], landed: number,
): GrnSheet | null {
  if (!lines.length) return null

  // Quantity comes from the receipt, money from the pay line. They are matched
  // on (GRN, material) — the only key both carry — and a receipt can record the
  // same material more than once, so the pair is summed before comparing.
  const receipt = new Map<string, { qty: number; cost: number }>()
  const headers = new Map<number, { no: string | null; on: string | null; challan: string | null }>()
  for (const g of receipts) {
    if (g.grnId == null) continue
    if (g.materialId != null) {
      const k = `${g.grnId}:${g.materialId}`
      const cur = receipt.get(k) ?? { qty: 0, cost: 0 }
      receipt.set(k, { qty: q3(cur.qty + g.qty), cost: r2(cur.cost + g.cost) })
    }
    if (!headers.has(g.grnId)) headers.set(g.grnId, { no: g.no, on: g.on, challan: g.challanNo })
  }

  const ordered = new Map<number, PoLine>()
  for (const o of order) if (o.materialId != null) ordered.set(o.materialId, o)

  // One row per material. A bill can draw on several GRNs, and the same
  // material can arrive on more than one of them.
  const byMaterial = new Map<number | string, GrnRow>()
  const usedGrns = new Set<number>()

  // Lines of the same material are folded together, but the quantity only
  // survives that if EVERY one of them was certain. One unmatched line makes
  // the row's quantity unknown rather than quietly short.
  const certain = new Map<number | string, boolean>()

  for (const l of lines) {
    if (l.grnId != null) usedGrns.add(l.grnId)
    const key = l.materialId ?? `x-${byMaterial.size}`
    const po = l.materialId != null ? ordered.get(l.materialId) : undefined
    const k = l.grnId != null && l.materialId != null ? `${l.grnId}:${l.materialId}` : null
    const got = k != null ? receipt.get(k) : undefined
    // Certain only when IN4's two tables agree to the rupee on this line.
    const exact = !!got && Math.abs(l.landed - got.cost) < 1

    const seen = byMaterial.get(key)
    if (seen) {
      seen.thisAmt = r2(seen.thisAmt + l.landed)
      if (got) seen.receiptQty = q3((seen.receiptQty ?? 0) + got.qty)
      if (exact && certain.get(key)) seen.thisQty = q3((seen.thisQty ?? 0) + got!.qty)
      else { certain.set(key, false); seen.thisQty = null }
      continue
    }

    certain.set(key, exact)
    const orderedQty = po?.orderedQty ?? 0
    const receivedQty = po?.receivedQty ?? 0
    const balanceQty = q3(orderedQty - receivedQty)
    byMaterial.set(key, {
      materialId: l.materialId,
      material: po?.material ?? 'Not on the purchase order',
      uom: po?.uom ?? null,
      thisQty: exact ? got!.qty : null,
      receiptQty: got?.qty ?? null,
      thisAmt: r2(l.landed),
      orderedQty,
      rate: po?.rate ?? 0,
      receivedQty,
      balanceQty: Math.abs(balanceQty) < 0.001 ? 0 : balanceQty,
      complete: orderedQty > 0 && Math.abs(balanceQty) < 0.001,
      overrun: orderedQty > 0 && balanceQty < -0.001,
      offOrder: !po,
    })
  }

  // Biggest first — how anybody checks a bill.
  const rows = [...byMaterial.values()].sort((a, b) => b.thisAmt - a.thisAmt)
  const thisBill = r2(rows.reduce((s, r) => s + r.thisAmt, 0))
  const outBy = r2(thisBill - landed)

  return {
    rows,
    // IN4 reuses one GRN number across many receipts on the same order —
    // "GRN/SRASSK/NGH/2026-27/1" appears on a dozen different dates — so the
    // date is what tells them apart, and identical pairs are folded.
    grns: dedupe([...usedGrns].map(id => headers.get(id) ?? { no: null, on: null, challan: null }))
      .sort((a, b) => (a.on ?? '').localeCompare(b.on ?? '')),
    thisBill,
    landed,
    reconciles: Math.abs(outBy) < 2,
    outBy,
    anyOverrun: rows.some(r => r.overrun),
  }
}

function dedupe(gs: Array<{ no: string | null; on: string | null; challan: string | null }>) {
  const seen = new Set<string>()
  return gs.filter(g => {
    const k = `${g.no}|${g.on}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* ── the advance, and how much of it is left ─────────────────────────────── */

/** An advance is paid on the terms of the order and recovered out of the bills
 *  that follow it. Both halves have to be visible, or a bill whose payable
 *  collapses to nothing looks like a mistake instead of a recovery. */
export interface AdvancePosition {
  /** How many advance certificates the order carries. */
  count: number
  /** What was sanctioned as advance, gross. */
  taken: number
  /** What has actually been paid out of that. */
  paid: number
  /** Recovered across every bill on the order so far. */
  recovered: number
  /** Still to be recovered out of future bills. */
  outstanding: number
  /** Recovered on THIS bill — the line in the ladder above. */
  thisBill: number
  settled: boolean
}

export function advancePosition(
  advances: Array<{ gross: number; paid: number }>,
  recoveredOnBills: number,
  thisBill: number,
): AdvancePosition | null {
  if (!advances.length) return null
  const taken = r2(advances.reduce((s, a) => s + a.gross, 0))
  const recovered = r2(recoveredOnBills)
  const outstanding = Math.max(0, r2(taken - recovered))
  return {
    count: advances.length,
    taken,
    paid: r2(advances.reduce((s, a) => s + a.paid, 0)),
    recovered,
    outstanding,
    thisBill: r2(thisBill),
    settled: outstanding < 1,
  }
}

/* ── what the order is for, in words ─────────────────────────────────────── */

/** The materials on a purchase order, biggest first, as a single line.
 *
 *  This is the scope. It used to be asked for, on the grounds that IN4 held
 *  none — it holds it on every line of all 1,451 orders. */
export function poScope(
  lines: Array<{ material: string; orderedAmt: number }>, maxChars = 90,
): string | null {
  const named = lines
    .filter(l => l.material.trim())
    .sort((a, b) => b.orderedAmt - a.orderedAmt)
  if (!named.length) return null

  const parts: string[] = []
  let used = 0
  for (const l of named) {
    const name = l.material.trim()
    if (parts.length && used + name.length + 2 > maxChars) break
    parts.push(name)
    used += name.length + 2
  }
  const rest = named.length - parts.length
  return parts.join(', ') + (rest > 0 ? ` and ${rest} more` : '')
}
