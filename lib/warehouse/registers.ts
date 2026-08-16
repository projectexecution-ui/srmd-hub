/** The five registers from the HOD's mindmap.
 *
 *  Four of them are the same shape — a period, some rows, a grouping, a total —
 *  which is the point: they are the SAME gate entries read four ways, not four
 *  separate systems.
 *
 *    Vendor IN   what each vendor brought          wh_gate_in  owner = vendor
 *    Vendor OUT  what went back, matched to its IN wh_gate_out dest = vendor
 *    SRM IN      purchases received                wh_gate_in  owner = srm
 *    SRM OUT     issued to sites                   wh_gate_out dest = site
 *    Total Stock what lies where, as on a date     the stock screen (ledger.ts)
 *
 *  The fifth is the stock screen, because "what lies where as on a date" is a
 *  balance, not a list of entries — and it already exists rather than being
 *  rebuilt here.
 */

export type RegisterKind = 'vendor-in' | 'vendor-out' | 'srm-in' | 'srm-out'

/** One line of a register: one item on one gate entry. */
export type RegisterRow = {
  entryId: string
  entryNo: string
  day: string
  /** Vendor / supplier for an IN, the party it went back to for a vendor OUT. */
  party: string | null
  projectName: string | null
  entity: string | null
  storeName: string
  itemId: string
  itemName: string
  unit: string
  discipline: string | null
  /** What the material IS. Category where the item has one, trade otherwise —
   *  the two masters carry different fields and only together cover everything. */
  category: string | null
  qty: number
  rate: number | null
  /** qty × rate, or null when no rate is known — never silently zero. */
  amount: number | null
  /** IN only: what the challan said vs what was actually taken in. */
  shortQty?: number
  damagedQty?: number
  /** IN only, and only when it came against a PO. */
  poNo?: string | null
  /** IN only: what arrived is not the material IN4 ordered. Recorded at the gate
   *  by whoever looked at the truck; this is what procurement and billing act
   *  on, so it travels with the register rather than living only on the entry. */
  differsFromPo?: boolean
  differNote?: string | null
  /** What IN4 ordered, in IN4's own words, when it differs. */
  orderedText?: string | null
  /** Vendor OUT only: kept for the "matched to its IN" note. */
  engineerName?: string | null
  remarks?: string | null
}

export type RegisterTotals = {
  entries: number
  lines: number
  qtyByUnit: Record<string, number>
  amount: number
  /** True when some line has no rate, so `amount` understates. */
  amountPartial: boolean
  shortQty: number
  damagedQty: number
}

export function registerTotals(rows: RegisterRow[]): RegisterTotals {
  const t: RegisterTotals = {
    entries: 0, lines: rows.length, qtyByUnit: {}, amount: 0,
    amountPartial: false, shortQty: 0, damagedQty: 0,
  }
  const entries = new Set<string>()
  for (const r of rows) {
    entries.add(r.entryId)
    // Quantities are only ever summed WITHIN a unit — adding bags to tonnes is
    // the classic register lie.
    t.qtyByUnit[r.unit] = (t.qtyByUnit[r.unit] ?? 0) + r.qty
    if (r.amount == null) t.amountPartial = true
    else t.amount += r.amount
    t.shortQty += r.shortQty ?? 0
    t.damagedQty += r.damagedQty ?? 0
  }
  t.entries = entries.size
  return t
}

export type RegisterGroup = {
  key: string
  label: string
  rows: RegisterRow[]
  totals: RegisterTotals
}

export type GroupBy = 'party' | 'project' | 'category' | 'entity' | 'store' | 'item' | 'none'

/** What to call this material's family, on screen and in every export. Same
 *  fallback the stock screen uses, so one item never reads as two things. */
export function categoryOf(r: { category: string | null; discipline: string | null }): string {
  return r.category?.trim() || r.discipline?.trim() || 'Not categorised'
}

const GROUP_VALUE: Record<Exclude<GroupBy, 'none'>, (r: RegisterRow) => string> = {
  party:      r => r.party ?? '— not named —',
  project:    r => r.projectName ?? '— no project —',
  // One "Category" rather than a category option AND a trade option: the items
  // carried over from the old module have a category and the ones IN4 named
  // have a trade, so either alone would leave most of the register in a
  // "— none —" bucket. Falls back the same way the stock screen does.
  category:   categoryOf,
  entity:     r => r.entity ?? '— no entity —',
  store:      r => r.storeName,
  item:       r => r.itemName,
}

export function groupRows(rows: RegisterRow[], by: GroupBy): RegisterGroup[] {
  if (by === 'none') {
    return [{ key: 'all', label: 'All entries', rows: sortRows(rows), totals: registerTotals(rows) }]
  }
  const pick = GROUP_VALUE[by]
  const groups = new Map<string, RegisterRow[]>()
  for (const r of rows) {
    const k = pick(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  return [...groups.entries()]
    .map(([label, rs]) => ({ key: label, label, rows: sortRows(rs), totals: registerTotals(rs) }))
    // Biggest value first: a register is read to find where the money went.
    .sort((a, b) => b.totals.amount - a.totals.amount || a.label.localeCompare(b.label))
}

/** Newest entry first, then by item, so a day's entries read together. */
function sortRows(rows: RegisterRow[]): RegisterRow[] {
  return [...rows].sort((a, b) =>
    b.day.localeCompare(a.day)
    || b.entryNo.localeCompare(a.entryNo)
    || a.itemName.localeCompare(b.itemName))
}

/** Inclusive on both ends — "1 to 31 August" must include both days. */
export function inPeriod(day: string, from: string | null, to: string | null): boolean {
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

/** Vendor material balance: brought in, taken back, still with us.
 *
 *  This is the number that matters about a vendor's own material, and it is why
 *  Vendor OUT has to be recordable at all — without it, "still at site" is
 *  whatever he says it is. Matched on party name and item, since his plates are
 *  his plates whichever entry they arrived on. */
export type VendorBalanceRow = {
  party: string
  itemId: string
  itemName: string
  unit: string
  broughtIn: number
  takenBack: number
  stillHere: number
  /** He has taken back more than he ever brought — a data error or a claim
   *  worth checking, either way not something to leave silent. */
  overTaken: boolean
}

export function vendorBalance(
  ins: Array<{ party: string | null; itemId: string; itemName: string; unit: string; qty: number }>,
  outs: Array<{ party: string | null; itemId: string; itemName: string; unit: string; qty: number }>,
): VendorBalanceRow[] {
  const rows = new Map<string, VendorBalanceRow>()
  const touch = (party: string | null, itemId: string, itemName: string, unit: string) => {
    const p = (party ?? '').trim()
    const key = `${p.toLowerCase()}|${itemId}`
    let r = rows.get(key)
    if (!r) {
      r = { party: p || '— not named —', itemId, itemName, unit, broughtIn: 0, takenBack: 0, stillHere: 0, overTaken: false }
      rows.set(key, r)
    }
    return r
  }
  for (const i of ins) touch(i.party, i.itemId, i.itemName, i.unit).broughtIn += i.qty
  for (const o of outs) touch(o.party, o.itemId, o.itemName, o.unit).takenBack += o.qty
  for (const r of rows.values()) {
    r.stillHere = r.broughtIn - r.takenBack
    r.overTaken = r.takenBack > r.broughtIn
  }
  return [...rows.values()].sort((a, b) =>
    a.party.localeCompare(b.party) || a.itemName.localeCompare(b.itemName))
}

export const REGISTER_META: Record<RegisterKind, {
  title: string
  blurb: string
  /** What the mindmap asked this register to answer. */
  question: string
  groupOptions: GroupBy[]
  defaultGroup: GroupBy
}> = {
  'vendor-in': {
    title: 'Vendor IN',
    blurb: 'What each vendor brought — his own material, never our stock',
    question: 'Whose material is standing on our site, and since when?',
    groupOptions: ['party', 'category', 'project', 'item', 'store', 'none'],
    defaultGroup: 'party',
  },
  'vendor-out': {
    title: 'Vendor OUT',
    blurb: 'What went back, matched by name to what he brought in',
    question: 'Has he taken back more than he ever brought?',
    groupOptions: ['party', 'category', 'item', 'project', 'store', 'none'],
    defaultGroup: 'party',
  },
  'srm-in': {
    title: 'SRM IN',
    blurb: 'Purchases received — quantity, rate, amount, by category',
    question: 'What did we buy and take in this period, and what did it cost?',
    groupOptions: ['category', 'party', 'entity', 'project', 'store', 'item', 'none'],
    defaultGroup: 'category',
  },
  'srm-out': {
    title: 'SRM OUT',
    blurb: 'Issued to sites for use — by project',
    question: 'Which project consumed what?',
    groupOptions: ['project', 'category', 'entity', 'item', 'store', 'none'],
    defaultGroup: 'project',
  },
}

export const GROUP_LABEL: Record<GroupBy, string> = {
  party: 'Vendor / supplier',
  project: 'Project',
  category: 'Category / trade',
  entity: 'Paid by',
  store: 'Store',
  item: 'Item',
  none: 'Nothing — one flat list',
}
