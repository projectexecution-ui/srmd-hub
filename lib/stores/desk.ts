// How a screen arranges what it was given.
//
// Everything here is pure, so the arranging can be tested without a browser:
// which line is the most urgent, what the setup is still missing, whether a
// delivery takes a purchase order past what was ordered, how a stock list is
// grouped and searched, how long something has been waiting.
//
// Separate from core.ts on purpose. core.ts holds the rules of the LEDGER —
// what stock is, what may be issued, who may see it. This holds the rules of
// the SCREEN. A wrong rule here makes a page read badly; a wrong rule there
// makes the store wrong.

import { fmtQty, type StockRow } from './core'

/* ── Days, counted in IST ───────────────────────────────────────────────── */

const DAY = 86_400_000

/** Today in IST as yyyy-mm-dd. The DB's `date` columns are already IST days,
 *  so comparing them to a UTC "today" slips by five and a half hours — which
 *  is how a thing needed today reads as overdue at half past six in the
 *  morning. */
export function istDay(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Whole days between an instant and now — 0 for anything today. */
export function daysSince(at: string | null | undefined, now: Date = new Date()): number {
  if (!at) return 0
  const then = new Date(at).getTime()
  if (!Number.isFinite(then)) return 0
  return Math.max(0, Math.floor((now.getTime() - then) / DAY))
}

/** How many days past a promised date, 0 when it is today or still ahead. */
export function daysOverdue(day: string | null | undefined, now: Date = new Date()): number {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0
  const due = Date.parse(`${day}T00:00:00+05:30`)
  const today = Date.parse(`${istDay(now)}T00:00:00+05:30`)
  if (!Number.isFinite(due)) return 0
  return Math.max(0, Math.round((today - due) / DAY))
}

/** "today" · "1 day" · "3 days" — said the way a person says it. */
export function waitedFor(days: number): string {
  if (days <= 0) return 'today'
  return days === 1 ? '1 day' : `${days} days`
}

/** "needed 15 Sep — yesterday" is what matters, not the number. */
export function overdueWord(days: number): string | null {
  if (days <= 0) return null
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/* ── What is most urgent ────────────────────────────────────────────────── */

export interface Waiting {
  kind: 'request' | 'gate'
  no: string
  href: string
  /** When it started waiting. */
  since: string
  /** The promised date, where there is one. */
  dueDay?: string | null
  /** What it is, in a few words: "Roff Extrofix, 60 Bags for NGH B". */
  what: string
  /** Whose desk it is on: "Mayank", "the storekeeper". */
  who: string
}

export interface Urgent extends Waiting {
  waitingDays: number
  overdueDays: number
  /** The whole sentence, so the banner and any future message say it the same
   *  way. The screen supplies no words of its own. */
  line: string
}

/**
 * The one thing most worth doing, out of everything waiting on anybody.
 *
 * Aksha's V1 rule, which he kept: the landing page answers "is anything on
 * me?" without a click. The tiles already count; this NAMES the worst one.
 *
 * Past a promised date beats merely waiting a long time — a request needed
 * yesterday is a site standing still, and one raised nine days ago for next
 * month is not. Within each, the longest wait wins, and the entry number
 * breaks a tie so the banner does not change its mind between refreshes.
 *
 * Returns null when nothing is waiting, which is a real answer and gets its
 * own quiet line rather than an empty space.
 */
export function mostUrgent(rows: readonly Waiting[], now: Date = new Date()): Urgent | null {
  const scored = rows.map(r => {
    const waitingDays = daysSince(r.since, now)
    const overdueDays = daysOverdue(r.dueDay ?? null, now)
    return { ...r, waitingDays, overdueDays, line: sentence(r, waitingDays, overdueDays) }
  })
  scored.sort((a, b) =>
    b.overdueDays - a.overdueDays ||
    b.waitingDays - a.waitingDays ||
    a.no.localeCompare(b.no))
  return scored[0] ?? null
}

function sentence(r: Waiting, waitingDays: number, overdueDays: number): string {
  const waited = waitingDays === 0
    ? `has been with ${r.who} since this morning`
    : `has been with ${r.who} for ${waitedFor(waitingDays)}`
  const late = overdueDays > 0 ? ` — it was needed ${overdueWord(overdueDays)}` : ''
  return `${waited} — ${r.what}${late}.`
}

/* ── What the setup is still missing ────────────────────────────────────── */

export interface HealthNote {
  key: string
  text: string
  href: string
  /** True when it silently breaks something, rather than merely being untidy. */
  serious: boolean
}

export interface HealthInput {
  itemsWithoutDiscipline: number
  duplicateNameGroups: number
  staffAssigned: number
  itemsWithoutRate: number
  locationsWithoutProject: number
}

/**
 * The gaps in the masters, in one line on the Overview.
 *
 * Aksha, 16 Sep 2026: the grey "what is not built yet" box goes, and this
 * replaces it. Config belongs behind Masters — but a gap that silently
 * misroutes an approval is not config, it is a fault, and it belongs where he
 * will actually see it.
 *
 * Only what is wrong is listed. An empty list means the setup is sound, and
 * the line disappears rather than saying "0 problems", which is noise.
 */
export function setupHealth(n: HealthInput): HealthNote[] {
  const out: HealthNote[] = []
  if (n.itemsWithoutDiscipline > 0) {
    out.push({
      key: 'discipline',
      text: `${n.itemsWithoutDiscipline} item${n.itemsWithoutDiscipline === 1 ? '' : 's'} without a discipline — request${n.itemsWithoutDiscipline === 1 ? '' : 's'} for ${n.itemsWithoutDiscipline === 1 ? 'it' : 'them'} reach neither Mayank nor Kanti`,
      href: '/stores/masters?list=items',
      serious: true,
    })
  }
  if (n.staffAssigned === 0) {
    out.push({
      key: 'staff',
      text: 'no engineer is on any project — an engineer can see no stock and raise nothing',
      href: '/stores/masters?list=staff',
      serious: true,
    })
  }
  if (n.duplicateNameGroups > 0) {
    out.push({
      key: 'duplicates',
      text: `${n.duplicateNameGroups} item${n.duplicateNameGroups === 1 ? '' : 's'} spelled two ways — ${n.duplicateNameGroups === 1 ? 'its' : 'their'} stock is split in two`,
      href: '/stores/masters?list=items',
      serious: true,
    })
  }
  if (n.itemsWithoutRate > 0) {
    out.push({
      key: 'rates',
      text: `${n.itemsWithoutRate} items without a rate — every ₹ total is understated`,
      href: '/stores/masters?list=items',
      serious: false,
    })
  }
  if (n.locationsWithoutProject > 0) {
    out.push({
      key: 'places',
      text: `${n.locationsWithoutProject} store${n.locationsWithoutProject === 1 ? '' : 's'} belongs to no project — only a storekeeper can see ${n.locationsWithoutProject === 1 ? 'it' : 'them'}`,
      href: '/stores/masters?list=location',
      serious: false,
    })
  }
  return out
}

/**
 * Items whose names differ only by spacing, case or punctuation.
 *
 * `mio_items` already refuses two rows with the same lower(name), so these are
 * the ones that slipped past it: "MCB 16A  1P" and "MCB 16A 1P", "40 x 32 mm"
 * and "40 x 32MM". Each pair is one real item holding stock in two rows, which
 * is why the stock screen can say we have none of something we have.
 *
 * Grouped, never merged automatically: merging moves stock, and that is a
 * decision with a person's name on it.
 */
export function duplicateNameGroups(
  items: ReadonlyArray<{ id: string; name: string }>,
): Array<{ key: string; items: Array<{ id: string; name: string }> }> {
  const by = new Map<string, Array<{ id: string; name: string }>>()
  for (const i of items) {
    const k = i.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!k) continue
    by.set(k, [...(by.get(k) ?? []), { id: i.id, name: i.name }])
  }
  return [...by.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, items: rows.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
}

/* ── Counting a delivery in against its order ───────────────────────────── */

export interface ReceiptCheck {
  /** What has already come in against this line, by the better-informed of the
   *  two records we hold. */
  received: number
  /** Where that figure came from, so the screen can say. */
  from: 'none' | 'in4' | 'gate' | 'agreed'
  /** What is still due — what the form fills in, when nobody has typed. */
  outstanding: number
  /** How far past the order this quantity would take it. 0 when within. */
  over: number
  /** received + what was typed. */
  total: number
}

/**
 * Two records of the same deliveries, and neither is the whole truth.
 *
 * IN4 knows what its Goods Receipt Notes say. This section knows what came
 * through the gate. They are two views of ONE set of deliveries, so they are
 * not added — that would count the same lorry twice the day IN4 catches up.
 * The higher of the two is taken: whichever source says more has arrived, at
 * least that much has arrived.
 *
 * This is also why the SECOND delivery against a purchase order used to
 * pre-fill the whole order again. IN4's GRN quantity had not moved, so the
 * form offered the full outstanding a second time — which is exactly how
 * In: 16Sep26/001 and /002 came to book 34,862 SqFt against a 33,142 SqFt
 * order on 16 Sep 2026. Counting our own gate entries closes that.
 */
export function checkReceipt(
  line: { ordered: number; alreadyIn: number; atGate: number },
  typed = 0,
): ReceiptCheck {
  const in4 = Math.max(0, line.alreadyIn || 0)
  const gate = Math.max(0, line.atGate || 0)
  const received = Math.max(in4, gate)
  const from: ReceiptCheck['from'] =
    received === 0 ? 'none'
      : in4 === gate ? 'agreed'
        : in4 > gate ? 'in4' : 'gate'
  const total = received + Math.max(0, typed || 0)
  return {
    received,
    from,
    outstanding: Math.max(0, (line.ordered || 0) - received),
    over: Math.max(0, total - (line.ordered || 0)),
    total,
  }
}

/**
 * What to say when a delivery takes an order past what was ordered.
 *
 * Says it, and lets it be saved anyway — extra deliveries happen, and a form
 * that refuses one teaches a storekeeper to record it somewhere else. What
 * must not happen is it going by in silence.
 *
 * TWO THINGS IT WILL NOT DO, both learned from Aksha's screenshot on
 * 16 Sep 2026, where a line sitting at a quantity of ZERO was being told it
 * had made 5,364 against 2,682 ordered:
 *
 *   · It says nothing while nothing is being added. A quantity of 0 adds
 *     nothing and cannot be saved anyway, so a warning on it is an alarm
 *     about somebody else's doing.
 *   · Where the line was ALREADY past the order before this delivery, it says
 *     so plainly instead of blaming this one. The storekeeper standing at the
 *     lorry did not cause it and cannot fix it by typing a smaller number —
 *     that is an earlier entry to void, and a different job.
 */
export function overReceiptNote(
  line: { ordered: number; alreadyIn: number; atGate: number },
  typed: number,
  unit = '',
): string | null {
  const adding = Math.max(0, typed || 0)
  if (adding <= 0) return null

  const c = checkReceipt(line, adding)
  if (c.over <= 0) return null

  const u = unit ? ` ${unit}` : ''
  const alreadyOver = checkReceipt(line, 0).over
  if (alreadyOver > 0) {
    return `${fmtQty(c.received)}${u} was already counted in against ${fmtQty(line.ordered)}${u} ordered — ${fmtQty(alreadyOver)}${u} over before this lorry. Adding ${fmtQty(adding)}${u} takes it to ${fmtQty(c.total)}${u}. Check the earlier entries.`
  }
  return `This makes ${fmtQty(c.total)}${u} against ${fmtQty(line.ordered)}${u} ordered — ${fmtQty(c.over)}${u} over. You can still save it; it will be marked.`
}

/**
 * The quiet line under an item, saying where the order stands.
 *
 * Here rather than in the component so the words are tested, and so the "how
 * much is already in" figure is worded the same as the warning above it.
 */
export function receiptLabel(
  line: { ordered: number; alreadyIn: number; atGate: number },
  unit = '',
): string {
  const c = checkReceipt(line, 0)
  const u = unit ? ` ${unit}` : ''
  const from = c.from === 'gate' ? ' (counted at the gate)' : c.from === 'in4' ? ' (IN4)' : ''
  const head = `Ordered ${fmtQty(line.ordered)}${u} · ${fmtQty(c.received)} already in${from}`
  return c.over > 0 ? `${head} · already ${fmtQty(c.over)} over` : head
}

/* ── How the stock list is arranged ─────────────────────────────────────── */

export interface StockLine {
  itemId: string
  name: string
  unit: string
  locationId: string | null
  /** "CT Warehouse (Yunus) → Stock" */
  where: string
  /** The two halves of `where`, so the store view can band by site. */
  site: string
  spot: string
  qty: number
  lastRate: number | null
  /** qty × rate, or null when there is no rate — never a silent zero. */
  value: number | null
  discipline: string | null
  lastMovedAt: string | null
}

/**
 * Find an item the way a person types it: a few letters of the name, or of
 * the place. Every word has to match SOMEWHERE in the row, so "pvc tee"
 * finds "110mm PVC TEE" and "yunus tee" finds the one in that warehouse.
 */
export function searchStock(rows: readonly StockLine[], q: string): StockLine[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter(r => {
    const hay = `${r.name} ${r.where} ${r.unit} ${r.discipline ?? ''}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

export interface StockGroup {
  label: string
  rows: StockLine[]
  /** Distinct items, not rows — one item on two shelves is one item. */
  items: number
  value: number
  /** True when some row has no rate, so `value` understates. */
  unpriced: boolean
}

/**
 * Grouped by discipline, because 670 rows in one list is a wall.
 *
 * Aksha, 16 Sep 2026: "A stock page you can read". Electrical alone is 425
 * items — collapsed it is one line, opened it is the list he wanted.
 *
 * Biggest group first: what the store mostly holds should be the first thing
 * named. "No discipline" sinks to the bottom whatever its size — it is a gap
 * to fix, not a category, and it must not head the page.
 */
export function groupStockByDiscipline(rows: readonly StockLine[]): StockGroup[] {
  const by = new Map<string, StockLine[]>()
  for (const r of rows) {
    const k = r.discipline ?? NO_DISCIPLINE
    by.set(k, [...(by.get(k) ?? []), r])
  }
  return [...by.entries()]
    .map(([label, rs]) => ({
      label,
      rows: [...rs].sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where)),
      items: new Set(rs.map(r => r.itemId)).size,
      value: rs.reduce((s, r) => s + (r.value ?? 0), 0),
      unpriced: rs.some(r => r.value == null),
    }))
    .sort((a, b) => {
      if (a.label === NO_DISCIPLINE) return 1
      if (b.label === NO_DISCIPLINE) return -1
      return b.items - a.items || a.label.localeCompare(b.label)
    })
}

export const NO_DISCIPLINE = 'No discipline'

export interface StoreGroup {
  site: string
  spot: string
  label: string
  rows: StockLine[]
  items: number
  value: number
  unpriced: boolean
}

/**
 * The same lines grouped by the PLACE instead of the item.
 *
 * The item view answers "where is the cement"; this answers "what is in the
 * NGH B store", which is the question asked by somebody standing in one — at a
 * stock count, or when deciding whether a request can be met from there. The
 * map asks for it too, under Total Stock Reports: "Storage Location Wise".
 *
 * Both views are built from ONE filtered list, so a search narrows them
 * identically and the two can never disagree about a quantity.
 */
export function groupStockByStore(rows: readonly StockLine[]): StoreGroup[] {
  const by = new Map<string, StockLine[]>()
  for (const r of rows) {
    if (r.qty <= 0 || !r.locationId) continue
    by.set(r.locationId, [...(by.get(r.locationId) ?? []), r])
  }
  return [...by.values()]
    .map(rs => ({
      site: rs[0].site,
      spot: rs[0].spot,
      label: rs[0].where,
      rows: [...rs].sort((a, b) => a.name.localeCompare(b.name)),
      items: new Set(rs.map(r => r.itemId)).size,
      value: rs.reduce((s, r) => s + (r.value ?? 0), 0),
      unpriced: rs.some(r => r.value == null),
    }))
    .sort((a, b) => a.site.localeCompare(b.site) || a.spot.localeCompare(b.spot))
}

/** What the whole list is worth, and whether that figure can be trusted. */
export function stockWorth(rows: readonly StockLine[]): { value: number; unpriced: number } {
  return {
    value: rows.reduce((s, r) => s + (r.value ?? 0), 0),
    unpriced: rows.filter(r => r.value == null).length,
  }
}

/* ── One item's history ─────────────────────────────────────────────────── */

export interface ItemMove {
  id: string
  kind: 'opening' | 'in' | 'out' | 'adjust'
  qty: number
  rate: number | null
  movedAt: string
  entryId: string | null
  entryNo: string | null
  party: string | null
  project: string | null
  place: string | null
  who: string | null
  note: string | null
}

/**
 * A bin card: every movement of one item, newest first, with the balance as it
 * stood after each one.
 *
 * The running balance is computed forwards from the oldest and then reversed,
 * so the top line is always today's figure and every line below it is what the
 * shelf held at that moment. Folded from the same ledger as the stock screen,
 * which is why the two can never disagree.
 */
export function itemHistory(moves: readonly ItemMove[]): Array<ItemMove & { balance: number }> {
  const oldestFirst = [...moves].sort((a, b) => a.movedAt.localeCompare(b.movedAt))
  let running = 0
  const withBalance = oldestFirst.map(m => {
    running += m.qty
    return { ...m, balance: running }
  })
  return withBalance.reverse()
}

/** What a movement is called on the card. */
export function moveWord(kind: ItemMove['kind'], qty: number): string {
  if (kind === 'opening') return 'Opening'
  if (kind === 'adjust') return qty >= 0 ? 'Corrected up' : 'Corrected down'
  return kind === 'in' ? 'In' : 'Out'
}

/* ── Turning folded stock into screen lines ─────────────────────────────── */

/**
 * The one place a StockRow becomes something a screen can print. Both the
 * item view and the store view build from this, so a quantity cannot be
 * rounded one way on one screen and another way on the other.
 */
export function stockLines(
  stock: readonly StockRow[],
  look: {
    name: (itemId: string) => string
    unit: (itemId: string) => string
    discipline: (itemId: string) => string | null
    where: (locationId: string | null) => string
    /** The site a spot sits in, for the store view's bands. */
    site?: (locationId: string | null) => string
  },
): StockLine[] {
  return stock.map(s => {
    const where = look.where(s.locationId)
    const site = look.site?.(s.locationId) ?? where
    return {
      itemId: s.itemId,
      name: look.name(s.itemId),
      unit: look.unit(s.itemId),
      locationId: s.locationId,
      where,
      site,
      // "CT Warehouse (Yunus) → Stock" minus its site is "Stock". Four places
      // are called that, which is why the spot is never shown on its own.
      spot: where.startsWith(`${site} → `) ? where.slice(site.length + 3) : where,
      qty: s.qty,
      lastRate: s.lastRate,
      value: s.lastRate == null ? null : s.lastRate * s.qty,
      discipline: look.discipline(s.itemId),
      lastMovedAt: s.lastMovedAt,
    }
  })
}

/* ── Which signatures an entry actually has ─────────────────────────────── */

export interface SignedSlot {
  key: 'security' | 'incharge' | 'receiver'
  /** Who they are. */
  label: string
  /** What signing it MEANS — the thing the box was missing. */
  what: string
  who: string | null
  at: string | null
  /** What to say while it is unsigned. */
  waitingFor: string
}

export interface SignatureInput {
  security: { who: string | null; at: string | null }
  incharge: { who: string | null; at: string | null }
  receiver: { who: string | null; at: string | null }
  /** Who finished the entry — the storekeeper, on an issue. */
  completedBy: string | null
  completedAt: string | null
}

/**
 * Which signatures an entry can actually have, and what each one means.
 *
 * Aksha, 16 Sep 2026, looking at a finished IN: "what does the reciever means
 * ??? - i dont know this cycle is closed - why its showing am i missing
 * something". He was not missing anything. The box could never be signed.
 *
 * All three were shown on every entry regardless of direction, and the
 * receipt step only ever runs on an OUT — so every completed IN carried a
 * hollow "Receiver · Not signed" saying a finished entry was unfinished. Its
 * hint was stale on top of that: it read "No receipt step yet", written before
 * the receipt step existed and never changed when it was built.
 *
 * What is true:
 *
 *   IN   two people. Security recorded the vehicle; the storekeeper counted
 *        the material in. The map's "Sign of Receiver" on the in-side IS the
 *        storekeeper — the SRMD person receiving from the vendor — so showing
 *        a third box shows one person twice.
 *
 *   OUT  two people. The storekeeper issued it out of the store, and somebody
 *        at the far end signs for it. Security's check before a load leaves is
 *        the map's third, and it is NOT BUILT — it is the branch Aksha parked
 *        on 16 Sep — so no box is drawn for it. A box for an unbuilt step is
 *        the same lie in the other direction.
 */
export function signaturesFor(
  direction: 'in' | 'out',
  s: SignatureInput,
): SignedSlot[] {
  if (direction === 'in') {
    return [
      {
        key: 'security',
        label: 'Security',
        what: 'recorded the vehicle at the gate',
        who: s.security.who, at: s.security.at,
        waitingFor: 'Not recorded',
      },
      {
        key: 'incharge',
        label: 'Storekeeper',
        what: 'counted the material in and took it into stock',
        who: s.incharge.who, at: s.incharge.at,
        waitingFor: 'Not counted in yet',
      },
    ]
  }

  // An issue stamps no signature column, only completed_by — and a return
  // stamps the security one. Either way it is the person who handed it out.
  const issuedWho = s.incharge.who ?? s.security.who ?? s.completedBy
  const issuedAt = s.incharge.at ?? s.security.at ?? s.completedAt

  return [
    {
      key: 'incharge',
      label: 'Storekeeper',
      what: 'issued the material out of the store',
      who: issuedWho, at: issuedAt,
      waitingFor: 'Not issued yet',
    },
    {
      key: 'receiver',
      label: 'Received on site',
      what: 'checked what arrived and signed for it',
      who: s.receiver.who, at: s.receiver.at,
      waitingFor: 'Waiting — whoever takes delivery signs below',
    },
  ]
}

/* ── What can be corrected on a saved entry ─────────────────────────────── */

/** Where a correction gets its choices from. 'text' is typed. */
export type CorrectKind =
  | 'text' | 'entity' | 'delivery_mode' | 'item_category' | 'project' | 'location'

export interface CorrectableField {
  field: string
  label: string
  kind: CorrectKind
  /**
   * True when the ledger has to follow the correction.
   *
   * `mio_movements` carries its own project_id and location_id, copied from
   * the entry when the stock was created. Changing one on the entry alone
   * would leave the entry saying one thing and the stock screen another — so
   * these move the movement rows too, in the same breath.
   */
  movesLedger?: boolean
  hint?: string
}

/**
 * The fields a saved entry can be corrected on, by direction.
 *
 * Aksha, 16 Sep 2026: "more specific and more fields u can think which can be
 * added - pls do". It was eight free-text fields, all of them about the
 * driver; the things most likely to be wrong — which project, which trust,
 * which shelf — could not be touched at all, which is how a delivery ends up
 * filed against NGH instead of NGH B for ever.
 *
 * And he asked, of "Handed over": "will come here in the SRM iN section ???"
 * It will, and the map puts it there — SRM In Step 1 lists both "Handed Over
 * Party Name" and "Handed over to Name". But it means the OPPOSITE way round
 * on the way in: on an IN the vendor's man hands over and OUR person receives;
 * on an OUT we hand over and the site receives. One label for both directions
 * reads backwards on one of them, so each direction gets its own words.
 *
 * What is still deliberately NOT here: quantity, rate, and the item itself.
 * Changing those changes what the stock ledger says, and a ledger with two
 * explanations for one number is the thing this whole section exists to
 * avoid. Void the entry and record it again.
 */
export function correctableFields(direction: 'in' | 'out'): CorrectableField[] {
  const common: CorrectableField[] = [
    { field: 'po_wo_no', label: 'Purchase order number', kind: 'text' },
    { field: 'remarks', label: 'Remarks', kind: 'text' },
  ]

  if (direction === 'in') {
    return [
      { field: 'party_name', label: 'Who brought it', kind: 'text' },
      { field: 'vehicle_no', label: 'Vehicle number', kind: 'text' },
      { field: 'driver_name', label: 'Driver name', kind: 'text' },
      { field: 'driver_mobile', label: 'Driver mobile', kind: 'text' },
      { field: 'driver_licence', label: 'Driver licence', kind: 'text' },
      ...common,
      { field: 'entity_id', label: 'Which trust is paying', kind: 'entity' },
      {
        field: 'project_id', label: 'Which project', kind: 'project', movesLedger: true,
        hint: 'The stock moves with it — this is the one to use when a delivery was filed against the parent instead of the wing.',
      },
      {
        field: 'location_id', label: 'Where it was put', kind: 'location', movesLedger: true,
        hint: 'The stock moves to that shelf too, so the stock screen follows.',
      },
      { field: 'delivery_mode_id', label: 'How it came', kind: 'delivery_mode' },
      { field: 'item_category_id', label: 'Item category', kind: 'item_category' },
      { field: 'handed_over_party', label: 'Handed over by — shop or transporter', kind: 'text' },
      { field: 'handed_over_to', label: 'Received by — our person', kind: 'text' },
      { field: 'security_by', label: 'Security’s name', kind: 'text' },
      { field: 'incharge_name', label: 'Storekeeper’s name', kind: 'text' },
    ]
  }

  return [
    { field: 'party_name', label: 'Who it went to', kind: 'text' },
    { field: 'vehicle_no', label: 'Vehicle number', kind: 'text' },
    { field: 'driver_name', label: 'Driver name', kind: 'text' },
    ...common,
    {
      field: 'project_id', label: 'Which project it went to', kind: 'project', movesLedger: true,
      hint: 'The stock moves with it.',
    },
    {
      field: 'location_id', label: 'Out of which store', kind: 'location', movesLedger: true,
      hint: 'Changes which store the material came off. Check the other store does not go negative.',
    },
    { field: 'to_location_id', label: 'Where it was put down at site', kind: 'location' },
    { field: 'delivery_mode_id', label: 'How it went', kind: 'delivery_mode' },
    { field: 'handed_over_party', label: 'Handed over to — company', kind: 'text' },
    { field: 'handed_over_to', label: 'Handed over to — person', kind: 'text' },
    { field: 'security_by', label: 'Issued by', kind: 'text' },
  ]
}

/** Every field either direction allows, for the server to check against. */
export function isCorrectable(direction: 'in' | 'out', field: string): CorrectableField | null {
  return correctableFields(direction).find(f => f.field === field) ?? null
}
