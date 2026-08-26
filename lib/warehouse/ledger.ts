/** The ledger, and what it adds up to.
 *
 *  `wh_stock.qty` is only ever "now". Every question worth asking is about a
 *  date — what was in hand on 31 March, what came in last month, what a store
 *  held before the count corrected it — and the only honest answer comes from
 *  folding the movements up to that date. So this file owns ONE definition of
 *  what each movement kind does to stock, and both the stock screen and the
 *  registers read it. Two definitions would eventually disagree, and then the
 *  register stops being evidence.
 */

export type MovementKind =
  | 'in' | 'damage' | 'issue' | 'move_out' | 'move_in' | 'return' | 'adjust' | 'vendor_out' | 'void'

export type LedgerRow = {
  itemId: string
  locationId: string
  kind: MovementKind
  /** Signed for `adjust` (a count can correct either way); positive otherwise. */
  qty: number
  /** IST date, yyyy-mm-dd. */
  day: string
  rate: number | null
  /** True for the one-off V1 carry-over. It is posted as an `adjust`
   *  because that is the only kind that can create stock out of nothing,
   *  but it is not a count correction and must not be reported as one. */
  opening?: boolean
}

/** What each kind does to GOOD stock.
 *
 *  `damage` is deliberately 0: broken material is tracked in its own bucket and
 *  must never be counted as good stock, which is the whole reason it is
 *  recorded separately at the gate. (#10) */
export function stockEffect(kind: MovementKind, qty: number): number {
  switch (kind) {
    case 'in':
    case 'move_in':
    case 'return':
      return qty
    case 'issue':
    case 'move_out':
    case 'vendor_out':
      return -qty
    // A count correction already carries its own sign, and so does the
    // reversal of a voided entry.
    case 'adjust':
    case 'void':
      return qty
    case 'damage':
      return 0
  }
}

/** The columns the HOD's register shows per item per store. They are kept
 *  apart rather than netted: "in 500, out 180, transferred +100" tells a story
 *  that a single figure of 420 does not. */
export type StockCell = {
  itemId: string
  locationId: string
  inQty: number
  outQty: number
  /** Net of move_in − move_out. Signed: negative means this store gave it away. */
  transferQty: number
  /** Stock that was already on the shelf when the module opened — the V1
   *  carry-over. Kept out of `adjustQty` so the count-correction column
   *  does not read as though somebody counted 78,000 units into existence. */
  openingQty: number
  /** Net of count corrections. Signed. */
  adjustQty: number
  /** Net of voided entries reversed back out. Signed, and kept apart from
   *  `adjustQty` so a keeper's typo never reads as a count finding material
   *  missing — the two mean entirely different things to whoever reads it. */
  voidQty: number
  damagedQty: number
  /** in − out + transfer + adjust. */
  inHand: number
  /** Vendor material that went back out, kept out of `outQty` so site
   *  consumption is never overstated. */
  vendorOutQty: number
}

function emptyCell(itemId: string, locationId: string): StockCell {
  return {
    itemId, locationId,
    inQty: 0, outQty: 0, transferQty: 0, openingQty: 0, adjustQty: 0, voidQty: 0,
    damagedQty: 0, vendorOutQty: 0, inHand: 0,
  }
}

/** How many distinct items are actually on a shelf, per key.
 *
 *  Feeds the counts in the filter dropdowns. Each dropdown counts under the
 *  OTHER filters but not its own — pick Electrical and the store list says how
 *  much Electrical each store holds, which is the only reading that helps you
 *  choose. So the caller narrows `cells` however it likes and picks the key.
 *
 *  Only `inHand > 0` counts. A row that folds to zero is a closed history, not
 *  stock, and counting it would send somebody to an empty shelf. */
export function countItemsBy(
  cells: StockCell[],
  key: (c: StockCell) => string | null,
): Record<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const c of cells) {
    if (c.inHand <= 0) continue
    const k = key(c)
    if (k == null) continue
    if (!seen.has(k)) seen.set(k, new Set())
    seen.get(k)!.add(c.itemId)
  }
  return Object.fromEntries([...seen].map(([k, set]) => [k, set.size]))
}

/** Fold the ledger into one cell per item per store, counting only movements up
 *  to and including `asOn`. */
export function foldLedger(rows: LedgerRow[], asOn?: string): StockCell[] {
  const cells = new Map<string, StockCell>()
  for (const r of rows) {
    if (asOn && r.day > asOn) continue
    const key = `${r.itemId}|${r.locationId}`
    let c = cells.get(key)
    if (!c) { c = emptyCell(r.itemId, r.locationId); cells.set(key, c) }

    switch (r.kind) {
      case 'in':
      case 'return':
        c.inQty += r.qty; break
      case 'issue':
        c.outQty += r.qty; break
      case 'vendor_out':
        c.vendorOutQty += r.qty; break
      case 'move_in':
        c.transferQty += r.qty; break
      case 'move_out':
        c.transferQty -= r.qty; break
      case 'adjust':
        if (r.opening) c.openingQty += r.qty
        else c.adjustQty += r.qty
        break
      case 'void':
        c.voidQty += r.qty; break
      case 'damage':
        c.damagedQty += r.qty; break
    }
    c.inHand += stockEffect(r.kind, r.qty)
  }
  return [...cells.values()]
}

/** Is this line worth a warning? `nil` beats `low` — an empty shelf is not a
 *  "running low" problem, it is a stopped-work problem. */
export function stockFlag(inHand: number, minQty: number | null): 'nil' | 'low' | null {
  if (inHand <= 0) return 'nil'
  if (minQty != null && minQty > 0 && inHand <= minQty) return 'low'
  return null
}

export type StockLine = StockCell & {
  itemName: string
  unit: string
  category: string | null
  discipline: string | null
  locationName: string
  siteName: string
  minQty: number | null
  rate: number | null
  /** inHand × rate. Indicative only — it is the last rate seen, not a valuation. */
  value: number
  flag: 'nil' | 'low' | null
}

export type StockGroup = {
  locationId: string
  locationName: string
  siteName: string
  lines: StockLine[]
  value: number
}

/** Group the lines the way the register is read: store by store, item by item,
 *  with a value subtotal per store. */
export function groupByLocation(lines: StockLine[]): StockGroup[] {
  const groups = new Map<string, StockGroup>()
  for (const l of lines) {
    let g = groups.get(l.locationId)
    if (!g) {
      g = { locationId: l.locationId, locationName: l.locationName, siteName: l.siteName, lines: [], value: 0 }
      groups.set(l.locationId, g)
    }
    g.lines.push(l)
    g.value += l.value
  }
  const out = [...groups.values()]
  for (const g of out) g.lines.sort((a, b) => a.itemName.localeCompare(b.itemName))
  return out.sort((a, b) =>
    a.siteName.localeCompare(b.siteName) || a.locationName.localeCompare(b.locationName))
}

/** What an item is grouped under when stock is read by category.
 *
 *  Category first, trade second. The two came from different places — the 514
 *  items carried over from the old module have a category, and the 2,289 that
 *  arrived from IN4 have a trade instead — so neither alone covers the master.
 *  Together they cover all of it, which is why this falls back rather than
 *  showing a large "uncategorised" pile that helps nobody. */
export function groupOf(line: { category: string | null }): string {
  return line.category?.trim() || 'Not categorised'
}

export type StockCategoryGroup = {
  category: string
  lines: StockLine[]
  value: number
  /** How many different stores this category is spread across. */
  locations: number
}

/** Group the way the old module showed it: by what the material IS, not where
 *  it happens to be sitting. "How much electrical do we hold" is a question
 *  about the category; the store is the answer's detail, not its heading. */
export function groupByCategory(lines: StockLine[]): StockCategoryGroup[] {
  const groups = new Map<string, StockCategoryGroup & { locs: Set<string> }>()
  for (const l of lines) {
    const key = groupOf(l)
    let g = groups.get(key)
    if (!g) {
      g = { category: key, lines: [], value: 0, locations: 0, locs: new Set() }
      groups.set(key, g)
    }
    g.lines.push(l)
    g.value += l.value
    g.locs.add(l.locationId)
  }
  const out = [...groups.values()].map(g => {
    g.locations = g.locs.size
    g.lines.sort((a, b) => a.itemName.localeCompare(b.itemName))
    return g as StockCategoryGroup
  })
  // Biggest category first — that is the one somebody came to look at.
  return out.sort((a, b) => b.lines.length - a.lines.length || a.category.localeCompare(b.category))
}

export type StockTotals = {
  items: number
  locations: number
  value: number
  low: number
  nil: number
  /** Shortage found by approved counts, as a positive number. */
  countShortQty: number
  countShortValue: number
  /** True when some line has no rate, so `value` understates. */
  valuePartial: boolean
}

export function stockTotals(lines: StockLine[]): StockTotals {
  const t: StockTotals = {
    items: 0, locations: 0, value: 0, low: 0, nil: 0,
    countShortQty: 0, countShortValue: 0, valuePartial: false,
  }
  const locs = new Set<string>()
  const items = new Set<string>()
  for (const l of lines) {
    locs.add(l.locationId)
    // An item in three stores is one item, counted once.
    if (l.inHand > 0) items.add(l.itemId)
    t.value += l.value
    if (l.flag === 'low') t.low++
    if (l.flag === 'nil') t.nil++
    if (l.inHand > 0 && l.rate == null) t.valuePartial = true
    if (l.adjustQty < 0) {
      t.countShortQty += -l.adjustQty
      if (l.rate) t.countShortValue += -l.adjustQty * l.rate
    }
  }
  t.items = items.size
  t.locations = locs.size
  return t
}

/** Today in IST, as yyyy-mm-dd — the register's day boundary is the site's day,
 *  not UTC's. A truck at 11pm belongs to today. */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
