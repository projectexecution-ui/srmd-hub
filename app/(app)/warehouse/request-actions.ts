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
import { isOn, approvalConfig } from '@/lib/warehouse/settings'
import {
  raiseBlocker, estimateValue, stagesNeeded, shortfalls,
  approveBlocker, statusAfterApproval, rejectBlocker,
} from '@/lib/warehouse/requests'
import type { RaiseInput, RequestState, ShortLine } from '@/lib/warehouse/requests'

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

  // The dial is read ONCE and frozen onto the request. Changing the setting
  // later must not change what an in-flight request needs.
  const cfg = approvalConfig(await getSettings())
  const needed = stagesNeeded(cfg, est, anyPriced)

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
    status: needed === 0 ? 'approved' : 'pending',
    rule_at_raise: cfg.rule,
    est_value: anyPriced ? est.value : null,
    stages_needed: needed,
    stages_done: 0,
  }).select('id, req_no').single()
  if (hErr || !header) return { ok: false, error: hErr?.message ?? 'Could not save the request.' }

  const { error: lErr } = await sb.from('wh_request_lines').insert(
    lines.map(l => ({
      request_id: header.id, item_id: l.itemId, qty: l.qty, note: l.note?.trim() || null,
    })),
  )
  if (lErr) {
    // Never leave a numbered request with nothing on it.
    await sb.from('wh_requests').delete().eq('id', header.id)
    return { ok: false, error: lErr.message }
  }

  refresh()
  return { ok: true, reqNo: header.req_no, id: header.id, waiting: needed > 0 }
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

async function loadState(id: string): Promise<{ state: RequestState | null; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb.from('wh_requests')
    .select('req_no, status, stages_needed, stages_done, requested_by, approved1_by, approved2_by, deleted_at')
    .eq('id', id).maybeSingle()
  if (error) return { state: null, error: error.message }
  if (!data || data.deleted_at) return { state: null }
  return {
    state: {
      reqNo: data.req_no,
      status: data.status,
      stagesNeeded: data.stages_needed,
      stagesDone: data.stages_done,
      requestedBy: data.requested_by,
      approvers: [data.approved1_by, data.approved2_by].filter(Boolean),
    },
  }
}

export async function approveRequest(id: string): Promise<Result> {
  const sb = await createClient()
  const [me, perms] = await Promise.all([getMyUser(), getMyPermissions()])
  const canApprove = can(perms, 'warehouse', 'admin')

  const { state, error } = await loadState(id)
  if (error) return { ok: false, error }
  if (!state) return { ok: false, error: 'That request no longer exists.' }

  const refusal = approveBlocker(state, me?.id ?? null, canApprove)
  if (refusal) return { ok: false, error: refusal }

  const next = statusAfterApproval(state)
  const stage = state.stagesDone + 1
  const stamp = new Date().toISOString()

  const { error: uErr } = await sb.from('wh_requests').update({
    status: next,
    stages_done: stage,
    ...(stage === 1
      ? { approved1_by: me?.id ?? null, approved1_at: stamp }
      : { approved2_by: me?.id ?? null, approved2_at: stamp }),
  }).eq('id', id).eq('stages_done', state.stagesDone)   // optimistic: two heads pressing at once
  if (uErr) return { ok: false, error: uErr.message }

  refresh(`/warehouse/requests/${id}`)
  return { ok: true }
}

export async function rejectRequest(id: string, reason: string): Promise<Result> {
  const sb = await createClient()
  const [me, perms] = await Promise.all([getMyUser(), getMyPermissions()])
  const canApprove = can(perms, 'warehouse', 'admin')

  const { state, error } = await loadState(id)
  if (error) return { ok: false, error }
  if (!state) return { ok: false, error: 'That request no longer exists.' }

  const refusal = rejectBlocker(state, reason, canApprove)
  if (refusal) return { ok: false, error: refusal }

  const { error: uErr } = await sb.from('wh_requests').update({
    status: 'rejected',
    rejected_by: me?.id ?? null,
    rejected_at: new Date().toISOString(),
    reject_reason: reason.trim(),
  }).eq('id', id)
  if (uErr) return { ok: false, error: uErr.message }

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
