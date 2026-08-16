/** "What moved today" — the V1 daily movement report, rebuilt on the V2 ledger.
 *
 *  V1 read `inv_stock_movements`; this reads `wh_movements`, which carries more
 *  kinds (a vendor taking his own material back, a void reversing an entry) and
 *  so needs a bucketing rule rather than a straight in/out split.
 *
 *  Pure. The loader hands it rows, the screen and the digest both fold them the
 *  same way, so the page and any future email can never disagree.
 */

import type { MovementKind } from './ledger'

export type DayMovement = {
  id: string
  kind: MovementKind
  /** Signed as recorded. `adjust` and `void` carry their own sign. */
  qty: number
  itemId: string
  itemName: string
  itemCode: string | null
  unit: string
  category: string | null
  storeId: string
  storeName: string
  siteName: string
  /** Who posted it. */
  actor: string | null
  /** IST time of day, HH:mm. */
  time: string
  remarks: string | null
  /** The entry it belongs to, for the context line under the item name. */
  entryNo: string | null
  /** Where it went / came from, in words — a project, a vendor, another store. */
  counterparty: string | null
  projectName: string | null
}

export type Bucket = 'entry' | 'exit' | 'transfer' | 'correction'

/** Which side of the gate each ledger kind sits on.
 *
 *  A transfer is deliberately its own bucket rather than one exit and one
 *  entry: the campus total does not change when material crosses the yard, and
 *  a report that counts it twice makes a quiet day look busy. */
export function bucketOf(kind: MovementKind): Bucket {
  switch (kind) {
    case 'in':
    case 'return':
      return 'entry'
    case 'issue':
    case 'vendor_out':
      return 'exit'
    case 'move_in':
    case 'move_out':
      return 'transfer'
    case 'adjust':
    case 'void':
    case 'damage':
      return 'correction'
  }
}

/** What to call the movement on screen, in the reader's words rather than the
 *  enum's. "vendor_out" means nothing to a storekeeper. */
export const KIND_LABEL: Record<MovementKind, string> = {
  in: 'Received',
  return: 'Return to store',
  issue: 'Issued to site',
  vendor_out: 'Back to vendor',
  move_in: 'Moved in',
  move_out: 'Moved out',
  adjust: 'Count correction',
  void: 'Entry voided',
  damage: 'Damaged',
}

export type DayTotals = {
  entries: number
  exits: number
  transfers: number
  corrections: number
  /** Distinct items that moved at all — the "how much of the master did today
   *  touch" number, which is a better sense of scale than a row count. */
  itemsTouched: number
}

export function dayTotals(rows: DayMovement[]): DayTotals {
  const items = new Set<string>()
  let entries = 0, exits = 0, transfers = 0, corrections = 0
  for (const r of rows) {
    items.add(r.itemId)
    switch (bucketOf(r.kind)) {
      case 'entry': entries++; break
      case 'exit': exits++; break
      // Both halves of a move are in the ledger; count the pair once.
      case 'transfer': if (r.kind === 'move_out') transfers++; break
      case 'correction': corrections++; break
    }
  }
  return { entries, exits, transfers, corrections, itemsTouched: items.size }
}

/** "Where material went today" — one line per store → destination pair.
 *
 *  This is the first thing the HOD looks at, and it is the one view that
 *  answers it without reading a single row of the tables underneath. */
export type FlowRow = {
  from: string
  to: string
  lines: number
  items: number
}

export function flows(rows: DayMovement[]): FlowRow[] {
  const map = new Map<string, { from: string; to: string; lines: number; items: Set<string> }>()
  for (const r of rows) {
    // Only material actually leaving a store has a destination worth naming.
    // A receipt's "where it went" is the store itself, which tells nobody
    // anything they did not already know from the Entries table.
    if (bucketOf(r.kind) !== 'exit' && r.kind !== 'move_out') continue
    const to = r.counterparty || r.projectName || '—'
    const key = `${r.storeName}→${to}`
    let f = map.get(key)
    if (!f) { f = { from: r.storeName, to, lines: 0, items: new Set() }; map.set(key, f) }
    f.lines++
    f.items.add(r.itemId)
  }
  return [...map.values()]
    .map(f => ({ from: f.from, to: f.to, lines: f.lines, items: f.items.size }))
    .sort((a, b) => b.lines - a.lines || a.to.localeCompare(b.to))
}

/** The one-line summary above the flow list: "2 sites · from 1 store". */
export function flowSummary(rows: FlowRow[]): string {
  if (rows.length === 0) return 'nothing left a store'
  const dests = new Set(rows.map(r => r.to)).size
  const stores = new Set(rows.map(r => r.from)).size
  return `${dests} ${dests === 1 ? 'destination' : 'destinations'} · from ${stores} ${stores === 1 ? 'store' : 'stores'}`
}

export type Section = {
  bucket: Bucket
  title: string
  rows: DayMovement[]
}

/** The tables under the flow card, in the order the day reads: what left,
 *  what arrived, what moved across, what was corrected. Empty ones are
 *  dropped rather than shown as a heading with nothing under it. */
export function sections(rows: DayMovement[]): Section[] {
  const TITLES: Array<[Bucket, string]> = [
    ['exit', 'Exits — out of store'],
    ['entry', 'Entries — into store'],
    ['transfer', 'Transfers — store to store'],
    ['correction', 'Corrections'],
  ]
  return TITLES
    .map(([bucket, title]) => ({
      bucket,
      title,
      rows: rows.filter(r => bucketOf(r.kind) === bucket)
        .sort((a, b) => b.time.localeCompare(a.time) || a.itemName.localeCompare(b.itemName)),
    }))
    .filter(s => s.rows.length > 0)
}
