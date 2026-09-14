/** The Abstract maker's arithmetic.
 *
 *  Aksha, 14 Sep 2026: "make the Abstract maker in CT Hub … it should be in
 *  screenshot format" — the concept sheet from the design phase. One row per
 *  BOQ item, four column groups, and exactly ONE typed number per row:
 *
 *      #  Particular  Qty  Unit  Rate | WO Amt | This Qty  This Amt |
 *                                       Cum Qty  Cum Amt | Bal Qty  Bal Amt
 *
 *  then Sub total → GST → Total → less Retention → NET PAYABLE, each carried
 *  across all three groups, because the question is never only "what is this
 *  bill" — it is "what is this bill, what has been billed, and what is left".
 *
 *  Nothing but This Qty is typed. The rate is what the work order ordered: a
 *  rate somebody can retype is a rate that ends up wrong, and the BOQ mirror
 *  is exact — on all eight example orders it sums to the ordered value to the
 *  rupee.
 *
 *  Pure, so the sheet can be checked without a database or a browser. */

export interface MakerLine {
  /** The IN4 BOQ item, when the line comes from the order. */
  itemId: number | null
  sr: number
  particular: string
  uom: string | null
  orderedQty: number
  rate: number
  orderedAmt: number
  /** Measured on earlier bills for this item. */
  priorQty: number
  priorAmt: number
  /** The one number a person types. */
  thisQty: number
}

export interface PricedLine extends MakerLine {
  thisAmt: number
  cumQty: number
  cumAmt: number
  balQty: number
  balAmt: number
  complete: boolean
  /** Measured past what was ordered — the thing to catch before approval. */
  overrun: boolean
}

/** One figure in each of the three groups. */
export interface TotalRow {
  label: string
  thisBill: number
  cumulative: number
  balance: number
  kind: 'sub' | 'gst' | 'total' | 'retention' | 'net'
  /** Shown beside the label: "GST @ 18%". */
  rate?: number
}

export interface PricedSheet {
  lines: PricedLine[]
  totals: TotalRow[]
  /** The green figure at the bottom — what this bill is worth. */
  netThisBill: number
  grossThisBill: number
  basicThisBill: number
  /** Share of the ordered value this bill represents, for the "12% ·" prefix. */
  pctOfOrder: number
  anyOverrun: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const q3 = (n: number) => Math.round(n * 1000) / 1000

export function priceAbstract(
  lines: MakerLine[],
  rates: { gstPct: number; retentionPct: number },
): PricedSheet {
  const priced: PricedLine[] = lines.map(l => {
    const thisAmt = r2(l.thisQty * l.rate)
    const cumQty = q3(l.priorQty + l.thisQty)
    const cumAmt = r2(l.priorAmt + thisAmt)
    const balQty = q3(l.orderedQty - cumQty)
    return {
      ...l,
      thisAmt,
      cumQty,
      cumAmt,
      balQty: Math.abs(balQty) < 0.001 ? 0 : balQty,
      balAmt: r2(l.orderedAmt - cumAmt),
      complete: l.orderedQty > 0 && Math.abs(balQty) < 0.001,
      overrun: l.orderedQty > 0 && balQty < -0.001,
    }
  })

  const sum = (pick: (l: PricedLine) => number) => r2(priced.reduce((s, l) => s + pick(l), 0))

  const basic = { thisBill: sum(l => l.thisAmt), cumulative: sum(l => l.cumAmt), balance: sum(l => l.balAmt) }
  const pct = (n: number) => r2(n * rates.gstPct / 100)
  const ret = (n: number) => r2(n * rates.retentionPct / 100)

  const gst = { thisBill: pct(basic.thisBill), cumulative: pct(basic.cumulative), balance: pct(basic.balance) }
  const total = {
    thisBill: r2(basic.thisBill + gst.thisBill),
    cumulative: r2(basic.cumulative + gst.cumulative),
    balance: r2(basic.balance + gst.balance),
  }
  const retention = { thisBill: ret(basic.thisBill), cumulative: ret(basic.cumulative), balance: ret(basic.balance) }
  const net = {
    thisBill: r2(total.thisBill - retention.thisBill),
    cumulative: r2(total.cumulative - retention.cumulative),
    // Retention on work not yet done is not money held — it is money that will
    // be held. Carrying it as a deduction here would understate what is left.
    balance: total.balance,
  }

  const orderedTotal = r2(priced.reduce((s, l) => s + l.orderedAmt, 0))

  return {
    lines: priced,
    totals: [
      { label: 'Sub Total', kind: 'sub', ...basic },
      { label: 'GST', kind: 'gst', rate: rates.gstPct, ...gst },
      { label: 'Total Amount', kind: 'total', ...total },
      { label: 'Retention', kind: 'retention', rate: rates.retentionPct, ...retention },
      { label: 'Net Payable Amount', kind: 'net', ...net },
    ],
    netThisBill: net.thisBill,
    grossThisBill: total.thisBill,
    basicThisBill: basic.thisBill,
    pctOfOrder: orderedTotal > 0 ? Math.round((basic.thisBill / orderedTotal) * 100) : 0,
    anyOverrun: priced.some(l => l.overrun),
  }
}

/** Seed a fresh sheet from the work order's BOQ, with what has already been
 *  measured folded in — so the first thing a Site Head sees is the balance
 *  still to do, not a blank page. */
export function seedLines(
  boq: Array<{ itemId: number; name: string | null; description: string | null; uom: string | null; orderedQty: number; rate: number; orderedAmt: number }>,
  measured: Map<number, { qty: number; amt: number }>,
): MakerLine[] {
  return boq.map((b, i) => {
    const prior = measured.get(b.itemId)
    return {
      itemId: b.itemId,
      sr: i + 1,
      // IN4 repeats one heading across a dozen lines; the description is what
      // tells them apart, so it wins where it exists.
      particular: (b.description?.trim() || b.name?.trim() || `Item ${b.itemId}`),
      uom: b.uom,
      orderedQty: b.orderedQty,
      rate: b.rate,
      orderedAmt: b.orderedAmt,
      priorQty: prior?.qty ?? 0,
      priorAmt: prior?.amt ?? 0,
      thisQty: 0,
    }
  })
}
