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
 * Who can open Material In & Out.
 *
 * Aksha, 15 Sep 2026: "create the security and storekeeper accounts - but i am
 * not making it LIVE as of now". So the accounts exist and the roles below are
 * written down and ready, and exactly one thing decides whether anyone but him
 * can see the section.
 *
 * The roles are what the mind map's process needs, and no more:
 *   security       records the vehicle at the gate
 *   store_manager  counts the material in, puts it away, issues it out
 *   engineer       raises a request for their site
 *   head, founder  approve, and read the registers
 *
 * GOING LIVE IS TWO ACTS, deliberately. Flip STORES_LIVE, and apply
 * supabase/migrations/20260915_material_in_out_go_live.sql — which is written
 * and NOT applied. Either one alone is harmless: the app can hide a section
 * the database would serve, and the database can serve a section the app does
 * not show. Both are needed before anybody sees anything, and the migration
 * says so at the top.
 */
export const STORES_LIVE = false

const LIVE_ROLES: readonly string[] = [
  'admin', 'founder', 'head', 'store_manager', 'security', 'engineer',
]

export function canSeeStores(role: string | null | undefined): boolean {
  if (!role) return false
  return STORES_LIVE ? LIVE_ROLES.includes(role) : role === 'admin'
}

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

/* ── Project picker grouping ────────────────────────────────────────────── */

// Moved to lib/projects.ts once Bills Booking and Cost Control needed the same
// order. Re-exported so the Stores imports keep working and there stays ONE
// implementation — two would drift, and a picker that groups differently on
// two screens is worse than one that does not group at all.
export { groupProjects, UNGROUPED, type ProjectOpt } from '@/lib/projects'

/* ── Reading an IN4 order number ────────────────────────────────────────── */

/**
 * Which trust is paying, read off the order number.
 *
 * IN4 numbers read PO/SRASSK/AB/2026-27/94 — kind, trust, project, year,
 * serial — and for 1,448 of the 1,451 orders the trust is the second segment.
 * Three are PO/DO/SRET/RU/…, where the second segment is "DO" and the trust is
 * third.
 *
 * So this does not trust the POSITION. It looks for a segment that is one of
 * the trusts we actually hold, and returns nothing when no segment is. That
 * way a number in a shape nobody has seen yet leaves the field empty for the
 * storekeeper rather than filling it with "DO".
 */
export function entityCodeFromOrderNo(no: string, knownCodes: readonly string[]): string | null {
  const known = new Map(knownCodes.map(c => [c.toUpperCase().replace(/\s+/g, ''), c]))
  for (const part of no.replace(/^DRAFT-/i, '').split('/')) {
    const hit = known.get(part.toUpperCase().replace(/\s+/g, ''))
    if (hit) return hit
  }
  return null
}

/* ── What the form can work out for itself ──────────────────────────────── */

/**
 * Which item category an entry is, without asking.
 *
 * The mind map's three categories are not a free taxonomy — they say where the
 * material stands:
 *
 *   Vendor Materials   the vendor register, material going straight to site
 *   Ordered Items      there is a purchase order behind it
 *   Returnable Items   it has to come back (switched off since 14 Sep)
 *
 * All three are decided by facts the screen already has, so asking the
 * storekeeper to pick one is asking them to restate what they just did.
 * Returns null only when nothing has been established yet — no order, and a
 * register that could still go either way.
 */
export function categoryFor(
  register: Register,
  hasOrder: boolean,
  categories: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const find = (word: string) =>
    categories.find(c => c.name.toLowerCase().includes(word))?.id ?? null
  if (register === 'vendor') return find('vendor')
  if (hasOrder) return find('order')
  return null
}

/* ── What belongs in a MATERIAL register ────────────────────────────────── */

/**
 * Scopes that are fees, not things — nothing is ever delivered against one.
 *
 * IN4 and CT Hub both split a project by scope: "Raj Uphaar - Execution" is
 * building work, "Raj Uphaar - Professional Consultancy" is the architect's
 * fee. Aksha, 15 Sep 2026: "i dont want Professional Consultanty in any of
 * the section".
 *
 * This keeps those lines out of the Material In & Out project picker — all
 * seven of them have taken zero deliveries since the section existed. Scoped
 * to this section on purpose: the money modules must keep showing
 * consultancy, because that is where the fee actually lives.
 */
export function isServiceScope(name: string | null | undefined): boolean {
  if (!name) return false
  return /(professional\s+consultancy|consultancy|design)\b/i.test(name)
}

/**
 * Which store to issue out of, when nobody has said.
 *
 * The screen already knows where the stock is — it prints "None here. 140 is
 * held in another location — pick that one" under every line. Making the
 * storekeeper then go and find that location by hand is asking them to act on
 * information the screen is holding.
 *
 * Prefers a place that can satisfy the WHOLE request, because splitting an
 * issue across two stores means two entries. Failing that, the place that
 * covers the most lines, then the most quantity. Returns null when no place
 * holds any of it — there is nothing to suggest, and the empty picker with
 * its reasons underneath is the honest answer.
 */
export function bestIssueLocation(
  stock: readonly StockRow[],
  want: ReadonlyArray<{ itemId: string; qty: number }>,
): string | null {
  const lines = want.filter(w => w.itemId && w.qty > 0)
  if (lines.length === 0) return null

  const places = [...new Set(stock.filter(s => s.qty > 0 && s.locationId).map(s => s.locationId as string))]
  let best: { id: string; full: number; covered: number; total: number } | null = null

  for (const id of places) {
    let full = 0, covered = 0, total = 0
    for (const w of lines) {
      const have = availableAt(stock, w.itemId, id)
      if (have > 0) covered++
      if (have >= w.qty) full++
      total += Math.min(have, w.qty)
    }
    if (covered === 0) continue
    const better =
      !best ||
      full > best.full ||
      (full === best.full && covered > best.covered) ||
      (full === best.full && covered === best.covered && total > best.total)
    if (better) best = { id, full, covered, total }
  }
  return best?.id ?? null
}

/* ── Whose stock is whose ───────────────────────────────────────────────── */

/**
 * Aksha, 15 Sep 2026: "per Eng sees thier own project stock only - but the
 * storekeeper can see all stock of all projects of all storage location".
 *
 * So there are two kinds of reader, and it is not a permission level — it is a
 * job. A storekeeper HOLDS the material for eleven sites; hiding ten of them
 * would stop them doing the work. An engineer is asking for their own site and
 * has no business browsing another project's shelves.
 */
export type StockScope =
  | { kind: 'all' }
  | { kind: 'projects'; projectIds: readonly string[] }

/** Roles that hold material rather than ask for it. */
const KEEPERS = ['admin', 'founder', 'head', 'store_manager', 'security']

export function stockScopeFor(
  role: string | null | undefined,
  assignedProjectIds: readonly string[],
): StockScope {
  if (role && KEEPERS.includes(role)) return { kind: 'all' }
  return { kind: 'projects', projectIds: [...new Set(assignedProjectIds)] }
}

/**
 * Which storage places a scope may look at.
 *
 * Locations hang off a SITE (the parent row), and it is the site that carries
 * the project — so a spot is visible when its site belongs to a project the
 * reader is on. A site with no project at all is a shared warehouse: visible
 * to the keepers, and to nobody who is scoped to their own sites, because it
 * is not theirs.
 */
export function visibleLocationIds(
  scope: StockScope,
  locations: ReadonlyArray<{ id: string; parentId: string | null; projectId: string | null }>,
): string[] {
  if (scope.kind === 'all') return locations.map(l => l.id)
  if (scope.projectIds.length === 0) return []

  const mine = new Set(scope.projectIds)
  const byId = new Map(locations.map(l => [l.id, l]))
  const projectOf = (l: { parentId: string | null; projectId: string | null }): string | null =>
    l.projectId ?? (l.parentId ? byId.get(l.parentId)?.projectId ?? null : null)

  return locations.filter(l => {
    const p = projectOf(l)
    return p != null && mine.has(p)
  }).map(l => l.id)
}

/**
 * Why a scoped reader is seeing nothing — never a blank screen with no reason.
 * Returns null when there is nothing to explain.
 */
export function emptyScopeReason(scope: StockScope, visibleCount: number): string | null {
  if (scope.kind === 'all' || visibleCount > 0) return null
  return scope.projectIds.length === 0
    ? 'You are not on any project yet, so there is no stock to show. Ask Aksha to add you under Masters → Who works where.'
    : 'None of your projects has a store of its own yet. Material for your site is held in a shared warehouse, which the storekeeper issues from.'
}
