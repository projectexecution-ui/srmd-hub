'use server'

/** Corrections: the writes that fix what is already recorded.
 *
 *  Kept apart from actions.ts, which records what happened at the gate. These
 *  four undo, rename, close and merge — different risk, different audience,
 *  and every one of them refuses loudly rather than half-applying.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { one } from '@/lib/warehouse/data'
import { searchItems } from '@/lib/warehouse/admin-data'
import { gate, settingsBlocker } from '@/lib/warehouse/guards'
import { todayIST } from '@/lib/warehouse/ledger'
import {
  reversalOf, stockDelta, damagedDelta, voidBlocker,
  uniqueCode, namingBlocker, retireBlocker,
  returnBlocker, unitChangeBlocker, retireItemBlocker, mergeBlocker,
} from '@/lib/warehouse/corrections'
import type {
  PostedMovement, OnHand, ItemFacts, ReturnableOutLine, RetireStoreFacts,
} from '@/lib/warehouse/corrections'
import type { MovementKind } from '@/lib/warehouse/ledger'

type Result = { ok: boolean; error?: string }

const REVALIDATE = ['/warehouse', '/warehouse/stock', '/warehouse/entries', '/warehouse/settings']
function refresh(...extra: string[]) {
  for (const p of [...REVALIDATE, ...extra]) revalidatePath(p)
}

// ===========================================================================
// 1 · Void a gate entry
// ===========================================================================

/** Undo an entry that should not have been recorded.
 *
 *  The ledger is never rewritten. The reversal is posted as new rows next to
 *  the original, the header is stamped with who voided it and why, and the
 *  entry number stays burnt — a gap in the series is supposed to mean an
 *  unrecorded truck, and a void is the opposite of that. */
export async function voidGateEntry(
  kind: 'in' | 'out',
  entryId: string,
  reason: string,
): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  const table = kind === 'in' ? 'wh_gate_in' : 'wh_gate_out'
  const locCol = kind === 'in' ? 'location_id' : 'from_location_id'

  const { data: entry, error: eErr } = await sb
    .from(table)
    .select(`id, entry_no, entry_date, deleted_at, created_by, ${locCol}${kind === 'in' ? ', po_id' : ''}`)
    .eq('id', entryId)
    .maybeSingle<{
      id: string; entry_no: string; entry_date: string
      deleted_at: string | null; created_by: string | null
      location_id?: string; from_location_id?: string; po_id?: string | null
    }>()
  if (eErr) return { ok: false, error: eErr.message }
  if (!entry) return { ok: false, error: 'That entry no longer exists.' }

  // A keeper may undo his own slip on the day he made it; anything older, or
  // anyone else's, is an admin decision. Voiding last month's entry moves a
  // number somebody has already reported on.
  const mine = entry.created_by && me?.id && entry.created_by === me.id
  const sameDay = entry.entry_date === todayIST()
  const denied = await gate(mine && sameDay ? 'edit' : 'admin')
  if (denied) {
    return {
      ok: false,
      error: mine && sameDay
        ? denied
        : `${entry.entry_no} was recorded ${sameDay ? 'by someone else' : `on ${entry.entry_date}`}, `
          + 'so only an admin or Atm Head can void it. Ask them, saying what is wrong with it.',
    }
  }

  const locationId = (entry.location_id ?? entry.from_location_id)!
  const blocked = await settingsBlocker(entry.entry_date, locationId)
  if (blocked) return { ok: false, error: blocked }

  // What this entry actually posted. Reading the ledger rather than
  // recomputing from the lines means the reversal undoes what happened, not
  // what should have happened — the two differ precisely when something went
  // wrong, which is when this screen gets used.
  const { data: movements, error: mErr } = await sb
    .from('wh_movements')
    .select('item_id, location_id, kind, qty, rate')
    .eq('ref_table', table)
    .eq('ref_id', entryId)
  if (mErr) return { ok: false, error: `Could not read the ledger for this entry: ${mErr.message}` }

  const posted: PostedMovement[] = (movements ?? []).map(m => ({
    itemId: m.item_id, locationId: m.location_id,
    kind: m.kind as MovementKind, qty: Number(m.qty),
    rate: m.rate == null ? null : Number(m.rate),
  }))
  const reversals = reversalOf(posted)

  const onHand = await readOnHand(reversals.map(r => ({ itemId: r.itemId, locationId: r.locationId })))
  const refusal = voidBlocker(
    { entryNo: entry.entry_no, alreadyVoided: entry.deleted_at != null },
    reason,
    reversals,
    onHand,
  )
  if (refusal) return { ok: false, error: refusal }

  const note = `Void of ${entry.entry_no}: ${reason.trim()}`
  if (reversals.length > 0) {
    const { error } = await sb.from('wh_movements').insert(reversals.map(r => ({
      item_id: r.itemId, location_id: r.locationId, kind: r.kind, qty: r.qty,
      rate: r.rate, ref_table: table, ref_id: entryId, actor_id: me?.id ?? null,
      remarks: note,
    })))
    if (error) return { ok: false, error: `Could not reverse the ledger: ${error.message}` }
  }

  const stockErr = await applyDeltas(stockDelta(reversals), damagedDelta(reversals))
  if (stockErr) return { ok: false, error: stockErr }

  const { error: hErr } = await sb.from(table).update({
    deleted_at: new Date().toISOString(),
    deleted_by: me?.id ?? null,
    void_reason: reason.trim(),
  }).eq('id', entryId)
  if (hErr) return { ok: false, error: `Stock was reversed but the entry could not be marked void: ${hErr.message}` }

  if (kind === 'in' && entry.po_id) await reopenPo(entry.po_id)

  refresh('/warehouse/in', '/warehouse/out', `/warehouse/entries/${kind}/${entryId}`)
  return { ok: true }
}

/** Stock on hand for the pairs a reversal touches, with the names needed to
 *  point at the right item in a refusal. */
async function readOnHand(pairs: Array<{ itemId: string; locationId: string }>): Promise<OnHand> {
  const map: OnHand = new Map()
  if (pairs.length === 0) return map
  const sb = await createClient()
  const { data } = await sb
    .from('wh_stock')
    .select('item_id, location_id, qty, wh_items(name, unit), wh_locations(name)')
    .in('item_id', [...new Set(pairs.map(p => p.itemId))])
    .in('location_id', [...new Set(pairs.map(p => p.locationId))])
  for (const r of data ?? []) {
    map.set(`${r.item_id}|${r.location_id}`, {
      qty: Number(r.qty),
      itemName: one(r.wh_items)?.name ?? 'that item',
      unit: one(r.wh_items)?.unit ?? '',
      storeName: one(r.wh_locations)?.name ?? 'the store',
    })
  }
  return map
}

/** Apply signed good/damaged deltas to wh_stock, creating rows where needed. */
async function applyDeltas(
  good: Map<string, number>,
  damaged: Map<string, number>,
): Promise<string | null> {
  const sb = await createClient()
  const keys = new Set([...good.keys(), ...damaged.keys()])
  for (const key of keys) {
    const [itemId, locationId] = key.split('|')
    const dGood = good.get(key) ?? 0
    const dDamaged = damaged.get(key) ?? 0
    const { data: row } = await sb.from('wh_stock').select('id, qty, damaged_qty')
      .eq('item_id', itemId).eq('location_id', locationId).maybeSingle()
    const { error } = row
      ? await sb.from('wh_stock').update({
          qty: Number(row.qty) + dGood,
          damaged_qty: Number(row.damaged_qty) + dDamaged,
          last_moved_at: new Date().toISOString(),
        }).eq('id', row.id)
      : await sb.from('wh_stock').insert({
          item_id: itemId, location_id: locationId,
          qty: dGood, damaged_qty: dDamaged, last_moved_at: new Date().toISOString(),
        })
    if (error) return `The entry was reversed but one stock figure did not update: ${error.message}`
  }
  return null
}

/** A voided receipt hands its quantity back to the purchase order. Never
 *  touches a short-close: that was a deliberate decision by the Atm Head. */
async function reopenPo(poId: string): Promise<void> {
  const sb = await createClient()
  const { data: current } = await sb.from('wh_po').select('status').eq('id', poId).maybeSingle()
  if (current?.status === 'short_closed') return

  const { data: poLines } = await sb.from('wh_po_lines').select('id, ordered_qty').eq('po_id', poId)
  if (!poLines?.length) return

  const { data: got } = await sb
    .from('wh_gate_in_lines')
    .select('po_line_id, received_qty, entry:wh_gate_in(deleted_at)')
    .in('po_line_id', poLines.map(l => l.id))

  const received = new Map<string, number>()
  for (const g of got ?? []) {
    if (!g.po_line_id || one(g.entry)?.deleted_at) continue
    received.set(g.po_line_id, (received.get(g.po_line_id) ?? 0) + Number(g.received_qty))
  }
  const anyReceived = [...received.values()].some(v => v > 0)
  const allDone = poLines.every(l => (received.get(l.id) ?? 0) >= Number(l.ordered_qty))
  await sb.from('wh_po')
    .update({ status: allDone ? 'fully_received' : anyReceived ? 'partly_received' : 'open' })
    .eq('id', poId)
}

// ===========================================================================
// 2 · Stores and sites
// ===========================================================================

/** A site (Yunus Land) or a store inside one (Yunus Land Store).
 *  `parentId` null makes a site; anything else makes a store under it. */
export async function createLocation(parentId: string | null, name: string): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  // Siblings for the duplicate-name check, and every code ever used for the
  // uniqueness one — a retired store still holds its code.
  const { data: all, error } = await sb.from('wh_locations').select('id, parent_id, name, code')
  if (error) return { ok: false, error: error.message }

  const siblings = (all ?? []).filter(l => (l.parent_id ?? null) === parentId).map(l => l.name)
  const clash = namingBlocker(name, siblings)
  if (clash) return { ok: false, error: clash }

  if (parentId && !(all ?? []).some(l => l.id === parentId && l.parent_id == null)) {
    return { ok: false, error: 'That site no longer exists, or it is itself a store — stores do not nest.' }
  }

  const { error: iErr } = await sb.from('wh_locations').insert({
    parent_id: parentId,
    name: name.trim(),
    code: uniqueCode(name, (all ?? []).map(l => l.code)),
    sort: (all ?? []).filter(l => (l.parent_id ?? null) === parentId).length,
  })
  if (iErr) return { ok: false, error: iErr.message }

  refresh('/warehouse/in', '/warehouse/out')
  return { ok: true }
}

export async function renameLocation(id: string, name: string): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  const { data: all, error } = await sb.from('wh_locations').select('id, parent_id, name')
  if (error) return { ok: false, error: error.message }
  const self = (all ?? []).find(l => l.id === id)
  if (!self) return { ok: false, error: 'That store no longer exists.' }

  const siblings = (all ?? []).filter(l => (l.parent_id ?? null) === (self.parent_id ?? null)).map(l => l.name)
  const clash = namingBlocker(name, siblings, self.name)
  if (clash) return { ok: false, error: clash }

  // The code stays as it was. It is the stable handle a store is known by, and
  // renaming "Godown" to "Main Godown" should not orphan anything pointing at it.
  const { error: uErr } = await sb.from('wh_locations').update({ name: name.trim() }).eq('id', id)
  if (uErr) return { ok: false, error: uErr.message }

  refresh('/warehouse/in', '/warehouse/out')
  return { ok: true }
}

/** Say whose stock a store holds.
 *
 *  This is what makes the cross-project rule possible: an engineer asking
 *  ANOTHER project's store is always put on a returnable footing, because that
 *  material was bought against a different budget. Leaving it blank marks the
 *  store shared — Central Store and the CT containers — and asking from a shared
 *  store is never cross-project.
 *
 *  Set on the STORE, not the site: NGH holds an A store, a B store and an open
 *  area, and they do not all belong to the same project. */
export async function setLocationProject(
  id: string,
  projectId: string | null,
): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  const { data: self, error } = await sb
    .from('wh_locations').select('id, parent_id, name').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!self) return { ok: false, error: 'That store no longer exists.' }
  if (!self.parent_id) {
    return {
      ok: false,
      error: `${self.name} is a site, not a store. Material sits in the stores under it, `
        + 'so the project belongs on each store — they need not all be the same project.',
    }
  }

  const { error: uErr } = await sb
    .from('wh_locations').update({ project_id: projectId }).eq('id', id)
  if (uErr) return { ok: false, error: uErr.message }

  // The request form reads this to decide whether to force Returnable, and the
  // gate reads it when issuing, so both have to see the change.
  refresh('/warehouse/requests/new', '/warehouse/out', '/warehouse/settings')
  return { ok: true }
}

/** Retire hides a store from every picker without touching its history.
 *  Un-retiring is the same switch the other way, so a mistake costs nothing. */
export async function setLocationActive(id: string, active: boolean): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  if (!active) {
    const facts = await locationFacts(id)
    if (!facts) return { ok: false, error: 'That store no longer exists.' }
    const refusal = retireBlocker(facts)
    if (refusal) return { ok: false, error: refusal }
  }

  const { error } = await sb.from('wh_locations')
    .update({ is_active: active, deleted_at: active ? null : new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  refresh('/warehouse/in', '/warehouse/out')
  return { ok: true }
}

/** Everything the retire decision needs, read fresh rather than trusted from
 *  the client — the page may have been open since this morning. */
export async function locationFacts(id: string): Promise<RetireStoreFacts | null> {
  const sb = await createClient()
  const { data: loc } = await sb.from('wh_locations')
    .select('id, name, parent_id').eq('id', id).maybeSingle()
  if (!loc) return null

  const [stockRes, childRes, inRes, outRes, fromRes, countRes] = await Promise.all([
    sb.from('wh_stock').select('qty, damaged_qty').eq('location_id', id),
    sb.from('wh_locations').select('id', { count: 'exact', head: true })
      .eq('parent_id', id).is('deleted_at', null),
    sb.from('wh_gate_in').select('id', { count: 'exact', head: true }).eq('location_id', id),
    sb.from('wh_gate_out').select('id', { count: 'exact', head: true }).eq('to_location_id', id),
    sb.from('wh_gate_out').select('id', { count: 'exact', head: true }).eq('from_location_id', id),
    sb.from('wh_counts').select('id', { count: 'exact', head: true }).eq('location_id', id),
  ])

  const held = (stockRes.data ?? []).filter(r => Number(r.qty) !== 0 || Number(r.damaged_qty) !== 0)
  return {
    storeName: loc.name,
    stockLines: held.length,
    stockQty: held.reduce((s, r) => s + Number(r.qty) + Number(r.damaged_qty), 0),
    entries: (inRes.count ?? 0) + (outRes.count ?? 0) + (fromRes.count ?? 0) + (countRes.count ?? 0),
    childStores: childRes.count ?? 0,
  }
}

// ===========================================================================
// 3 · Returning returnable material
// ===========================================================================

/** Shuttering, props and plates come back. Until this existed, the Returnables
 *  Outstanding report could only ever grow. */
export async function recordReturn(
  outLineId: string,
  qty: number,
  remarks: string | null,
): Promise<Result> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()
  const me = await getMyUser()

  const { data: line, error } = await sb
    .from('wh_gate_out_lines')
    .select(`id, item_id, qty, returned_qty, rate,
             wh_items(name, unit),
             entry:wh_gate_out(id, entry_no, entry_date, is_returnable, from_location_id, deleted_at)`)
    .eq('id', outLineId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!line) return { ok: false, error: 'That issue line no longer exists.' }

  const entry = one(line.entry)
  const item = one(line.wh_items)
  if (!entry) return { ok: false, error: 'That issue line has lost its entry.' }
  if (entry.deleted_at) return { ok: false, error: `${entry.entry_no} was voided — there is nothing out against it.` }

  const l: ReturnableOutLine = {
    lineId: line.id, itemId: line.item_id,
    itemName: item?.name ?? 'that item', unit: item?.unit ?? '',
    qty: Number(line.qty), returnedQty: Number(line.returned_qty),
  }
  const refusal = returnBlocker(l, qty, entry.is_returnable)
  if (refusal) return { ok: false, error: refusal }

  const blocked = await settingsBlocker(todayIST(), entry.from_location_id)
  if (blocked) return { ok: false, error: blocked }

  const { error: mErr } = await sb.from('wh_movements').insert({
    item_id: line.item_id, location_id: entry.from_location_id,
    kind: 'return', qty, rate: line.rate,
    ref_table: 'wh_gate_out', ref_id: entry.id, actor_id: me?.id ?? null,
    remarks: `Returned against ${entry.entry_no}${remarks?.trim() ? ` — ${remarks.trim()}` : ''}`,
  })
  if (mErr) return { ok: false, error: `Could not write the ledger: ${mErr.message}` }

  const stockErr = await applyDeltas(
    new Map([[`${line.item_id}|${entry.from_location_id}`, qty]]),
    new Map(),
  )
  if (stockErr) return { ok: false, error: stockErr }

  const { error: uErr } = await sb.from('wh_gate_out_lines')
    .update({ returned_qty: Number(line.returned_qty) + qty })
    .eq('id', outLineId)
  if (uErr) return { ok: false, error: `Stock came back but the line was not marked returned: ${uErr.message}` }

  refresh('/warehouse/out', '/warehouse/reports/control/returnables')
  return { ok: true }
}

// ===========================================================================
// 4 · The item master
// ===========================================================================

/** Everything the item screen needs to decide what may be changed. */
export async function itemFacts(itemId: string): Promise<ItemFacts | null> {
  const sb = await createClient()
  const { data: item } = await sb.from('wh_items')
    .select('id, name, unit').eq('id', itemId).maybeSingle()
  if (!item) return null

  const [movRes, stockRes, poRes] = await Promise.all([
    sb.from('wh_movements').select('id', { count: 'exact', head: true }).eq('item_id', itemId),
    sb.from('wh_stock').select('qty, damaged_qty').eq('item_id', itemId),
    sb.from('wh_po_lines').select('id, wh_po!inner(status)').eq('item_id', itemId)
      .in('wh_po.status', ['open', 'partly_received']),
  ])
  const held = (stockRes.data ?? []).filter(r => Number(r.qty) !== 0 || Number(r.damaged_qty) !== 0)
  return {
    itemId: item.id, name: item.name, unit: item.unit,
    movements: movRes.count ?? 0,
    stockLines: held.length,
    stockQty: held.reduce((s, r) => s + Number(r.qty) + Number(r.damaged_qty), 0),
    openPoLines: poRes.data?.length ?? 0,
  }
}

export async function updateItem(itemId: string, patch: {
  name: string
  unit: string
  category: string | null
  subcategory: string | null
}): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  const facts = await itemFacts(itemId)
  if (!facts) return { ok: false, error: 'That item no longer exists.' }

  if (patch.name.trim().length < 2) return { ok: false, error: 'Give the item a name of at least two characters.' }
  const unitRefusal = unitChangeBlocker(facts, patch.unit)
  if (unitRefusal) return { ok: false, error: unitRefusal }

  const { data: clash } = await sb.from('wh_items')
    .select('id, name').ilike('name', patch.name.trim())
    .is('deleted_at', null).neq('id', itemId).limit(1)
  if (clash?.length) {
    return {
      ok: false,
      error: `${clash[0].name} already exists. Two rows for one material split its stock in half — `
        + 'merge this one into it instead of renaming it to match.',
    }
  }

  const { error } = await sb.from('wh_items').update({
    name: patch.name.trim(),
    unit: patch.unit.trim(),
    category: patch.category?.trim() || null,
    subcategory: patch.subcategory?.trim() || null,
  }).eq('id', itemId)
  if (error) return { ok: false, error: error.message }

  refresh('/warehouse/items')
  return { ok: true }
}

export async function setItemActive(itemId: string, active: boolean): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()

  if (!active) {
    const facts = await itemFacts(itemId)
    if (!facts) return { ok: false, error: 'That item no longer exists.' }
    const refusal = retireItemBlocker(facts)
    if (refusal) return { ok: false, error: refusal }
  }

  const me = await getMyUser()
  const { error } = await sb.from('wh_items').update({
    is_active: active,
    deleted_at: active ? null : new Date().toISOString(),
    deleted_by: active ? null : me?.id ?? null,
  }).eq('id', itemId)
  if (error) return { ok: false, error: error.message }

  refresh('/warehouse/items')
  return { ok: true }
}

/** Fold one item into another: same material, two rows.
 *
 *  Every table that names the loser is repointed at the keeper, then the loser
 *  is retired pointing at what it became. Two tables can collide while doing
 *  it — stock is unique per item per store and a count sheet is unique per
 *  item — so those are added together and the spare row removed rather than
 *  letting the write fail halfway. */
export async function mergeItems(fromId: string, intoId: string): Promise<Result> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()
  const me = await getMyUser()

  const [from, into] = await Promise.all([itemFacts(fromId), itemFacts(intoId)])
  if (!from || !into) return { ok: false, error: 'One of those items no longer exists.' }
  const refusal = mergeBlocker({ from, into })
  if (refusal) return { ok: false, error: refusal }

  // --- stock: add the quantities together, one row per store ---------------
  const { data: fromStock, error: sErr } = await sb.from('wh_stock')
    .select('id, location_id, qty, damaged_qty, min_qty').eq('item_id', fromId)
  if (sErr) return { ok: false, error: sErr.message }

  for (const row of fromStock ?? []) {
    const { data: target } = await sb.from('wh_stock')
      .select('id, qty, damaged_qty, min_qty')
      .eq('item_id', intoId).eq('location_id', row.location_id).maybeSingle()
    if (target) {
      const { error } = await sb.from('wh_stock').update({
        qty: Number(target.qty) + Number(row.qty),
        damaged_qty: Number(target.damaged_qty) + Number(row.damaged_qty),
        min_qty: target.min_qty ?? row.min_qty,
        last_moved_at: new Date().toISOString(),
      }).eq('id', target.id)
      if (error) return { ok: false, error: `Merging stock failed: ${error.message}` }
      const { error: dErr } = await sb.from('wh_stock').delete().eq('id', row.id)
      if (dErr) return { ok: false, error: `Merging stock failed: ${dErr.message}` }
    } else {
      const { error } = await sb.from('wh_stock').update({ item_id: intoId }).eq('id', row.id)
      if (error) return { ok: false, error: `Merging stock failed: ${error.message}` }
    }
  }

  // --- count sheets: one line per item per count ---------------------------
  const { data: fromCounts } = await sb.from('wh_count_lines')
    .select('id, count_id').eq('item_id', fromId)
  for (const row of fromCounts ?? []) {
    const { data: target } = await sb.from('wh_count_lines')
      .select('id').eq('item_id', intoId).eq('count_id', row.count_id).maybeSingle()
    // A count that already sheets the keeper item keeps its own line: the two
    // were counted separately and merging the numbers now would invent a
    // difference that nobody observed.
    const { error } = target
      ? await sb.from('wh_count_lines').delete().eq('id', row.id)
      : await sb.from('wh_count_lines').update({ item_id: intoId }).eq('id', row.id)
    if (error) return { ok: false, error: `Merging count sheets failed: ${error.message}` }
  }

  // --- everything else just repoints ---------------------------------------
  for (const table of ['wh_movements', 'wh_gate_in_lines', 'wh_gate_out_lines', 'wh_po_lines'] as const) {
    const { error } = await sb.from(table).update({ item_id: intoId }).eq('item_id', fromId)
    if (error) return { ok: false, error: `Merging ${table} failed: ${error.message}` }
  }

  const { error: fErr } = await sb.from('wh_items').update({
    merged_into: intoId,
    is_active: false,
    deleted_at: new Date().toISOString(),
    deleted_by: me?.id ?? null,
  }).eq('id', fromId)
  if (fErr) return { ok: false, error: `The history moved across but the old item is still live: ${fErr.message}` }

  refresh('/warehouse/items')
  return { ok: true }
}

/** Item search for the merge picker. The list behind it is server-rendered;
 *  this is the one place a client needs to look something up mid-flow. */
export async function findItems(q: string) {
  const denied = await gate('edit')
  if (denied) return []
  const { rows } = await searchItems(q, { limit: 12 })
  return rows
}
