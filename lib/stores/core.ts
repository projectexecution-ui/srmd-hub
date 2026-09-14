// Material In & Out — the pure core.
//
// No Supabase, no React, so every rule here is unit-testable and the screens
// and the server actions cannot each grow their own version of it.
//
// The one idea worth holding on to: STOCK IS FOLDED FROM MOVEMENTS, never
// stored. `mio_movements` holds signed quantities and nothing else keeps a
// running total, so the stock screen and the ledger are the same number by
// construction rather than by agreement.

/** Aksha, 13 Sep 2026: "make the Section in only NGH B Project as of now".
 *  One project, so the shape can be felt and picked apart before it is
 *  everywhere. Removing the pilot later = deleting this constant and the two
 *  places that read it. */
export const PILOT_PROJECT_IDS: readonly string[] = [
  '551a8314-84f7-426a-a0d5-20590830c62e', // NGH B
]

export const isPilotProject = (projectId: string): boolean =>
  PILOT_PROJECT_IDS.includes(projectId)

/**
 * Returnables — the whole branch — switched OFF.
 *
 * Aksha, 14 Sep 2026: "keep the Returnable thing off for now - as that feature
 * is not required now."
 *
 * OFF, not deleted. Flip this one constant and the tab, the tile, the two
 * tick-boxes, the column and the project pill all come back exactly as they
 * were — because every one of them reads this and nothing else.
 *
 * Nothing already recorded is touched: the `returnable` flags on existing
 * lines and the returns booked against them stay in the database untouched, so
 * turning it back on shows the real position rather than a blank list. The
 * page itself stays reachable and SAYS it is off, rather than 404-ing on a
 * bookmark — a screen that vanishes without explanation reads as a fault.
 */
export const RETURNABLES_ON = false

export type Direction = 'in' | 'out'
export type Register = 'vendor' | 'srm' | 'transfer'
export type Stage = 'gate' | 'complete' | 'closed' | 'void'
export type MovementKind = 'opening' | 'in' | 'out' | 'adjust'

/* ── Numbering ──────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * The mind map's own format: "In: 15Aug26/001".
 *
 * Takes the date as a yyyy-mm-dd string — the DB column is a `date`, already
 * resolved to IST by its default, so re-deriving it from a Date here would
 * reintroduce exactly the timezone slip the hub keeps having.
 */
export function entryNo(direction: Direction, isoDate: string, seq: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const label = `${String(d).padStart(2, '0')}${MONTHS[(m || 1) - 1]}${String(y).slice(-2)}`
  return `${direction === 'in' ? 'In' : 'Out'}: ${label}/${String(seq).padStart(3, '0')}`
}

/** "Out: 13Sep26/002 (In: 11Sep26/007)" — an out that answers an in, the way
 *  the map writes it, so the pair reads as a pair on paper too. */
export function linkedNo(outNo: string, inNo: string): string {
  return `${outNo} (${inNo})`
}

/* ── Stock ──────────────────────────────────────────────────────────────── */

export interface Movement {
  itemId: string
  locationId: string | null
  /** Signed: + into stock, − out of it. */
  qty: number
  kind: MovementKind
  movedAt: string
  rate?: number | null
}

export interface StockRow {
  itemId: string
  locationId: string | null
  qty: number
  /** Last rate seen on an inbound movement — what it cost, not an average. */
  lastRate: number | null
}

const key = (itemId: string, locationId: string | null) => `${itemId}::${locationId ?? ''}`

/**
 * Fold the ledger into a balance per item per location.
 *
 * `asOn` (yyyy-mm-dd, inclusive) gives the map's "stock as on date" — the same
 * fold, stopped earlier, so a historic figure can never be computed a
 * different way from today's.
 */
export function foldStock(movements: readonly Movement[], asOn?: string): StockRow[] {
  const cut = asOn ? new Date(`${asOn}T23:59:59.999+05:30`).getTime() : Infinity
  const by = new Map<string, StockRow>()
  // Rate must follow movement order, not array order, or "last rate" depends
  // on how the rows happened to come back from Postgres.
  const ordered = [...movements].sort((a, b) => a.movedAt.localeCompare(b.movedAt))
  for (const m of ordered) {
    if (new Date(m.movedAt).getTime() > cut) continue
    const k = key(m.itemId, m.locationId)
    const row = by.get(k) ?? { itemId: m.itemId, locationId: m.locationId, qty: 0, lastRate: null }
    row.qty += m.qty
    if (m.qty > 0 && m.rate != null) row.lastRate = m.rate
    by.set(k, row)
  }
  // A line that went in and fully out leaves a zero row. Keep it — "we hold
  // none of this" is an answer, and dropping it makes an item vanish from the
  // stock screen the moment it runs out, which is when people look for it.
  return [...by.values()].sort((a, b) => a.itemId.localeCompare(b.itemId))
}

/** What can be taken from one place right now. */
export function availableAt(stock: readonly StockRow[], itemId: string, locationId: string | null): number {
  return stock.find(r => r.itemId === itemId && r.locationId === locationId)?.qty ?? 0
}

/** Everything held of an item, wherever it is. */
export function availableAnywhere(stock: readonly StockRow[], itemId: string): number {
  return stock.filter(r => r.itemId === itemId).reduce((s, r) => s + r.qty, 0)
}

/**
 * How many different things we hold — for the "Items held" tile.
 *
 * Counts ITEMS, not item-and-place rows. The tile first shipped counting rows,
 * so one item kept in two stores counted twice and the figure read 728 against
 * an item master of 659 — a number that cannot be true and quietly says the
 * screen is not to be trusted. An item is held once however many shelves it
 * sits on.
 */
export function heldItemCount(stock: readonly StockRow[]): number {
  const held = new Set<string>()
  for (const r of stock) if (r.qty > 0) held.add(r.itemId)
  return held.size
}

export interface IssueCheck { ok: boolean; reason?: string; available: number }

/**
 * The map's hardest rule, in one place: *"Item can be picked up ONLY from
 * stock Items."*
 *
 * Returns a REASON rather than just false — a blocked action that does not say
 * why is the thing Aksha has asked me not to ship.
 */
export function checkIssue(
  stock: readonly StockRow[], itemId: string, locationId: string | null, qty: number,
): IssueCheck {
  const available = availableAt(stock, itemId, locationId)
  if (!(qty > 0)) return { ok: false, reason: 'Quantity must be more than zero.', available }
  if (available <= 0) {
    const elsewhere = availableAnywhere(stock, itemId)
    return {
      ok: false, available,
      reason: elsewhere > 0
        ? `None here. ${fmtQty(elsewhere)} is held in another location — pick that one.`
        : 'None in stock anywhere. It has to come in through the gate first.',
    }
  }
  if (qty > available) {
    return { ok: false, available, reason: `Only ${fmtQty(available)} in stock here. Reduce the quantity or pick another location.` }
  }
  return { ok: true, available }
}

/** Trailing zeros on a quantity read as false precision — 120 not 120.000. */
export function fmtQty(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toLocaleString('en-IN', { maximumFractionDigits: 3 })
}

/* ── Returnables ────────────────────────────────────────────────────────── */

export interface ReturnableLine {
  /** The LINE, not the entry — two returnable items on one entry are two
   *  separate debts and a partial return of one must not net against the other. */
  lineId: string
  entryId: string
  entryNo: string
  itemId: string
  itemName: string
  unit: string
  qty: number
  /** Who is holding it — the project it went to, or the site it sits on. */
  heldBy: string
  /** Who it is owed back to — the lending project, or the vendor. */
  owedTo: string
  since: string
  /** Quantities already returned against this line. */
  returned: number
}

/** One return being recorded: how much of which outstanding line came back. */
export interface ReturnInput { lineId: string; qty: number }

export interface ReturnCheck { ok: boolean; reason?: string; outstanding: number }

/**
 * May this much be returned against this line?
 *
 * Refuses more than is outstanding. Giving back more than went out is not a
 * generous mistake — it silently invents stock, and the returnables list then
 * reads as settled when it is not.
 */
export function checkReturn(
  rows: readonly ReturnableRow[], lineId: string, qty: number,
): ReturnCheck {
  const row = rows.find(r => r.lineId === lineId)
  if (!row) return { ok: false, reason: 'That line is not outstanding.', outstanding: 0 }
  if (!(qty > 0)) return { ok: false, reason: 'Quantity must be more than zero.', outstanding: row.outstanding }
  if (qty > row.outstanding) {
    return {
      ok: false, outstanding: row.outstanding,
      reason: `Only ${fmtQty(row.outstanding)} ${row.unit} is still out. Returning more would invent stock.`,
    }
  }
  return { ok: true, outstanding: row.outstanding }
}

export interface ReturnableRow extends ReturnableLine { outstanding: number; days: number }

/** Whether a returnable debt counts as overdue enough to chase. 30 days is the
 *  line the screen already colours at; naming it keeps report and screen level. */
export const CHASE_AFTER_DAYS = 30

/**
 * What still owes its way back — the map's only report under Returnable
 * Items: *"Which Project has to return what materials to which project."*
 *
 * Vendor returnables and project-to-project loans come out of the same list on
 * purpose, so the two can never be two lists that disagree.
 */
export function outstandingReturnables(lines: readonly ReturnableLine[], today = new Date()): ReturnableRow[] {
  return lines
    .map(l => ({
      ...l,
      outstanding: Math.max(0, l.qty - l.returned),
      days: Math.max(0, Math.floor((today.getTime() - new Date(l.since).getTime()) / 86_400_000)),
    }))
    .filter(r => r.outstanding > 0)
    // Oldest first: the 56-day machine matters more than this morning's props.
    // Oldest first: the 56-day machine matters more than this morning's props.
    // Tie broken by name then line id, so the list does not reshuffle between
    // loads when two debts are the same age.
    .sort((a, b) => b.days - a.days || a.itemName.localeCompare(b.itemName) || a.lineId.localeCompare(b.lineId))
}

/* ── What a gate entry still needs ──────────────────────────────────────── */

export interface EntryDraft {
  register: Register
  partyName?: string | null
  vehicleNo?: string | null
  driverName?: string | null
  deliveryModeId?: string | null
  projectId?: string | null
  entityId?: string | null
  locationId?: string | null
  lineCount?: number
}

/**
 * What is missing before an entry can move on, in the order a person would
 * notice it. Shown inline on the form — never used to disable the button,
 * because a dead button with no explanation is the same silent blocker.
 */
export function missingForGate(d: EntryDraft): string[] {
  const out: string[] = []
  if (!d.partyName?.trim()) out.push('Who is delivering')
  // Hand-delivered material has no vehicle, and demanding one would make the
  // guard invent a number — which is worse than not having it.
  const handDelivered = d.deliveryModeId === 'hand'
  if (!handDelivered && !d.vehicleNo?.trim()) out.push('Vehicle number')
  if (!d.driverName?.trim() && !handDelivered) out.push('Driver name')
  return out
}

/**
 * What the storekeeper still owes before an IN can become stock.
 *
 * A vendor IN is the deliberate exception: the map gives vendor Step 1 no item
 * fields at all, because material delivered to a site is not stock. Asking for
 * lines there would create a balance nobody ever consumes.
 */
export function missingForComplete(d: EntryDraft): string[] {
  const out: string[] = []
  if (!d.entityId) out.push('Which trust is paying')
  if (!d.projectId) out.push('Which project')
  if (d.register !== 'vendor') {
    if (!d.locationId) out.push('Where it was put')
    if (!d.lineCount) out.push('At least one item line')
  }
  return out
}

/** Vendor material goes to site, so it never becomes stock — only its
 *  returnable lines are counted. One predicate, used by the action that
 *  writes movements and by the screen that explains why. */
export const createsStock = (register: Register): boolean => register !== 'vendor'
