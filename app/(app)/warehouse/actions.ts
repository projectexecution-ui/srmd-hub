'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { getLocationTree, getPostableSpots } from '@/lib/warehouse/data'
import type { GateInInput } from '@/lib/warehouse/types'

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
