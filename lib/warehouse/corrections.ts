/** The four corrections a warehouse eventually needs, and the rules that stop
 *  each of them from being used to quietly rewrite history.
 *
 *  Everything here is pure. The server actions do the reading and writing; what
 *  is worth testing is the arithmetic and the refusals, and those live here.
 */

import { stockEffect } from './ledger'
import type { MovementKind } from './ledger'

// ===========================================================================
// 1 · Voiding a gate entry
// ===========================================================================

/** A movement as it was posted, and as it must now be undone. */
export type PostedMovement = {
  itemId: string
  locationId: string
  kind: MovementKind
  qty: number
  rate: number | null
}

export type ReversalMovement = {
  itemId: string
  locationId: string
  kind: 'void' | 'damage'
  /** Signed. Negative undoes something that added, positive undoes a removal. */
  qty: number
  rate: number | null
}

/** Undo a movement by posting its arithmetic inverse.
 *
 *  The ledger is append-only — deleting the original rows would leave the
 *  stock right and the audit trail lying. So a void adds rows rather than
 *  removing them, and the two entries sit next to each other in the history.
 *
 *  `damage` is the one special case. Its effect on good stock is zero, so
 *  inverting `stockEffect` would post nothing at all and the damaged bucket
 *  would keep a quantity that never arrived. It reverses as negative damage
 *  instead. */
export function reverse(m: PostedMovement): ReversalMovement {
  if (m.kind === 'damage') {
    return { itemId: m.itemId, locationId: m.locationId, kind: 'damage', qty: -m.qty, rate: m.rate }
  }
  return {
    itemId: m.itemId,
    locationId: m.locationId,
    kind: 'void',
    qty: -stockEffect(m.kind, m.qty),
    rate: m.rate,
  }
}

export function reversalOf(movements: PostedMovement[]): ReversalMovement[] {
  return movements.map(reverse).filter(r => r.qty !== 0)
}

/** What the reversal does to good stock, per item per store. Used to check
 *  BEFORE writing anything that no store is left holding a negative. */
export function stockDelta(reversals: ReversalMovement[]): Map<string, number> {
  const delta = new Map<string, number>()
  for (const r of reversals) {
    // Damaged material never counted as good stock, so undoing it moves the
    // damaged bucket and leaves the good figure alone.
    if (r.kind === 'damage') continue
    const k = `${r.itemId}|${r.locationId}`
    delta.set(k, (delta.get(k) ?? 0) + r.qty)
  }
  return delta
}

/** Damaged-bucket movement per item per store, same shape. */
export function damagedDelta(reversals: ReversalMovement[]): Map<string, number> {
  const delta = new Map<string, number>()
  for (const r of reversals) {
    if (r.kind !== 'damage') continue
    const k = `${r.itemId}|${r.locationId}`
    delta.set(k, (delta.get(k) ?? 0) + r.qty)
  }
  return delta
}

export const VOID_REASON_MIN = 10

export type VoidTarget = {
  entryNo: string
  alreadyVoided: boolean
}

/** What is on hand right now, keyed `itemId|locationId`, with the names needed
 *  to say WHICH item is the problem rather than "some item". */
export type OnHand = Map<string, { qty: number; itemName: string; unit: string; storeName: string }>

/** Why this void is refused, in a sentence, or null to go ahead.
 *
 *  The hard one is the third: material that came in on a wrong entry may
 *  already have been issued to site. Undoing the receipt would leave the store
 *  holding minus 40 bags — a number that is not wrong so much as meaningless,
 *  and which then poisons every report that reads it. The honest answer is to
 *  say so and let somebody decide, not to write it and hope. */
export function voidBlocker(
  target: VoidTarget,
  reason: string,
  reversals: ReversalMovement[],
  onHand: OnHand,
): string | null {
  if (target.alreadyVoided) {
    return `${target.entryNo} is already voided. Nothing further to undo.`
  }
  if (reason.trim().length < VOID_REASON_MIN) {
    return 'Say why in a few words. The reason is what the entry is judged by later — '
      + '"wrong store" and "truck never came" are very different things.'
  }
  for (const [key, delta] of stockDelta(reversals)) {
    if (delta >= 0) continue
    const have = onHand.get(key)
    const available = have?.qty ?? 0
    if (available + delta < 0) {
      const name = have?.itemName ?? 'that item'
      const unit = have?.unit ?? ''
      const store = have?.storeName ?? 'the store'
      return `Undoing this would leave ${store} holding less than nothing of ${name}: `
        + `${available} ${unit} on hand, and the void takes ${Math.abs(delta)} ${unit} away. `
        + 'The material has already moved on. Correct it with a physical count instead, '
        + 'or void the later entry first.'
    }
  }
  return null
}

// ===========================================================================
// 2 · Stores and sites
// ===========================================================================

export const NAME_MIN = 2

/** Codes are the stable handle a store is known by, and one is already unique
 *  in the database — so make one that reads like the name rather than asking a
 *  keeper to invent it. `Yunus Land Store` → `YUNUS-LAND-STORE`. */
export function codeFrom(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

/** Make it unique against what is already there, including retired ones — the
 *  unique index does not care that a store is closed. */
export function uniqueCode(name: string, taken: Iterable<string>): string {
  const base = codeFrom(name) || 'STORE'
  const used = new Set([...taken].map(c => c.toUpperCase()))
  if (!used.has(base)) return base
  for (let n = 2; n < 100; n++) {
    const c = `${base.slice(0, 21)}-${n}`
    if (!used.has(c)) return c
  }
  return `${base.slice(0, 18)}-${Date.now() % 100000}`
}

export function namingBlocker(name: string, siblings: string[], selfName?: string): string | null {
  const n = name.trim()
  if (n.length < NAME_MIN) return 'Give it a name of at least two characters.'
  const clash = siblings.some(s =>
    s.trim().toLowerCase() === n.toLowerCase()
    && s.trim().toLowerCase() !== (selfName ?? '').trim().toLowerCase())
  if (clash) return `There is already a ${n} here. Two stores with one name is how material ends up in the wrong column.`
  return null
}

export type RetireStoreFacts = {
  storeName: string
  /** Lines of stock still showing a quantity, good or damaged. */
  stockLines: number
  stockQty: number
  /** Gate entries, counts and moves that point at this store. */
  entries: number
  /** For a site: how many live stores hang under it. */
  childStores: number
}

/** Retiring hides a store from every picker. It must not hide material.
 *
 *  Two separate refusals on purpose: stock is a "move it first" problem, while
 *  child stores is a "you are retiring the wrong thing" problem, and one
 *  message covering both would explain neither. History is NOT a refusal —
 *  a store that served for three years and is now closed is precisely the
 *  thing retiring is for. */
export function retireBlocker(f: RetireStoreFacts): string | null {
  if (f.childStores > 0) {
    return `${f.storeName} still has ${f.childStores} ${f.childStores === 1 ? 'store' : 'stores'} under it. `
      + 'Retire or move those first — retiring the site would leave them with nowhere to sit.'
  }
  if (f.stockLines > 0) {
    return `${f.storeName} still holds ${f.stockQty} across ${f.stockLines} `
      + `${f.stockLines === 1 ? 'item' : 'items'}. Issue it or move it to another store first — `
      + 'retiring the store would hide the material, not empty it.'
  }
  return null
}

/** Reasons a retired store cannot simply be deleted outright. Retiring is the
 *  answer; this explains why the button does not offer more. */
export function deleteStoreBlocker(f: RetireStoreFacts): string | null {
  if (f.entries > 0) {
    return `${f.storeName} appears on ${f.entries} past ${f.entries === 1 ? 'entry' : 'entries'}. `
      + 'It can be retired so nobody can post to it again, but not deleted — '
      + 'those entries would lose the store they happened in.'
  }
  return retireBlocker(f)
}

// ===========================================================================
// 3 · Returning returnable material
// ===========================================================================

export type ReturnableOutLine = {
  lineId: string
  itemId: string
  itemName: string
  unit: string
  qty: number
  returnedQty: number
}

export function outstandingOf(l: ReturnableOutLine): number {
  return Math.max(0, l.qty - l.returnedQty)
}

/** Recording a return is the only way the Returnables Outstanding report can
 *  ever close a line, so the rules stay light: a partial return is normal
 *  (half the shuttering comes back this week), and more than went out is not. */
export function returnBlocker(
  line: ReturnableOutLine,
  qty: number,
  isReturnable: boolean,
): string | null {
  if (!isReturnable) {
    return 'This issue was not marked returnable, so there is nothing to return against it. '
      + 'Take it in at the gate as a fresh receipt instead.'
  }
  if (!(qty > 0)) return 'Enter how much came back.'
  const left = outstandingOf(line)
  if (left === 0) {
    return `All ${line.qty} ${line.unit} of ${line.itemName} is already back. Nothing outstanding on this line.`
  }
  if (qty > left) {
    return `Only ${left} ${line.unit} of ${line.itemName} is still out. `
      + `You are recording ${qty}. If more came back than went out, take the extra in at the gate — `
      + 'it is a receipt, not a return.'
  }
  return null
}

// ===========================================================================
// 4 · The item master
// ===========================================================================

export type ItemFacts = {
  itemId: string
  name: string
  unit: string
  /** Ledger rows against this item, anywhere. */
  movements: number
  /** Stock lines still holding a quantity. */
  stockLines: number
  stockQty: number
  /** Open PO lines that name this item. */
  openPoLines: number
}

/** A unit is locked to its item for a reason: every quantity ever recorded is
 *  in that unit, and changing it would silently reinterpret all of them —
 *  400 Bags becoming 400 Kg without a single number moving.
 *
 *  So it can be changed exactly while nothing has been recorded yet, which is
 *  the case that actually matters: an item created at the gate five minutes
 *  ago with the default unit. */
export function unitChangeBlocker(f: ItemFacts, newUnit: string): string | null {
  if (!newUnit.trim()) return 'Pick a unit.'
  if (newUnit.trim() === f.unit) return null
  if (f.movements > 0) {
    return `${f.name} already has ${f.movements} ${f.movements === 1 ? 'movement' : 'movements'} recorded in ${f.unit}. `
      + `Changing the unit to ${newUnit} would reinterpret every one of them without moving a number. `
      + `Create a separate item in ${newUnit} and merge this one into it instead.`
  }
  return null
}

export function retireItemBlocker(f: ItemFacts): string | null {
  if (f.stockLines > 0) {
    return `${f.name} still shows ${f.stockQty} ${f.unit} in stock. `
      + 'Issue it, or count the store to zero first — retiring would hide the quantity, not remove it.'
  }
  if (f.openPoLines > 0) {
    return `${f.name} is on ${f.openPoLines} open PO ${f.openPoLines === 1 ? 'line' : 'lines'}. `
      + 'The gate would have no item to receive it against. Short-close the PO, or leave the item active.'
  }
  return null
}

export type MergePair = { from: ItemFacts; into: ItemFacts }

/** Merge folds one item's whole history into another and retires the loser.
 *
 *  The units must agree, and that is not a formality: the two rows exist
 *  because somebody typed the same material twice, and if one of them says Kg
 *  and the other says Bag then they are not the same material — or one of them
 *  is wrong, and that has to be settled before the histories are joined and
 *  the question becomes unanswerable. */
export function mergeBlocker(p: MergePair): string | null {
  if (p.from.itemId === p.into.itemId) {
    return 'An item cannot be merged into itself. Pick the item you want to keep.'
  }
  if (p.from.unit.trim() !== p.into.unit.trim()) {
    return `${p.from.name} is in ${p.from.unit} and ${p.into.name} is in ${p.into.unit}. `
      + 'Merging would add quantities that are not the same thing. '
      + 'Fix the unit on whichever one is wrong first — while it still has no movements.'
  }
  return null
}

/** What the merge will actually do, in plain words, so it is confirmed with
 *  eyes open rather than clicked past. */
export function mergePreview(p: MergePair): string[] {
  const lines = [
    `Every entry, count and ledger row against ${p.from.name} will point at ${p.into.name} instead.`,
  ]
  if (p.from.stockLines > 0) {
    lines.push(`${p.from.stockQty} ${p.from.unit} of stock across ${p.from.stockLines} `
      + `${p.from.stockLines === 1 ? 'store' : 'stores'} moves onto ${p.into.name}.`)
  }
  if (p.from.openPoLines > 0) {
    lines.push(`${p.from.openPoLines} open PO ${p.from.openPoLines === 1 ? 'line' : 'lines'} will be received against ${p.into.name}.`)
  }
  lines.push(`${p.from.name} is then retired. It keeps pointing at ${p.into.name}, so old links still resolve.`)
  lines.push('This cannot be undone from the screen — the two histories become one.')
  return lines
}
