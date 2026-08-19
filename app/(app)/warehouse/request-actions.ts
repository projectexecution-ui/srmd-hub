'use server'

/** Raising, approving, rejecting and cancelling a material request.
 *
 *  Issuing against one lives in actions.ts with the rest of Gate OUT — a
 *  request does not get its own issue path, because two ways to move stock is
 *  how V1 ended up with a chain nobody trusted. */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { one, getSettings } from '@/lib/warehouse/data'
import { gate } from '@/lib/warehouse/guards'
import { todayIST } from '@/lib/warehouse/ledger'
import { isOn } from '@/lib/warehouse/settings'
import { raiseBlocker, estimateValue, shortfalls } from '@/lib/warehouse/requests'
import type { RaiseInput, ShortLine } from '@/lib/warehouse/requests'
import { movesFor, needsApproval, personBlocker } from '@/lib/warehouse/approval-matrix'
import { getApprovalRules, myWarehouseRole } from '@/lib/warehouse/request-data'

type Result = { ok: boolean; error?: string }
type Raised = { ok: true; reqNo: string; id: string; waiting: boolean } | { ok: false; error: string }

const PATHS = ['/warehouse', '/warehouse/requests', '/warehouse/out']
function refresh(...extra: string[]) {
  for (const p of [...PATHS, ...extra]) revalidatePath(p)
}

/** The feature switch, checked in one place. A request raised while the feature
 *  is off would sit in a queue nobody opens. */
async function requestsEnabled(): Promise<string | null> {
  const values = await getSettings()
  return isOn(values, 'wh_requests_on')
    ? null
    : 'Requests are switched off for this warehouse. An admin turns them on in Warehouse ▸ Settings ▸ The rules.'
}

// ===========================================================================
// Raising
// ===========================================================================

export async function raiseRequest(input: RaiseInput): Promise<Raised> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  const off = await requestsEnabled()
  if (off) return { ok: false, error: off }

  const refusal = raiseBlocker(input, todayIST())
  if (refusal) return { ok: false, error: refusal }

  const sb = await createClient()
  const me = await getMyUser()
  const lines = input.lines.filter(l => l.itemId && l.qty > 0)

  // Price the request from what each item last cost, so the value rule has
  // something to compare against.
  const { data: items, error: iErr } = await sb.from('wh_items')
    .select('id, last_rate').in('id', lines.map(l => l.itemId))
  if (iErr) return { ok: false, error: iErr.message }
  const rates = new Map((items ?? []).map(i => [i.id, i.last_rate == null ? null : Number(i.last_rate)]))

  const priced = lines.map(l => ({ qty: l.qty, lastRate: rates.get(l.itemId) ?? null }))
  const est = estimateValue(priced)
  const anyPriced = priced.some(l => l.lastRate != null)

  // The MATRIX decides whether this needs approving — the same rules Aksha
  // edits at /admin/approvals, shared with every other module. What is frozen
  // onto the request is only est_value, the number the caps compare against,
  // because that is data about the request rather than configuration.
  const { rules } = await getApprovalRules()
  const needsIt = needsApproval(rules, 'pending')
    // An unpriced request cannot be shown to be under anybody's cap, so it goes
    // through approval rather than around it.
    || (!anyPriced && rules.some(r => r.fromStage === 'pending' && r.amountCapMax != null))

  const { data: reqNo, error: nErr } = await sb.rpc('fn_wh_next_no', { p_register: 'req' })
  if (nErr || !reqNo) return { ok: false, error: nErr?.message ?? 'Could not allocate a request number.' }

  const { data: header, error: hErr } = await sb.from('wh_requests').insert({
    req_no: reqNo,
    from_location_id: input.fromLocationId,
    to_location_id: input.toLocationId,
    project_id: input.projectId,
    purpose: input.purpose.trim(),
    need_by: input.needBy || null,
    requested_by: me?.id ?? null,
    // No approval needed means it is already the storekeeper's to act on.
    status: needsIt ? 'pending' : 'approved',
    rule_at_raise: needsIt ? 'matrix' : 'none',
    est_value: anyPriced ? est.value : null,
    stages_needed: needsIt ? 1 : 0,
    stages_done: 0,
  }).select('id, req_no').single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not save the request.' }

  const { error: lErr } = await sb.from('wh_request_lines').insert(
    lines.map(l => ({
      request_id: header.id, item_id: l.itemId, qty: l.qty,
      note: l.note?.trim() || null,
      is_returnable: l.isReturnable ?? false,
    })),
  )
  if (lErr) {
    // Never leave a numbered request with nothing on it.
    await sb.from('wh_requests').delete().eq('id', header.id)
    return { ok: false, error: lErr.message }
  }

  refresh()
  return { ok: true, reqNo: header.req_no, id: header.id, waiting: needsIt }
}

/** What the store actually has, for the shortfall warning shown while typing.
 *  Deliberately advisory: asking for material a store has not got is how the
 *  store learns to order it. */
export async function checkStock(
  locationId: string,
  lines: Array<{ itemId: string; qty: number }>,
): Promise<ShortLine[]> {
  const denied = await gate('view')
  if (denied || !locationId) return []
  const wanted = lines.filter(l => l.itemId && l.qty > 0)
  if (wanted.length === 0) return []

  const sb = await createClient()
  const { data } = await sb.from('wh_stock')
    .select('item_id, qty, wh_items(name, unit)')
    .eq('location_id', locationId)
    .in('item_id', wanted.map(l => l.itemId))

  const onHand = new Map<string, { qty: number; itemName: string; unit: string }>()
  for (const r of data ?? []) {
    onHand.set(r.item_id, {
      qty: Number(r.qty),
      itemName: one(r.wh_items)?.name ?? 'that item',
      unit: one(r.wh_items)?.unit ?? '',
    })
  }
  return shortfalls(wanted, onHand)
}

// ===========================================================================
// Approving, rejecting, cancelling
// ===========================================================================

/** Move a request to the next stage the matrix allows.
 *
 *  Replaces the separate approve/reject actions. Which stages exist, who may
 *  reach them, up to what value, and whether a remark is compulsory are all
 *  ROWS Aksha edits — so a new stage or a new approver role needs no code here.
 *
 *  Two things are still checked in code because no row could express them: the
 *  requester may not approve his own request, and one person may not fill two
 *  stages. Those are facts about a person, not about a role. */
export async function moveRequest(
  id: string,
  toStage: string,
  remarks: string,
): Promise<Result> {
  // Deliberately 'view', not 'edit'. Who may make a transition is decided by the
  // approval matrix and enforced again by the database trigger; requiring edit
  // on top of that locked out the Trustee named as the second approver, who has
  // view-only on this module by design.
  const denied = await gate('view')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()
  const me = await getMyUser()

  const { data: r, error } = await sb.from('wh_requests')
    .select(`req_no, status, requested_by, est_value, stages_done,
             approved1_by, approved2_by, deleted_at`)
    .eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!r || r.deleted_at) return { ok: false, error: 'That request no longer exists.' }

  const [{ rules }, role] = await Promise.all([getApprovalRules(), myWarehouseRole()])
  const amount = r.est_value == null ? null : Number(r.est_value)
  const allowed = movesFor(rules, r.status, role, amount)
  const move = allowed.find(m => m.toStage === toStage)

  if (!move) {
    // Say WHY rather than "not authorised". The reader needs to know whether it
    // is the stage, the role, or the value that stopped them.
    const anyRule = rules.some(x => x.fromStage === r.status && x.toStage === toStage)
    if (!anyRule) {
      return {
        ok: false,
        error: `Nothing is configured to move a request from "${r.status}" to "${toStage}". `
          + 'An admin sets the chain in Admin ▸ Approvals.',
      }
    }
    const capped = rules.find(x =>
      x.fromStage === r.status && x.toStage === toStage
      && x.amountCapMax != null && amount != null && amount > x.amountCapMax)
    if (capped) {
      return {
        ok: false,
        error: `${r.req_no} is worth about ${amount} — over the ${capped.amountCapMax} limit for that `
          + 'approval. It needs the next stage in the chain instead.',
      }
    }
    return { ok: false, error: `Your role cannot move ${r.req_no} to that stage.` }
  }

  const personal = personBlocker(
    me?.id ?? null, r.requested_by,
    [r.approved1_by, r.approved2_by].filter(Boolean) as string[],
  )
  if (personal) return { ok: false, error: personal }

  if (move.needsRemarks && remarks.trim().length < 6) {
    return {
      ok: false,
      error: 'A remark is compulsory for this step — an admin set that in Approvals. '
        + 'A decision the requester cannot act on just gets raised again tomorrow.',
    }
  }

  const stamp = new Date().toISOString()
  const stage = Number(r.stages_done ?? 0) + 1
  const patch: Record<string, unknown> = { status: toStage }

  if (toStage === 'rejected') {
    Object.assign(patch, {
      rejected_by: me?.id ?? null, rejected_at: stamp, reject_reason: remarks.trim(),
    })
  } else {
    // Every non-rejection hop counts as an approval and is stamped, so the trail
    // shows who moved it and when however long the chain is.
    Object.assign(patch, {
      stages_done: Math.min(stage, 2),
      ...(stage === 1
        ? { approved1_by: me?.id ?? null, approved1_at: stamp }
        : { approved2_by: me?.id ?? null, approved2_at: stamp }),
    })
    if (remarks.trim()) patch.remarks = remarks.trim()
  }

  // Guarded on the stage we read, so two approvers pressing at the same moment
  // cannot both count. The DB trigger enforces authority a second time.
  const { data: done, error: uErr } = await sb.from('wh_requests')
    .update(patch).eq('id', id).eq('status', r.status).select('id')
  if (uErr) return { ok: false, error: uErr.message }
  if (!done?.length) {
    return { ok: false, error: `${r.req_no} moved on while you were looking at it. Open it again.` }
  }

  refresh(`/warehouse/requests/${id}`)
  return { ok: true }
}

/** The requester withdrawing his own ask, or an admin clearing the queue.
 *  Not the same as a rejection: nobody refused it. */
export async function cancelRequest(id: string): Promise<Result> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  const sb = await createClient()
  const [me, perms] = await Promise.all([getMyUser(), getMyPermissions()])

  const { data: r, error } = await sb.from('wh_requests')
    .select('req_no, status, requested_by').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!r) return { ok: false, error: 'That request no longer exists.' }

  const mine = r.requested_by && me?.id && r.requested_by === me.id
  if (!mine && !can(perms, 'warehouse', 'admin')) {
    return { ok: false, error: 'Only the person who raised it, or an admin, can cancel a request.' }
  }
  if (r.status === 'issued' || r.status === 'part_issued') {
    return {
      ok: false,
      error: `Material has already gone out against ${r.req_no}, so it cannot be cancelled. `
        + 'Leave it as it stands, or void the issue entry if that was the mistake.',
    }
  }
  if (r.status === 'cancelled') return { ok: false, error: `${r.req_no} is already cancelled.` }

  const { error: uErr } = await sb.from('wh_requests').update({
    status: 'cancelled',
    cancelled_by: me?.id ?? null,
    cancelled_at: new Date().toISOString(),
  }).eq('id', id)
  if (uErr) return { ok: false, error: uErr.message }

  refresh(`/warehouse/requests/${id}`)
  return { ok: true }
}

/** What one store holds, for the item picker's "In this store" tab.
 *
 *  Quantities only, no rates — the picker is shown to whoever is raising a
 *  request, and that includes roles the value-hiding rule covers. */
export async function storeStock(
  locationId: string,
): Promise<Array<{ itemId: string; qty: number }>> {
  const denied = await gate('view')
  if (denied || !locationId) return []
  const sb = await createClient()
  const { data } = await sb.from('wh_stock')
    .select('item_id, qty').eq('location_id', locationId).gt('qty', 0)
  return (data ?? []).map(r => ({ itemId: r.item_id, qty: Number(r.qty) }))
}

/** Material the catalogue has never heard of, added while raising a request.
 *
 *  Created immediately rather than queued for an admin: an engineer standing on
 *  site who needs a thing the master does not list should not be stopped, and
 *  the Item Master's merge tool is what tidies a duplicate afterwards. Stamped
 *  with created_via so a stray name can be traced back to where it came from. */
export async function addCatalogueItem(
  name: string,
  unit: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const denied = await gate('edit')
  if (denied) return { ok: false, error: denied }
  const off = await requestsEnabled()
  if (off) return { ok: false, error: off }

  const n = name.trim()
  const u = unit.trim()
  if (n.length < 2) return { ok: false, error: 'Give the item a name of at least two characters.' }
  if (!u) return { ok: false, error: 'Pick the unit it is counted in.' }

  const sb = await createClient()
  const me = await getMyUser()

  // Reuse rather than twin: two rows for one material split its stock in half,
  // and the engineer would never see the other one.
  const { data: existing } = await sb.from('wh_items')
    .select('id, name, unit').ilike('name', n).is('deleted_at', null).limit(1)
  if (existing?.length) {
    if (existing[0].unit !== u) {
      return {
        ok: false,
        error: `${existing[0].name} already exists, counted in ${existing[0].unit} rather than ${u}. `
          + 'Use it as it stands — the unit is locked once anything is recorded against an item.',
      }
    }
    return { ok: true, id: existing[0].id }
  }

  const { data, error } = await sb.from('wh_items').insert({
    name: n, unit: u, source: 'manual', created_via: 'request', created_by: me?.id ?? null,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/warehouse/items')
  return { ok: true, id: data.id }
}
