/** Physical count — the arithmetic, kept out of the screens.
 *
 *  Book stock is in-minus-out: a number the system believes. The count is what
 *  is actually on the shelf. The difference between the two is the only honest
 *  measure of what the register is missing, so it is never quietly absorbed —
 *  it is named, reasoned, witnessed and approved before it touches stock. (#2)
 */

export type CountScope = 'spot_top' | 'location' | 'full'
export type CountStatus = 'counting' | 'submitted' | 'approved' | 'rejected'

/** One line of the walking sheet. `bookQty` is frozen when the count starts —
 *  if a truck arrives mid-count, comparing against a moved-on book number would
 *  invent a difference that never existed. */
export type CountLine = {
  id: string
  itemId: string
  itemName: string
  unit: string
  seq: number
  bookQty: number
  countedQty: number | null
  skipped: boolean
  skipReason: string | null
  reason: string | null
  remark: string | null
  /** Last known rate, for the value of a difference. Not a valuation. */
  rate: number | null
}

/** What a stock row looks like coming out of the count sheet builder. */
export type SheetSource = {
  itemId: string
  itemName: string
  unit: string
  qty: number
  rate: number | null
}

/** How many items a spot check walks. Small enough to finish in a tea break —
 *  a check nobody finishes is a check nobody runs. */
export const SPOT_TOP_N = 20

/** Which items a count of this store walks, in the order he should walk them.
 *
 *  - `spot_top`  the {@link SPOT_TOP_N} biggest items by value — the weekly check
 *  - `location`  everything the book says is in this store
 *  - `full`      the above PLUS items the book says are nil, because "the book
 *                says zero and there are eight bags lying there" is exactly the
 *                missed IN entry a count exists to catch
 */
export function buildSheet(rows: SheetSource[], scope: CountScope): SheetSource[] {
  const held = rows.filter(r => r.qty > 0)
  if (scope === 'full') return [...rows].sort(byName)
  if (scope === 'location') return held.sort(byName)
  const value = (r: SheetSource) => r.qty * (r.rate ?? 0)
  // Ranked by value, then by quantity so a store with no rates yet still gets a
  // sensible top-20 instead of an arbitrary one.
  return [...held]
    .sort((a, b) => value(b) - value(a) || b.qty - a.qty)
    .slice(0, SPOT_TOP_N)
    .sort(byName)
}

function byName(a: SheetSource, b: SheetSource): number {
  return a.itemName.localeCompare(b.itemName)
}

/** A line has a difference worth explaining. A skipped line is not a difference
 *  — it is an admission that it was not counted, which the skip reason covers. */
export function hasDiff(line: CountLine): boolean {
  return !line.skipped && line.countedQty !== null && line.countedQty !== line.bookQty
}

export function diffOf(line: CountLine): number {
  if (line.skipped || line.countedQty === null) return 0
  return line.countedQty - line.bookQty
}

/** Reached = he has either counted it or consciously skipped it. */
export function isReached(line: CountLine): boolean {
  return line.skipped || line.countedQty !== null
}

/** Every difference must say why. Without this the count degrades into "the
 *  system was wrong again" and the reason column — the only part management can
 *  act on — comes back empty. */
export function needsReason(line: CountLine): boolean {
  return hasDiff(line) && !line.reason?.trim()
}

export type CountSummary = {
  total: number
  counted: number
  skipped: number
  notReached: number
  tallied: number
  shortLines: number
  excessLines: number
  shortQty: number
  excessQty: number
  /** Value of the shortage at last known rates — an indication, not a
   *  valuation, and it is only as good as the rates behind it. */
  shortValue: number
  excessValue: number
  /** True when some short line has no rate, so the ₹ figure understates. */
  valuePartial: boolean
  missingReasons: number
}

export function summarize(lines: CountLine[]): CountSummary {
  const s: CountSummary = {
    total: lines.length,
    counted: 0, skipped: 0, notReached: 0, tallied: 0,
    shortLines: 0, excessLines: 0, shortQty: 0, excessQty: 0,
    shortValue: 0, excessValue: 0, valuePartial: false, missingReasons: 0,
  }
  for (const l of lines) {
    if (l.skipped) { s.skipped++; continue }
    if (l.countedQty === null) { s.notReached++; continue }
    s.counted++
    const d = diffOf(l)
    if (d === 0) { s.tallied++; continue }
    if (needsReason(l)) s.missingReasons++
    if (d < 0) {
      s.shortLines++
      s.shortQty += -d
      if (l.rate) s.shortValue += -d * l.rate
      else s.valuePartial = true
    } else {
      s.excessLines++
      s.excessQty += d
      if (l.rate) s.excessValue += d * l.rate
      else s.valuePartial = true
    }
  }
  return s
}

/** Can this count be submitted? Kept as one sentence a storekeeper can act on,
 *  never as a disabled button with no explanation. */
export function submitBlocker(lines: CountLine[], witnessId: string | null): string | null {
  if (lines.length === 0) return 'Nothing on this sheet to count.'
  const s = summarize(lines)
  if (s.notReached > 0) {
    return `${s.notReached} ${s.notReached === 1 ? 'item is' : 'items are'} still not counted. `
      + 'Count it, or skip it with a reason.'
  }
  if (s.missingReasons > 0) {
    return `${s.missingReasons} ${s.missingReasons === 1 ? 'difference has' : 'differences have'} no reason. `
      + 'Say why it does not tally — that is the part management acts on.'
  }
  if (!witnessId) return 'A count needs a witness. Pick who was with you.'
  return null
}

/** The stock corrections an approval would post. Only real differences move
 *  stock; a tallied line and a skipped line both change nothing. */
export function adjustments(lines: CountLine[]): Array<{ itemId: string; diff: number; countedQty: number; reason: string | null }> {
  return lines.filter(hasDiff).map(l => ({
    itemId: l.itemId,
    diff: diffOf(l),
    countedQty: l.countedQty!,
    reason: l.reason,
  }))
}

export const SCOPE_LABEL: Record<CountScope, { title: string; blurb: string }> = {
  spot_top: {
    title: 'Spot check',
    blurb: `The ${SPOT_TOP_N} biggest items in this store by value — a weekly walk that actually gets finished`,
  },
  location: {
    title: 'This store',
    blurb: 'Everything the book says is in this store',
  },
  full: {
    title: 'Full count',
    blurb: 'Everything, including items the book says are nil — this is what catches a missed IN entry',
  },
}
