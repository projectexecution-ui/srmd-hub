'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { getLocationTree, getPostableSpots, getCount, getSettings, getPoBalance, one } from '@/lib/warehouse/data'
import { settingDef, periodLockBlocker, isOn } from '@/lib/warehouse/settings'
import { gate, settingsBlocker } from '@/lib/warehouse/guards'
import { todayIST } from '@/lib/warehouse/ledger'
import { in4Key, planIn4Items, FALLBACK_UOM } from '@/lib/warehouse/in4-items'
import { runIn4Sync } from '@/lib/warehouse/in4-sync-apply'
import type { SyncGroup } from '@/lib/warehouse/in4-sync'
import { buildSheet, submitBlocker, adjustments } from '@/lib/warehouse/count'
import type { GateInInput } from '@/lib/warehouse/types'
import type { In4ItemSpec } from '@/lib/warehouse/in4-items'
import type { CountScope, SheetSource } from '@/lib/warehouse/count'

/** The balance of ONE purchase order, fetched when the keeper picks it.
 *
 *  Not sent with the page: 1,223 open POs carrying 4,067 lines is half a
 *  megabyte of JSON for a dropdown, and the query that computed every balance at
 *  once needed a 150,000-character URL that PostgREST rejects. */
export async function loadPoBalance(poId: string) {
  const denied = await gate('edit')
  if (denied) return { ok: false as const, error: denied }
  if (!poId) return { ok: true as const, po: null }
  const { po, error } = await getPoBalance(poId)
  if (error) return { ok: false as const, error }
  return { ok: true as const, po }
}

export type SaveResult = { ok: true; entryNo: string } | { ok: false; error: string }
export type PoResult =
  | { ok: true; poNo: string; lines: number; itemsCreated: number; skipped: number }
  | { ok: false; error: string }

/** Import a PO exactly as IN4 has it.
 *
 *  No mapping and no confirmation: IN4's material name IS the item. If we have
 *  never received that material before, the item is created here carrying IN4's
 *  own name and UOM; if we have, the same name resolves to the same item. What
 *  actually turns up at the gate is a different question, and it is answered at
 *  the gate by the person looking at the truck. */
export async function savePo(input: {
  poNo: string
  poDate: string | null
  vendor: string | null
  entity: string | null
  projectId: string | null
  indentNo: string | null
  source: 'manual' | 'tracker'
  lines: Array<{
    /** IN4's material name — the item's identity. */
    material: string
    uom: string | null
    orderedQty: number
    rate: number | null
    discipline: string | null
  }>
}): Promise<PoResult> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const poNo = input.poNo.trim()
  if (!poNo) return { ok: false, error: 'A PO number is needed.' }

  const usable = input.lines.filter(l => l.material?.trim() && l.orderedQty > 0)
  const skipped = input.lines.length - usable.length
  if (usable.length === 0) {
    return {
      ok: false,
      error: 'Nothing on this PO can be imported — every line is missing either a material name or an ordered quantity in IN4.',
    }
  }

  const sb = await createClient()
  const me = await getMyUser()

  const { data: dupe } = await sb.from('wh_po').select('id').eq('po_no', poNo).maybeSingle()
  if (dupe) return { ok: false, error: `${poNo} is already in Warehouse V2. Open it to see its lines.` }

  // One item per distinct IN4 name; the tracker repeats a material once per
  // indent, so the quantities add up onto one line.
  const plan = planIn4Items(usable)
  const totals = new Map<string, { orderedQty: number; rate: number | null }>()
  for (const l of usable) {
    const key = in4Key(l.material)
    if (!key) continue
    const cur = totals.get(key)
    if (cur) {
      cur.orderedQty += l.orderedQty
      if (!cur.rate && l.rate) cur.rate = l.rate
      continue
    }
    totals.set(key, { orderedQty: l.orderedQty, rate: l.rate })
  }

  const items = await ensureIn4Items(plan.wanted, me?.id ?? null)
  if (!items.ok) return { ok: false, error: items.error }

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

  const rows = [...totals.entries()].flatMap(([key, t]) => {
    const itemId = items.byKey.get(key)
    if (!itemId) return []
    return [{
      po_id: po.id,
      item_id: itemId,
      ordered_qty: t.orderedQty,
      rate: t.rate,
      // IN4's own words, kept on the line so the gate can show the keeper
      // exactly what was ordered rather than a tidied-up version of it.
      source_text: plan.wanted.get(key)?.name ?? null,
    }]
  })

  const { error: lErr } = await sb.from('wh_po_lines').insert(rows)
  if (lErr) {
    await sb.from('wh_po').delete().eq('id', po.id)   // never leave a PO with no lines
    return { ok: false, error: lErr.message }
  }

  revalidatePath('/warehouse/po')
  revalidatePath('/warehouse/in')
  return { ok: true, poNo: po.po_no, lines: rows.length, itemsCreated: items.created, skipped }
}

/** Find or create one item per IN4 material name.
 *
 *  Creating rather than matching is the whole point: an item we have never
 *  received before is not a problem to be solved by guessing, it is simply a new
 *  item. The unit comes from IN4's UOM and is LOCKED to the item afterwards
 *  (#11) — if IN4 later sends a different UOM for the same name we keep ours and
 *  the difference is reported, because changing a live item's unit would
 *  re-scale its whole stock history. */
async function ensureIn4Items(
  wanted: Map<string, In4ItemSpec>,
  actorId: string | null,
): Promise<{ ok: true; byKey: Map<string, string>; created: number } | { ok: false; error: string }> {
  const sb = await createClient()
  const byKey = new Map<string, string>()

  const { data: existing, error } = await sb
    .from('wh_items')
    .select('id, in4_name, unit')
    .not('in4_name', 'is', null)
    .is('deleted_at', null)
  if (error) return { ok: false, error: `Could not read the item list: ${error.message}` }

  for (const row of existing ?? []) {
    if (row.in4_name) byKey.set(in4Key(row.in4_name), row.id)
  }

  const toCreate = [...wanted.entries()].filter(([key]) => !byKey.has(key))
  if (toCreate.length === 0) return { ok: true, byKey, created: 0 }

  const { data: made, error: cErr } = await sb
    .from('wh_items')
    .insert(toCreate.map(([, spec]) => ({
      name: spec.name,
      // wh_items.unit is NOT NULL and locked to the item, so a missing UOM
      // cannot be left blank — it is defaulted and shows on the import summary.
      unit: spec.uom ?? FALLBACK_UOM,
      discipline: spec.discipline,
      source: 'in4',
      in4_name: spec.name,
      in4_uom: spec.uom,
      created_by: actorId,
    })))
    .select('id, in4_name')
  if (cErr) return { ok: false, error: `Could not add the items IN4 named: ${cErr.message}` }

  for (const row of made ?? []) {
    if (row.in4_name) byKey.set(in4Key(row.in4_name), row.id)
  }
  return { ok: true, byKey, created: made?.length ?? 0 }
}

/** Add an item on the spot.
 *
 *  Needed at the gate: when what arrived is not what the PO says, the right item
 *  may not exist anywhere yet — and a keeper who cannot record the truck in
 *  front of him will write it on paper instead. Created as a plain manual item,
 *  never as an IN4 one, because IN4 did not name it. */
export async function createItem(input: {
  name: string
  unit: string
  discipline?: string | null
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }

  const name = input.name.trim()
  const unit = input.unit.trim()
  if (!name) return { ok: false, error: 'Give the item a name.' }
  if (!unit) return { ok: false, error: 'Give the unit it is counted in — it is locked to the item afterwards.' }

  const sb = await createClient()
  const me = await getMyUser()

  // Same name already on the books? Reuse it rather than making a twin: two
  // items with the same name split that material's stock in half for ever.
  const { data: existing } = await sb
    .from('wh_items')
    .select('id, name')
    .ilike('name', name)
    .is('deleted_at', null)
    .limit(1)
  if (existing && existing.length > 0) return { ok: true, id: existing[0].id, name: existing[0].name }

  const { data, error } = await sb
    .from('wh_items')
    .insert({ name, unit, discipline: input.discipline ?? null, source: 'manual', created_by: me?.id ?? null })
    .select('id, name')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add the item.' }

  revalidatePath('/warehouse/in')
  return { ok: true, id: data.id, name: data.name }
}

export type GateOutInput = {
  destType: 'site' | 'store' | 'vendor'
  fromLocationId: string
  toLocationId: string | null
  projectId: string | null
  /** Who it went back to, for a vendor return. */
  party: string | null
  entity: string | null
  engineerId: string | null
  isReturnable: boolean
  returnDueDate: string | null
  vehicleNo: string | null
  remarks: string | null
  lines: Array<{ itemId: string; qty: number; rate: number | null }>
}

/** Record material leaving a store — consumed at a site, moved to another
 *  store, or handed back to the vendor who brought it. One action, because on
 *  screen all three look identical; what differs is the consequence. A site
 *  issue reduces total stock and charges a project; a move only relocates and
 *  charges nothing; a vendor return takes his own material off our books
 *  without charging anyone. The database CHECK on wh_gate_out enforces the
 *  shape; this enforces the stock effect. (#8) */
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
  if (input.destType === 'vendor' && !input.party?.trim()) {
    return { ok: false, error: 'Say who it is going back to — the name is what matches it to the material he brought in.' }
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

  // Both ends of a move matter: putting stock INTO a store that is being
  // counted moves the number under the counter's feet just as much.
  for (const loc of [input.fromLocationId, input.destType === 'store' ? input.toLocationId : null]) {
    const blocked = await settingsBlocker(todayIST(), loc)
    if (blocked) return { ok: false, error: blocked }
  }

  // A store move gets its own series because it never leaves the campus.
  // Everything that actually goes out of the gate — a site issue or a vendor
  // taking his material back — belongs in the one OUT sequence. (#1)
  const register = input.destType === 'store' ? 'move' : 'out'
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
      project_id: input.destType === 'store' ? null : input.projectId,
      party: input.destType === 'vendor' ? input.party!.trim() : null,
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
 *  makes moves safe to allow at all. A vendor return also takes stock away, but
 *  under its own ledger kind so it never reads as site consumption. */
async function applyOutStock(
  outId: string,
  input: GateOutInput,
  lines: GateOutInput['lines'],
  actorId: string | null,
): Promise<string | null> {
  const sb = await createClient()
  const toStore = input.destType === 'store' && input.toLocationId
  const outKind = input.destType === 'vendor' ? 'vendor_out' : 'issue'

  const movements = lines.flatMap(l => {
    const base = { item_id: l.itemId, qty: l.qty, rate: l.rate, ref_table: 'wh_gate_out', ref_id: outId, actor_id: actorId }
    return toStore
      ? [{ ...base, location_id: input.fromLocationId, kind: 'move_out' },
         { ...base, location_id: input.toLocationId!, kind: 'move_in' }]
      : [{ ...base, location_id: input.fromLocationId, kind: outKind }]
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

  // The lock applies: an approved count corrects stock, so it must not be able
  // to reach back into a closed month. The freeze does not — a count IS the
  // freeze, and "one open count per store" below is what stops two at once.
  const lockErr = periodLockBlocker(await getSettings(), todayIST())
  if (lockErr) return { ok: false, error: lockErr }

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
  const values = await getSettings()
  const needWitness = isOn(values, 'wh_count_requires_witness')
  const blocker = submitBlocker(lines, needWitness ? count.witness_id : 'not-required')
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
  const values = await getSettings()
  // The database CHECK also refuses an approved count with no witness, so this
  // setting being off has to relax the constraint too — see the migration.
  if (isOn(values, 'wh_count_requires_witness') && !count.witness_id) {
    return { ok: false, error: 'This count has no witness recorded, so it cannot be approved. Reject it and count again with a witness.' }
  }
  const lockErr = periodLockBlocker(values, todayIST())
  if (lockErr) return { ok: false, error: lockErr }

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

// ===========================================================================
// Settings (S8). Every change is recorded — who, when, and what it was before —
// so a switch can never be quietly turned off.
// ===========================================================================

export async function saveSetting(
  key: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }

  const def = settingDef(key)
  if (!def) return { ok: false, error: 'That is not a setting this module has.' }
  if (def.kind === 'toggle' && value !== 'true' && value !== 'false') {
    return { ok: false, error: 'A switch is either on or off.' }
  }
  if (def.kind === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: 'Give a real date, or clear it.' }
  }

  const sb = await createClient()
  const me = await getMyUser()

  const { data: before } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  const oldValue = before?.value ?? null
  if (oldValue === value) return { ok: true }          // nothing to record

  const { error } = await sb
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }

  // Written after the change lands, so the history can never claim a change
  // that did not happen.
  const { error: logErr } = await sb.from('wh_setting_changes').insert({
    key, old_value: oldValue, new_value: value, actor_id: me?.id ?? null,
  })
  if (logErr) {
    return {
      ok: false,
      error: `The setting was changed but it could not be recorded in the history: ${logErr.message}. Tell your admin.`,
    }
  }

  // A setting can change what any screen in the module shows or refuses.
  revalidatePath('/warehouse', 'layout')
  return { ok: true }
}

/** Add a value to one of the admin's own lists (units, categories, and so on). */
export async function addListValue(
  kind: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }
  const v = value.trim()
  if (!v) return { ok: false, error: 'Type the value first.' }

  const sb = await createClient()
  const { error } = await sb.from('wh_lists').insert({ kind, value: v })
  if (error) {
    return {
      ok: false,
      error: error.code === '23505' || /duplicate/i.test(error.message)
        ? `“${v}” is already on that list.`
        : error.message,
    }
  }
  revalidatePath('/warehouse/settings')
  return { ok: true }
}

/** Take a value off a list without deleting history.
 *
 *  Deactivated rather than removed: entries already recorded against it must
 *  keep reading correctly, and a unit is locked to its items for ever. */
export async function setListValueActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }

  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_lists').update({ is_active: isActive }).eq('id', id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'That list value no longer exists.' }
  revalidatePath('/warehouse/settings')
  return { ok: true }
}

/** Who may post entries in a store. Roles say WHAT a person may do; this says
 *  WHERE, which the module-wide role matrix cannot express. */
export async function setStoreKeeper(
  locationId: string,
  keeperId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const denied = await gate('admin')
  if (denied) return { ok: false, error: denied }

  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_locations').update({ keeper_id: keeperId }).eq('id', locationId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'That store no longer exists.' }
  revalidatePath('/warehouse/settings')
  revalidatePath('/warehouse', 'layout')
  return { ok: true }
}

// ===========================================================================
// Syncing the masters from the daily IN4 uploads (items, units, trades, POs).
// The preview is the safety: this only ever runs on groups the admin ticked
// after seeing exactly what would come across.
// ===========================================================================

export type { SyncOutcome } from '@/lib/warehouse/in4-sync-apply'

/** Bring the chosen groups across from the IN4 uploads.
 *
 *  The preview screen is the safety: this only runs on what an admin ticked
 *  after seeing exactly what would happen. The writing itself lives in
 *  runIn4Sync so the automatic run on upload uses the identical code path. */
export async function applyIn4Sync(groups: SyncGroup[]) {
  const denied = await gate('admin')
  if (denied) return { ok: false as const, error: denied }
  if (groups.length === 0) return { ok: false as const, error: 'Tick at least one thing to bring across.' }

  const me = await getMyUser()
  const res = await runIn4Sync(groups, me?.id ?? null)
  if (res.ok) revalidatePath('/warehouse', 'layout')
  return res
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
  // With a PO or without one. The photograph of the signed, stamped bill is the
  // only independent record that this handover happened, and it is what a
  // shortage gets argued from months later.
  if ((input.photoUrls?.length ?? 0) === 0) {
    return {
      ok: false,
      error: 'Photograph the bill before saving. It must carry the receiver’s signature and stamp, '
        + 'and the delivery person’s signature — that photo is the only proof of the handover we keep.',
    }
  }
  for (const l of lines) {
    if (l.damagedQty > l.receivedQty) {
      return { ok: false, error: 'Damaged quantity cannot be more than what was received.' }
    }
    // A flagged difference with no explanation is just noise on a report — the
    // DB refuses it too, but this says why in a sentence.
    if (l.differsFromPo && !l.differNote?.trim()) {
      return {
        ok: false,
        error: 'You have marked an item as not what the PO says. Add a short note on what actually came, '
          + 'so procurement can fix it in IN4 and against the bill.',
      }
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

  const blocked = await settingsBlocker(todayIST(), input.locationId)
  if (blocked) return { ok: false, error: blocked }

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
      // Pages of the supplier's bill, already uploaded to the private bucket.
      photo_urls: input.photoUrls ?? [],
      created_by: me?.id ?? null,
    })
    .select('id, entry_no')
    .single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not save the entry.' }

  const { error: lErr } = await sb.from('wh_gate_in_lines').insert(
    lines.map(l => ({
      gate_in_id: header.id,
      item_id: l.itemId,
      // The PO line stays attached even when the item differs: the truck DID
      // come against that order, so its balance must still come down. The flag
      // is what tells procurement and billing to reconcile the difference.
      po_line_id: l.poLineId ?? null,
      challan_qty: l.challanQty,
      received_qty: l.receivedQty,
      damaged_qty: l.damagedQty,
      rate: l.rate,
      rate_source: l.rateSource,
      differs_from_po: l.differsFromPo ?? false,
      differ_note: l.differsFromPo ? l.differNote!.trim() : null,
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
    .select('po_line_id, received_qty, entry:wh_gate_in(deleted_at)')
    .in('po_line_id', poLines.map(l => l.id))

  const received = new Map<string, number>()
  for (const g of got ?? []) {
    if (!g.po_line_id) continue
    // Voided entries do not count towards the order. Without this a void would
    // leave the PO showing "fully received" against material that never came.
    if (one(g.entry)?.deleted_at) continue
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
