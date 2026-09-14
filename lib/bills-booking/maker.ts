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

/* ── which rate to open the sheet on ─────────────────────────────────────── */

/**
 * Aksha, 14 Sep 2026, on seeing "GST @ 14.4%": "can u check why GST is shown
 * like this - if its for example then its fine - else u need to chheck for
 * flaw."
 *
 * It was a flaw, and a bad one. The sheet opened on a BLENDED AVERAGE across
 * every bill of the order:
 *
 *     Σ(gross − certified) ÷ Σ certified
 *
 * On WO/SRASSK/SQ/2023-24/7 that gives 14.4% GST and 4% retention. Its 27
 * bills carry 0% or 18% GST and 0% or 5% retention. NOTHING carries 14.4%.
 *
 * GST is statutory — 0, 5, 12, 18, 28 — and retention is a rule written into a
 * contract. Neither is ever an average. And the number was pre-filled into the
 * editable field that computes the tax, so a sheet saved without a second look
 * would have been wrong.
 *
 * So: never blend. Work out what each bill actually carried, keep only rates
 * that reproduce their own figure to the rupee, and open on the most recent
 * one — that is what the next bill is most likely to carry. When the order's
 * bills disagree, say so, because then it is a decision and not a default.
 */
export interface RateBill {
  /** For ordering — the most recent bill wins. */
  on: string | null
  /** The deduction or the tax. */
  part: number
  /** The basic value it was worked out on. */
  whole: number
}

export interface RatePick {
  pct: number
  /** `latest` — what the most recent bill carried. `default` — the order gave
   *  nothing usable, so this is a stated fallback, not a fact. */
  basis: 'latest' | 'default'
  /** How many of the order's bills carried exactly this rate, out of how many. */
  seen: number
  total: number
  /** The other rates the order's bills carried. Non-empty means the person has
   *  to choose rather than accept. */
  others: number[]
}

/** A rate only if applying it back reproduces the figure to the rupee. A bill
 *  whose deduction does not divide cleanly carried an adjustment, not a rate,
 *  and must not set the default for the next one. */
function cleanRate(part: number, whole: number): number | null {
  if (!(whole > 0)) return null
  if (part === 0) return 0
  if (part < 0) return null
  const pct = Math.round((part / whole) * 10000) / 100
  return Math.abs(whole * (pct / 100) - part) < 1 ? pct : null
}

export function pickRate(bills: RateBill[], fallback: number): RatePick {
  const rated = bills
    .map(b => ({ on: b.on ?? '', pct: cleanRate(b.part, b.whole) }))
    .filter((b): b is { on: string; pct: number } => b.pct != null)
    .sort((a, b) => a.on.localeCompare(b.on))

  if (!rated.length) {
    return { pct: fallback, basis: 'default', seen: 0, total: bills.length, others: [] }
  }

  const pct = rated[rated.length - 1].pct
  const seen = rated.filter(r => r.pct === pct).length
  const others = [...new Set(rated.map(r => r.pct))].filter(p => p !== pct).sort((a, b) => a - b)

  return { pct, basis: 'latest', seen, total: rated.length, others }
}
