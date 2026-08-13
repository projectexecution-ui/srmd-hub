'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { getLocationTree, getPostableSpots, getCount, one } from '@/lib/warehouse/data'
import { aliasKey } from '@/lib/warehouse/match'
import { buildSheet, submitBlocker, adjustments } from '@/lib/warehouse/count'
import type { GateInInput } from '@/lib/warehouse/types'
import type { CountScope, SheetSource } from '@/lib/warehouse/count'

/** The permissions-matrix gate. RLS checks the same thing, but a policy that
 *  filters a row out of an UPDATE returns 200 with zero rows and no error — so
 *  every action checks here first and gives a sentence a human can act on. */
async function gate(action: 'edit' | 'admin' = 'edit'): Promise<string | null> {
  const perms = await getMyPermissions()
  if (!can(perms, 'warehouse', action)) {
    return action === 'admin'
      ? 'Only an admin or Atm Head can do this — ask them to approve it.'
      : 'You do not have permission to record warehouse entries.'
  }
  return null
}

export type SaveResult = { ok: true; entryNo: string } | { ok: false; error: string }
export type PoResult = { ok: true; poNo: string; lines: number; learned: number } | { ok: false; error: string }

/** Create a PO in Warehouse V2 from confirmed lines.
 *
 *  The header comes from the Indent → PO Tracker (IN4) or is typed; the item on
 *  each line is whatever the user confirmed, because IN4's generic material
 *  names match our item master only 1.3% of the time. Each confirmation is
 *  stored as an alias so the same material links itself next time. */
export async function savePo(input: {
  poNo: string
  poDate: string | null
  vendor: string | null
  entity: string | null
  projectId: string | null
  indentNo: string | null
  source: 'manual' | 'tracker'
  lines: Array<{ itemId: string; orderedQty: number; rate: number | null; sourceText: string | null }>
}): Promise<PoResult> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const poNo = input.poNo.trim()
  if (!poNo) return { ok: false, error: 'A PO number is needed.' }

  const lines = input.lines.filter(l => l.itemId && l.orderedQty > 0)
  if (lines.length === 0) {
    return { ok: false, error: 'Confirm at least one line — pick the item it refers to and give the ordered quantity.' }
  }
  // One PO cannot order the same item twice; the tracker repeats a material per
  // indent, so collapse rather than letting the unique index throw.
  const byItem = new Map<string, { itemId: string; orderedQty: number; rate: number | null; sourceText: string | null }>()
  for (const l of lines) {
    const cur = byItem.get(l.itemId)
    if (cur) { cur.orderedQty += l.orderedQty; continue }
    byItem.set(l.itemId, { ...l })
  }

  const sb = await createClient()
  const me = await getMyUser()

  const { data: dupe } = await sb.from('wh_po').select('id').eq('po_no', poNo).maybeSingle()
  if (dupe) return { ok: false, error: `${poNo} is already in Warehouse V2. Open it to change its lines.` }

  const { data: po, error: pErr } = await sb
    .from('wh_po')
    .insert({
      po_no: poNo,
      po_date: isoOrNull(input.poDate),
      vendor: input.vendor,
      entity: input.entity,
      project_id: input.projectId,
      indent_no: input.indentNo,
      source: input.source,
      created_by: me?.id ?? null,
    })
    .select('id, po_no')
    .single()
  if (pErr || !po) return { ok: false, error: pErr?.message ?? 'Could not create the PO.' }

  const { error: lErr } = await sb.from('wh_po_lines').insert(
    [...byItem.values()].map(l => ({
      po_id: po.id, item_id: l.itemId, ordered_qty: l.orderedQty, rate: l.rate, source_text: l.sourceText,
    })),
  )
  if (lErr) {
    await sb.from('wh_po').delete().eq('id', po.id)   // never leave a PO with no lines
    return { ok: false, error: lErr.message }
  }

  // Remember every confirmation. DO NOTHING on conflict: an existing alias was
  // set deliberately and must not be silently rewritten by a later import.
  const learn = [...byItem.values()]
    .filter(l => l.sourceText?.trim())
    .map(l => ({
      alias_key: aliasKey(l.sourceText!), source_text: l.sourceText!.trim(),
      item_id: l.itemId, source: input.source, created_by: me?.id ?? null,
    }))
  let learned = 0
  if (learn.length > 0) {
    const { data: ins } = await sb
      .from('wh_item_aliases')
      .upsert(learn, { onConflict: 'alias_key', ignoreDuplicates: true })
      .select('id')
    learned = ins?.length ?? 0
  }

  revalidatePath('/warehouse/po')
  revalidatePath('/warehouse/in')
  return { ok: true, poNo: po.po_no, lines: byItem.size, learned }
}

export type GateOutInput = {
  destType: 'site' | 'store'
  fromLocationId: string
  toLocationId: string | null
  projectId: string | null
  entity: string | null
  engineerId: string | null
  isReturnable: boolean
  returnDueDate: string | null
  vehicleNo: string | null
  remarks: string | null
  lines: Array<{ itemId: string; qty: number; rate: number | null }>
}

/** Record material leaving a store — EITHER consumed at a site OR moved to
 *  another store. One action, because on screen the two look identical; the
 *  difference is that a site issue reduces total stock and charges a project,
 *  while a move only relocates and charges nothing. The database CHECK on
 *  wh_gate_out enforces the shape; this enforces the stock effect. (#8) */
export async function saveGateOut(input: GateOutInput): Promise<SaveResult> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const lines = input.lines.filter(l => l.itemId && l.qty > 0)
  if (lines.length === 0) return { ok: false, error: 'Add at least one item with a quantity.' }
  if (!input.fromLocationId) return { ok: false, error: 'Pick the store it is going out of.' }
  if (input.destType === 'site' && !input.projectId) {
    return { ok: false, error: 'A site issue must say which project it is for — that is what gets charged.' }
  }
  if (input.destType === 'store') {
    if (!input.toLocationId) return { ok: false, error: 'Pick the store it is going to.' }
    if (input.toLocationId === input.fromLocationId) {
      return { ok: false, error: 'The two stores are the same — nothing would move.' }
    }
  }

  const sb = await createClient()
  const me = await getMyUser()

  const sites = await getLocationTree()
  const { ids } = await getPostableSpots(sites)
  if (!ids.includes(input.fromLocationId)) {
    const spot = sites.flatMap(s => s.spots).find(s => s.id === input.fromLocationId)
    return {
      ok: false,
      error: `You are not the keeper of ${spot?.name ?? 'that store'}, so you cannot issue from it. `
        + 'Ask its keeper, or have an admin assign you to it in Settings.',
    }
  }

  // Never let stock go negative — that is a data error, not a business event.
  const { data: have } = await sb
    .from('wh_stock')
    .select('item_id, qty, wh_items(name, unit)')
    .eq('location_id', input.fromLocationId)
    .in('item_id', lines.map(l => l.itemId))
  const stock = new Map((have ?? []).map(r => [r.item_id, r]))
  for (const l of lines) {
    const s = stock.get(l.itemId)
    const item = s ? one(s.wh_items) : null
    const available = s ? Number(s.qty) : 0
    if (l.qty > available) {
      return {
        ok: false,
        error: `Only ${available} ${item?.unit ?? ''} of ${item?.name ?? 'that item'} is in this store — `
          + `you are trying to take ${l.qty}. Check the store, or record the missing IN entry first.`,
      }
    }
  }

  const register = input.destType === 'site' ? 'out' : 'move'
  const { data: entryNo, error: noErr } = await sb.rpc('fn_wh_next_no', { p_register: register })
  if (noErr || !entryNo) return { ok: false, error: noErr?.message ?? 'Could not allocate an entry number.' }

  const { data: header, error: hErr } = await sb
    .from('wh_gate_out')
    .insert({
      entry_no: entryNo,
      dest_type: input.destType,
      from_location_id: input.fromLocationId,
      // The CHECK constraint refuses a move that names a project or an
      // engineer, so these are nulled rather than passed through blindly.
      to_location_id: input.destType === 'store' ? input.toLocationId : null,
      project_id: input.destType === 'site' ? input.projectId : null,
      entity: input.entity,
      engineer_id: input.destType === 'site' ? input.engineerId : null,
      is_returnable: input.destType === 'site' ? input.isReturnable : false,
      return_due_date: input.destType === 'site' && input.isReturnable ? input.returnDueDate : null,
      vehicle_no: input.vehicleNo,
      remarks: input.remarks,
      created_by: me?.id ?? null,
    })
    .select('id, entry_no')
    .single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not save the entry.' }

  const { error: lErr } = await sb.from('wh_gate_out_lines').insert(
    lines.map(l => ({ gate_out_id: header.id, item_id: l.itemId, qty: l.qty, rate: l.rate })),
  )
  if (lErr) {
    await sb.from('wh_gate_out').delete().eq('id', header.id)
    return { ok: false, error: lErr.message }
  }

  const moveErr = await applyOutStock(header.id, input, lines, me?.id ?? null)
  if (moveErr) return { ok: false, error: moveErr }

  revalidatePath('/warehouse')
  revalidatePath('/warehouse/out')
  revalidatePath('/warehouse/stock')
  return { ok: true, entryNo: header.entry_no }
}

/** A site issue takes stock away. A store move takes it from one shelf and puts
 *  the same quantity on another, so the total never changes — which is what
 *  makes moves safe to allow at all. */
async function applyOutStock(
  outId: string,
  input: GateOutInput,
  lines: GateOutInput['lines'],
  actorId: string | null,
): Promise<string | null> {
  const sb = await createClient()
  const toStore = input.destType === 'store' && input.toLocationId

  const movements = lines.flatMap(l => {
    const base = { item_id: l.itemId, qty: l.qty, rate: l.rate, ref_table: 'wh_gate_out', ref_id: outId, actor_id: actorId }
    return toStore
      ? [{ ...base, location_id: input.fromLocationId, kind: 'move_out' },
         { ...base, location_id: input.toLocationId!, kind: 'move_in' }]
      : [{ ...base, location_id: input.fromLocationId, kind: 'issue' }]
  })
  const { error } = await sb.from('wh_movements').insert(movements)
  if (error) return `Entry saved but the stock ledger failed: ${error.message}`

  for (const l of lines) {
    const { data: from } = await sb.from('wh_stock').select('id, qty')
      .eq('item_id', l.itemId).eq('location_id', input.fromLocationId).maybeSingle()
    if (from) {
      const { error: e } = await sb.from('wh_stock')
        .update({ qty: Number(from.qty) - l.qty, last_moved_at: new Date().toISOString() })
        .eq('id', from.id)
      if (e) return `Stock update failed: ${e.message}`
    }

    if (toStore) {
      const { data: to } = await sb.from('wh_stock').select('id, qty')
        .eq('item_id', l.itemId).eq('location_id', input.toLocationId!).maybeSingle()
      const { error: e } = to
        ? await sb.from('wh_stock')
            .update({ qty: Number(to.qty) + l.qty, last_moved_at: new Date().toISOString() })
            .eq('id', to.id)
        : await sb.from('wh_stock').insert({
            item_id: l.itemId, location_id: input.toLocationId!, qty: l.qty,
            last_moved_at: new Date().toISOString(),
          })
      if (e) return `Receiving store update failed: ${e.message}`
    }
  }
  return null
}

/** The engineer confirms at site what he actually received. The gate signature
 *  only covers handover — he cannot count 11 lines at the barrier. (#12) */
export async function confirmReceipt(outId: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()
  const me = await getMyUser()
  const { data, error } = await sb
    .from('wh_gate_out')
    .update({ confirmed_by: me?.id ?? null, confirmed_at: new Date().toISOString() })
    .eq('id', outId)
    .is('confirmed_at', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  // RLS filtering a row out of an UPDATE returns 200 with zero rows and no
  // error, so an empty result must be treated as a refusal, not a success.
  if (!data || data.length === 0) {
    return { ok: false, error: 'Already confirmed, or you do not have access to this entry.' }
  }
  revalidatePath('/warehouse/out')
  return { ok: true }
}

// ===========================================================================
// Physical count (S5). Book stock is what the system believes; the count is
// what is on the shelf. The difference only moves stock after somebody senior
// approves it — a keeper who could adjust his own store to match his count
// would have a licence to write off anything. (#2)
// ===========================================================================

export type CountResult = { ok: true; id: string; countNo: string } | { ok: false; error: string }

/** Open a count and freeze the book quantities into its sheet.
 *
 *  Frozen on purpose: if a truck arrives while he is walking, comparing his
 *  count against a book number that moved underneath him would invent a
 *  difference that never existed. */
export async function startCount(input: {
  locationId: string
  scope: CountScope
  witnessId: string | null
  blind: boolean
}): Promise<CountResult> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  if (!input.locationId) return { ok: false, error: 'Pick the store you are counting.' }

  const sb = await createClient()
  const me = await getMyUser()

  if (input.witnessId && input.witnessId === me?.id) {
    return { ok: false, error: 'The witness has to be someone else — counting your own store alone is checking yourself.' }
  }

  const sites = await getLocationTree()
  const { ids } = await getPostableSpots(sites)
  if (!ids.includes(input.locationId)) {
    const spot = sites.flatMap(s => s.spots).find(s => s.id === input.locationId)
    return {
      ok: false,
      error: `You are not the keeper of ${spot?.name ?? 'that store'}, so you cannot count it. `
        + 'Ask its keeper, or have an admin assign you to it in Settings.',
    }
  }

  // One open count per store: two people walking the same shelves against two
  // frozen sheets would each approve away the other's difference.
  const { data: open } = await sb
    .from('wh_counts')
    .select('id, count_no')
    .eq('location_id', input.locationId)
    .in('status', ['counting', 'submitted'])
    .limit(1)
  if (open && open.length > 0) {
    return {
      ok: false,
      error: `${open[0].count_no} is already open for this store. Finish or reject that one first.`,
    }
  }

  const { data: stock } = await sb
    .from('wh_stock')
    .select('item_id, qty, wh_items(name, unit, last_rate, deleted_at, is_active)')
    .eq('location_id', input.locationId)

  const source: SheetSource[] = (stock ?? []).flatMap(r => {
    const item = one(r.wh_items)
    if (!item || item.deleted_at || !item.is_active) return []
    return [{
      itemId: r.item_id, itemName: item.name, unit: item.unit,
      qty: Number(r.qty), rate: item.last_rate == null ? null : Number(item.last_rate),
    }]
  })
  const sheet = buildSheet(source, input.scope)

  const { data: countNo, error: noErr } = await sb.rpc('fn_wh_next_no', { p_register: 'count' })
  if (noErr || !countNo) return { ok: false, error: noErr?.message ?? 'Could not allocate a count number.' }

  const { data: header, error: hErr } = await sb
    .from('wh_counts')
    .insert({
      count_no: countNo,
      location_id: input.locationId,
      scope: input.scope,
      blind: input.blind,
      counted_by: me?.id ?? null,
      witness_id: input.witnessId,
    })
    .select('id, count_no')
    .single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not open the count.' }

  if (sheet.length > 0) {
    const { error: lErr } = await sb.from('wh_count_lines').insert(
      sheet.map((r, i) => ({
        count_id: header.id, item_id: r.itemId, seq: i + 1, book_qty: r.qty,
      })),
    )
    if (lErr) {
      await sb.from('wh_counts').delete().eq('id', header.id)
      return { ok: false, error: lErr.message }
    }
  }

  revalidatePath('/warehouse/count')
  return { ok: true, id: header.id, countNo: header.count_no }
}

/** Save one line as he walks. Saved per item rather than at the end, so a phone
 *  that dies on the third shelf does not throw away the whole walk. */
export async function saveCountLine(input: {
  lineId: string
  countedQty: number | null
  skipped: boolean
  skipReason: string | null
  reason: string | null
  remark: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  if (input.skipped && !input.skipReason?.trim()) {
    return { ok: false, error: 'Say why it could not be counted — a blank skip hides the same gap the count is looking for.' }
  }
  if (!input.skipped && input.countedQty !== null && input.countedQty < 0) {
    return { ok: false, error: 'A counted quantity cannot be negative.' }
  }

  const sb = await createClient()

  // Only a count still being walked may be edited. Without this, reopening an
  // old tab and typing would rewrite an approved sheet after the stock moved.
  const { data: line } = await sb
    .from('wh_count_lines')
    .select('id, count_id, wh_counts(status)')
    .eq('id', input.lineId)
    .maybeSingle()
  if (!line) return { ok: false, error: 'That line is not on this count any more.' }
  if (one(line.wh_counts)?.status !== 'counting') {
    return { ok: false, error: 'This count has already been submitted — it cannot be changed.' }
  }

  const { data, error } = await sb
    .from('wh_count_lines')
    .update({
      counted_qty: input.skipped ? null : input.countedQty,
      skipped: input.skipped,
      skip_reason: input.skipped ? input.skipReason!.trim() : null,
      reason: input.reason?.trim() || null,
      remark: input.remark?.trim() || null,
    })
    .eq('id', input.lineId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'You do not have access to this count.' }
  return { ok: true }
}

/** Add something he found on the shelf that the book does not know about.
 *
 *  This is not an edge case — material received without a gate entry is exactly
 *  what a count exists to surface, and it can only be surfaced as a line with a
 *  book quantity of zero. */
export async function addFoundItem(input: { countId: string; itemId: string }): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  if (!input.itemId) return { ok: false, error: 'Pick the item you found.' }

  const sb = await createClient()
  const { data: header } = await sb
    .from('wh_counts')
    .select('id, status, location_id')
    .eq('id', input.countId)
    .maybeSingle()
  if (!header) return { ok: false, error: 'That count no longer exists.' }
  if (header.status !== 'counting') {
    return { ok: false, error: 'This count has already been submitted — it cannot be changed.' }
  }

  const { data: dupe } = await sb
    .from('wh_count_lines')
    .select('id')
    .eq('count_id', input.countId)
    .eq('item_id', input.itemId)
    .maybeSingle()
  if (dupe) return { ok: false, error: 'That item is already on this sheet.' }

  // Its book quantity in THIS store, not zero-by-assumption: a spot check may
  // simply not have picked the item up, and pretending the book says nil would
  // manufacture a difference.
  const { data: stock } = await sb
    .from('wh_stock')
    .select('qty')
    .eq('location_id', header.location_id)
    .eq('item_id', input.itemId)
    .maybeSingle()

  const { data: last } = await sb
    .from('wh_count_lines')
    .select('seq')
    .eq('count_id', input.countId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await sb.from('wh_count_lines').insert({
    count_id: input.countId,
    item_id: input.itemId,
    seq: (last?.seq ?? 0) + 1,
    book_qty: stock ? Number(stock.qty) : 0,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/warehouse/count/${input.countId}`)
  return { ok: true }
}

/** Close the walk and hand it up for approval. Nothing has moved yet. */
export async function submitCount(countId: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const sb = await createClient()
  const { count, lines, error } = await getCount(countId)
  if (error || !count) return { ok: false, error: error?.message ?? 'Could not load this count.' }
  if (count.status !== 'counting') return { ok: false, error: 'This count has already been submitted.' }

  // The same rule the screen shows, enforced again here: the screen can be
  // bypassed, and a half-walked sheet approved as fact is worse than no count.
  const blocker = submitBlocker(lines, count.witness_id)
  if (blocker) return { ok: false, error: blocker }

  const { data, error: uErr } = await sb
    .from('wh_counts')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', countId)
    .eq('status', 'counting')
    .select('id')
  if (uErr) return { ok: false, error: uErr.message }
  if (!data || data.length === 0) return { ok: false, error: 'Already submitted, or you do not have access to this count.' }

  revalidatePath('/warehouse/count')
  revalidatePath(`/warehouse/count/${countId}`)
  return { ok: true }
}

/** Throw away a count that was never finished.
 *
 *  Without this, starting a count by mistake would lock that store out of ever
 *  being counted again — one open count per store is the rule, and only the
 *  approver can close a submitted one. Discarding changes nothing in stock. */
export async function abandonCount(countId: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const sb = await createClient()
  const me = await getMyUser()
  const perms = await getMyPermissions()

  const { data: header } = await sb
    .from('wh_counts')
    .select('id, status, counted_by, count_no')
    .eq('id', countId)
    .maybeSingle()
  if (!header) return { ok: false, error: 'That count no longer exists.' }
  if (header.status !== 'counting') {
    return {
      ok: false,
      error: header.status === 'submitted'
        ? 'This count has been submitted — ask the approver to send it back instead.'
        : 'This count is already closed.',
    }
  }
  const isMine = Boolean(me?.id && me.id === header.counted_by)
  if (!isMine && !can(perms, 'warehouse', 'admin')) {
    return { ok: false, error: 'Only the person counting, or an admin, can discard this count.' }
  }

  const who = isMine ? 'the counter' : 'an admin'
  const { data, error } = await sb
    .from('wh_counts')
    .update({ status: 'rejected', reject_reason: `Discarded before it was finished, by ${who}.` })
    .eq('id', countId)
    .eq('status', 'counting')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Someone else has just acted on this count. Refresh to see where it stands.' }
  }

  revalidatePath('/warehouse/count')
  revalidatePath(`/warehouse/count/${countId}`)
  return { ok: true }
}

/** Approve the count and let it correct stock.
 *
 *  This is the only place in the module where stock changes without a truck or a
 *  gate pass behind it, which is why it needs a second person and why every
 *  correction is written to the ledger as an `adjust` movement carrying the
 *  reason the counter gave. */
export async function approveCount(countId: string): Promise<{ ok: boolean; error?: string; applied?: number }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }

  const sb = await createClient()
  const me = await getMyUser()
  const { count, lines, error } = await getCount(countId)
  if (error || !count) return { ok: false, error: error?.message ?? 'Could not load this count.' }
  if (count.status !== 'submitted') {
    return { ok: false, error: count.status === 'approved' ? 'This count is already approved.' : 'Only a submitted count can be approved.' }
  }
  if (count.counted_by && me?.id === count.counted_by) {
    return { ok: false, error: 'You counted this store yourself — someone else has to approve it.' }
  }
  if (!count.witness_id) {
    return { ok: false, error: 'This count has no witness recorded, so it cannot be approved. Reject it and count again with a witness.' }
  }

  // Stamp the approval FIRST and only from `submitted`, so two approvers
  // clicking together cannot both go on to post the same corrections.
  const { data: claimed, error: aErr } = await sb
    .from('wh_counts')
    .update({ status: 'approved', approved_by: me?.id ?? null, approved_at: new Date().toISOString() })
    .eq('id', countId)
    .eq('status', 'submitted')
    .select('id')
  if (aErr) return { ok: false, error: aErr.message }
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: 'Someone else has just acted on this count. Refresh to see where it stands.' }
  }

  const corrections = adjustments(lines)
  const locationId = count.location_id

  // Ledger first, and all of it in one insert: if the ledger cannot be written
  // then no stock is touched either, rather than stock moving with no audit
  // trail behind it.
  if (corrections.length > 0) {
    const { error: mErr } = await sb.from('wh_movements').insert(
      corrections.map(c => ({
        item_id: c.itemId,
        location_id: locationId,
        kind: 'adjust',
        // The SIGNED correction, so in-minus-out still reconciles to the stock
        // figure after a count.
        qty: c.diff,
        ref_table: 'wh_counts',
        ref_id: countId,
        actor_id: me?.id ?? null,
        remarks: `${count.count_no}${c.reason ? ` · ${c.reason}` : ''}`,
      })),
    )
    if (mErr) {
      return {
        ok: false,
        error: `Approved, but the ledger could not be written, so stock was left alone: ${mErr.message}. `
          + 'Tell your admin — the corrections still need posting.',
      }
    }
  }

  for (const c of corrections) {
    const { data: row } = await sb
      .from('wh_stock')
      .select('id')
      .eq('item_id', c.itemId)
      .eq('location_id', locationId)
      .maybeSingle()
    // Set to the counted figure rather than adding the difference — the count
    // IS the new truth, and adding would drift if anything moved in between.
    const { error: sErr } = row
      ? await sb.from('wh_stock')
          .update({ qty: c.countedQty, last_moved_at: new Date().toISOString() })
          .eq('id', row.id)
      : await sb.from('wh_stock').insert({
          item_id: c.itemId, location_id: locationId, qty: c.countedQty,
          last_moved_at: new Date().toISOString(),
        })
    if (sErr) {
      return {
        ok: false,
        error: `Approved, and the ledger is written, but the stock figure for one item did not update: ${sErr.message}. `
          + 'Tell your admin — stock and the ledger are out of step until it is fixed.',
      }
    }
  }

  revalidatePath('/warehouse')
  revalidatePath('/warehouse/count')
  revalidatePath(`/warehouse/count/${countId}`)
  revalidatePath('/warehouse/stock')
  return { ok: true, applied: corrections.length }
}

/** Send it back. Nothing moves, and the reason is kept — a count rejected with
 *  no reason is how a real shortage gets buried. */
export async function rejectCount(countId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  if (!reason.trim()) return { ok: false, error: 'Say why you are sending it back, so it can be recounted properly.' }

  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_counts')
    .update({ status: 'rejected', reject_reason: reason.trim() })
    .eq('id', countId)
    .eq('status', 'submitted')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Only a submitted count can be sent back. Refresh to see where this one stands.' }
  }

  revalidatePath('/warehouse/count')
  revalidatePath(`/warehouse/count/${countId}`)
  return { ok: true }
}

/** IN4 writes dates like "Apr 22, 2023". */
function isoOrNull(s: string | null): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

/** Record one Gate IN entry (one challan / one truck), then move the stock.
 *
 *  The two quantity checks stay separate on purpose: challan-vs-received is a
 *  shortage against the supplier (#9); PO-vs-total-received is a pending
 *  balance and usually means nothing is wrong (#21). An over-receipt is saved
 *  with a warning and never blocked — you cannot turn a truck away at the
 *  barrier. */
export async function saveGateIn(input: GateInInput): Promise<SaveResult> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const lines = input.lines.filter(l => l.itemId && l.receivedQty > 0)
  if (lines.length === 0) return { ok: false, error: 'Add at least one item with a received quantity.' }
  if (!input.party.trim()) return { ok: false, error: 'Who delivered it? Fill in the party name.' }
  if (!input.locationId) return { ok: false, error: 'Pick the storage location it went into.' }
  if (!input.poId && !input.poNoText?.trim() && !input.noPoReason?.trim()) {
    return { ok: false, error: 'No PO on this entry — give a short reason, it goes on the monthly no-PO report.' }
  }
  for (const l of lines) {
    if (l.damagedQty > l.receivedQty) {
      return { ok: false, error: 'Damaged quantity cannot be more than what was received.' }
    }
  }

  const sb = await createClient()
  const me = await getMyUser()

  // Keeper→store scoping: a keeper posts only where he actually stands. (#22)
  const sites = await getLocationTree()
  const { ids } = await getPostableSpots(sites)
  if (!ids.includes(input.locationId)) {
    const spot = sites.flatMap(s => s.spots).find(s => s.id === input.locationId)
    return {
      ok: false,
      error: `You are not the keeper of ${spot?.name ?? 'that store'}, so you cannot post an entry there. `
        + 'Ask its keeper, or have an admin assign you to it in Settings.',
    }
  }

  // Burn a number only now that the entry is definitely being written — a gap
  // in the series is supposed to mean an unrecorded truck, not an abandoned
  // form. (#1)
  const { data: entryNo, error: noErr } = await sb.rpc('fn_wh_next_no', { p_register: 'in' })
  if (noErr || !entryNo) return { ok: false, error: noErr?.message ?? 'Could not allocate an entry number.' }

  const { data: header, error: hErr } = await sb
    .from('wh_gate_in')
    .insert({
      entry_no: entryNo,
      owner: input.owner,
      po_id: input.poId,
      po_no_text: input.poNoText,
      no_po_reason: input.noPoReason,
      party: input.party.trim(),
      entity: input.entity,
      project_id: input.projectId,
      location_id: input.locationId,
      delivery_mode: input.deliveryMode,
      vehicle_no: input.vehicleNo,
      driver_mobile: input.driverMobile,
      challan_no: input.challanNo,
      challan_date: input.challanDate || null,
      remarks: input.remarks,
      created_by: me?.id ?? null,
    })
    .select('id, entry_no')
    .single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not save the entry.' }

  const { error: lErr } = await sb.from('wh_gate_in_lines').insert(
    lines.map(l => ({
      gate_in_id: header.id,
      item_id: l.itemId,
      po_line_id: l.poLineId ?? null,
      challan_qty: l.challanQty,
      received_qty: l.receivedQty,
      damaged_qty: l.damagedQty,
      rate: l.rate,
      rate_source: l.rateSource,
    })),
  )
  if (lErr) {
    // Never leave a numbered header with no lines — that reads as a suppressed
    // entry on the gap report.
    await sb.from('wh_gate_in').delete().eq('id', header.id)
    return { ok: false, error: lErr.message }
  }

  const stockErr = await applyStock(header.id, input.locationId, lines, me?.id ?? null)
  if (stockErr) return { ok: false, error: stockErr }

  await refreshPoStatus(input.poId)

  revalidatePath('/warehouse')
  revalidatePath('/warehouse/in')
  return { ok: true, entryNo: header.entry_no }
}

/** Ledger + stock. Only GOOD quantity joins usable stock; damaged is tracked
 *  separately so broken material is never counted as good. (#10) */
async function applyStock(
  gateInId: string,
  locationId: string,
  lines: GateInInput['lines'],
  actorId: string | null,
): Promise<string | null> {
  const sb = await createClient()

  const movements = lines.flatMap(l => {
    const good = l.receivedQty - l.damagedQty
    const rows: Array<Record<string, unknown>> = []
    if (good > 0) {
      rows.push({
        item_id: l.itemId, location_id: locationId, kind: 'in', qty: good,
        rate: l.rate, ref_table: 'wh_gate_in', ref_id: gateInId, actor_id: actorId,
      })
    }
    if (l.damagedQty > 0) {
      rows.push({
        item_id: l.itemId, location_id: locationId, kind: 'damage', qty: l.damagedQty,
        rate: l.rate, ref_table: 'wh_gate_in', ref_id: gateInId, actor_id: actorId,
        remarks: 'Damaged on arrival',
      })
    }
    return rows
  })
  if (movements.length > 0) {
    const { error } = await sb.from('wh_movements').insert(movements)
    if (error) return `Entry saved but the stock ledger failed: ${error.message}`
  }

  // Read-modify-write per item. Fine at gate volumes (a truck is a handful of
  // lines) and it keeps the running total honest without a trigger.
  for (const l of lines) {
    const good = l.receivedQty - l.damagedQty
    const { data: existing } = await sb
      .from('wh_stock')
      .select('id, qty, damaged_qty')
      .eq('item_id', l.itemId)
      .eq('location_id', locationId)
      .maybeSingle()

    if (existing) {
      const { error } = await sb.from('wh_stock').update({
        qty: Number(existing.qty) + good,
        damaged_qty: Number(existing.damaged_qty) + l.damagedQty,
        last_moved_at: new Date().toISOString(),
      }).eq('id', existing.id)
      if (error) return `Stock update failed for one item: ${error.message}`
    } else {
      const { error } = await sb.from('wh_stock').insert({
        item_id: l.itemId, location_id: locationId,
        qty: good, damaged_qty: l.damagedQty, last_moved_at: new Date().toISOString(),
      })
      if (error) return `Stock create failed for one item: ${error.message}`
    }

    // Remember the rate so a later no-PO entry can offer "last rate" instead of
    // someone inventing a number. (#4)
    if (l.rate && l.rate > 0) {
      await sb.from('wh_items').update({ last_rate: l.rate }).eq('id', l.itemId)
    }
  }
  return null
}

/** Open → Partly received → Fully received, from the actual balances. (#21) */
async function refreshPoStatus(poId: string | null): Promise<void> {
  if (!poId) return
  const sb = await createClient()
  const { data: poLines } = await sb
    .from('wh_po_lines')
    .select('id, ordered_qty')
    .eq('po_id', poId)
  if (!poLines || poLines.length === 0) return

  const { data: got } = await sb
    .from('wh_gate_in_lines')
    .select('po_line_id, received_qty')
    .in('po_line_id', poLines.map(l => l.id))

  const received = new Map<string, number>()
  for (const g of got ?? []) {
    if (!g.po_line_id) continue
    received.set(g.po_line_id, (received.get(g.po_line_id) ?? 0) + Number(g.received_qty))
  }
  const anyReceived = [...received.values()].some(v => v > 0)
  const allDone = poLines.every(l => (received.get(l.id) ?? 0) >= Number(l.ordered_qty))

  // Never overwrite a short_close: that was a deliberate decision by the Atm
  // Head, and a late delivery should not silently reopen the PO.
  const { data: current } = await sb.from('wh_po').select('status').eq('id', poId).maybeSingle()
  if (current?.status === 'short_closed') return

  await sb.from('wh_po')
    .update({ status: allDone ? 'fully_received' : anyReceived ? 'partly_received' : 'open' })
    .eq('id', poId)
}
