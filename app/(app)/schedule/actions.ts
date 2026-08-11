'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { DEFAULT_TEMPLATE, templateSequenceDefaults } from '@/lib/schedule/template'
import { progressFromFloors } from '@/lib/schedule/formula'
import { floorsSettingKey } from '@/lib/schedule/floors'
import { getScheduleFloors } from '@/lib/schedule/data'
import type { FloorStatus } from '@/lib/schedule/types'

/** The permissions-matrix gate. RLS only checks hardcoded ROLE names
 *  (sched_can_write/sched_can_build), so without this an admin revoking
 *  `schedule` edit at /admin/permissions — or blocking one user via
 *  user_module_blocks — changed nothing: the UI hid the buttons but every
 *  server action still ran. `admin` = the build-level actions (add/delete
 *  items, apply template) to mirror sched_can_build(). */
async function gate(action: 'edit' | 'admin' = 'edit'): Promise<string | null> {
  const perms = await getMyPermissions()
  if (!can(perms, 'schedule', action)) {
    return action === 'admin'
      ? 'You can update progress but not add or remove work items — ask a project head.'
      : 'You do not have permission to edit this schedule.'
  }
  return null
}

async function currentUid(): Promise<string | null> {
  const u = await getMyUser()
  return u?.id ?? null
}

export async function addSchedItem(input: {
  projectId: string
  trade: string
  name: string
  sub?: string | null
  planStart?: string | null
  planEnd?: string | null
  ownerUserId?: string | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate('admin'); if (denied) return { error: denied }
  const trade = input.trade.trim()
  const name = input.name.trim()
  if (!trade || !name) return { error: 'Trade and work name are required.' }

  const sb = await createClient()
  const me = await currentUid()
  const { data: maxRow } = await sb.from('sched_items')
    .select('seq').eq('project_id', input.projectId)
    .order('seq', { ascending: false }).limit(1).maybeSingle()
  const seq = ((maxRow?.seq as number | undefined) ?? 0) + 1

  const { error } = await sb.from('sched_items').insert({
    project_id: input.projectId,
    trade, name,
    sub: input.sub?.trim() || null,
    plan_start: input.planStart || null,
    plan_end: input.planEnd || null,
    owner_user_id: input.ownerUserId || null,
    seq,
    created_by: me,
  })
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Internal item patch. NOT exported: as a server action it was a reachable
 *  mass-assignment hole — caller-supplied `patch` with no column allowlist and
 *  filtered on `id` alone, so any signed-in user could rewrite pct/state/
 *  baseline/locked_at on ANY project's items. Now private and project-scoped;
 *  every caller goes through a purpose-built action that gates first. */
async function patchSchedItem(
  id: string,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<{ ok?: true; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb.from('sched_items')
    .update(patch).eq('id', id).eq('project_id', projectId).select('id')
  if (error) return { error: error.message }
  // PostgREST returns 200 + zero rows when an RLS USING clause filters the row
  // out, so a blocked write used to report success ("Deleted" with nothing gone).
  if (!data?.length) return { error: 'That change was not saved — you may not have permission for this project.' }
  revalidatePath(`/schedule/${projectId}`)
  return { ok: true }
}

/** Mark the WO issued (or clear it) — the hard fact. */
export async function setWoIssued(input: {
  id: string; projectId: string; issued: boolean; woNumber?: string | null; issuedOn?: string | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  return patchSchedItem(input.id, input.projectId, {
    wo_issued: input.issued,
    wo_number: input.issued ? (input.woNumber?.trim() || null) : null,
    wo_issued_on: input.issued ? (input.issuedOn || null) : null,
  })
}

/** Move a plan date freely and record the reason (NOT approval-gated). */
export async function moveSchedDate(input: {
  id: string; projectId: string; field: 'plan_start' | 'plan_end'
  from: string | null; to: string | null; reason?: string | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  const sb = await createClient()
  const me = await currentUid()
  const { data: moved, error } = await sb.from('sched_items')
    .update({ [input.field]: input.to || null }).eq('id', input.id).eq('project_id', input.projectId).select('id')
  if (error) return { error: error.message }
  if (!moved?.length) return { error: 'Date not saved — you may not have permission for this project.' }
  await sb.from('sched_date_changes').insert({
    item_id: input.id, field: input.field,
    from_date: input.from, to_date: input.to || null,
    reason: input.reason?.trim() || null, changed_by: me,
  })
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

export async function deleteSchedItem(id: string, projectId: string): Promise<{ ok?: true; warning?: string; error?: string }> {
  const denied = await gate('admin'); if (denied) return { error: denied }
  const sb = await createClient()
  // Warn about successors before the row goes: follows_item_id is ON DELETE SET
  // NULL, so anything chained behind this silently loses its derived dates.
  const { data: followers } = await sb.from('sched_items')
    .select('name').eq('project_id', projectId).eq('follows_item_id', id)
  const { data, error } = await sb.from('sched_items')
    .delete().eq('id', id).eq('project_id', projectId).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Not deleted — you may not have permission to remove work items.' }
  revalidatePath(`/schedule/${projectId}`)
  const names = ((followers ?? []) as Array<{ name: string }>).map(f => f.name)
  return names.length
    ? { ok: true, warning: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''} followed it — set their sequence again.` }
    : { ok: true }
}

/** Tick a weekly promise. Marking it done also sets that floor cell done (one
 *  source of truth); re-opening restores the cell to `prevCell` for Undo. */
export async function setPromiseStatus(input: {
  id: string; projectId: string; itemId: string; location: string
  status: 'open' | 'done' | 'not_done'
  prevCell?: FloorStatus | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  const sb = await createClient()
  const { error } = await sb.from('sched_promises').update({
    status: input.status,
    done_at: input.status === 'done' ? new Date().toISOString() : null,
  }).eq('id', input.id)
  if (error) return { error: error.message }

  if (input.status === 'done') {
    return setFloorStatus({ itemId: input.itemId, projectId: input.projectId, location: input.location, status: 'done' })
  }
  if (input.status === 'open' && input.prevCell) {
    return setFloorStatus({ itemId: input.itemId, projectId: input.projectId, location: input.location, status: input.prevCell })
  }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Add an item×floor promise to the current week (Plan Room). */
export async function addPromise(input: {
  projectId: string; itemId: string; location: string; weekStart: string; ownerName?: string | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  const sb = await createClient()
  const me = await currentUid()
  const { error } = await sb.from('sched_promises').insert({
    project_id: input.projectId, item_id: input.itemId, location: input.location,
    week_start: input.weekStart, owner_name: input.ownerName || null, created_by: me,
  })
  if (error) return { error: error.message.includes('duplicate') ? 'Already promised this week.' : error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Raise every pending Work Order for a whole trade at once (one WO really
 *  goes to one contractor per trade). Only touches not-yet-issued items. */
export async function bulkIssueWo(input: {
  projectId: string; itemIds: string[]; woNumber?: string | null; issuedOn: string
}): Promise<{ ok?: true; count?: number; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  if (!input.itemIds?.length) return { error: 'Nothing to raise.' }
  const sb = await createClient()
  // scoped to the EXACT items the button offered — not every un-issued item in
  // the trade (that swept up work scheduled a year out).
  const { data, error } = await sb.from('sched_items')
    .update({ wo_issued: true, wo_number: input.woNumber?.trim() || null, wo_issued_on: input.issuedOn })
    .eq('project_id', input.projectId).in('id', input.itemIds).eq('wo_issued', false)
    .select('id')
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true, count: (data ?? []).length }
}

/** Undo a bulk raise — clears ONLY the items that raise actually changed, so a
 *  WO raised separately (with its own number) is never wiped. */
export async function bulkClearWo(input: {
  projectId: string; itemIds: string[]
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  if (!input.itemIds?.length) return { ok: true }
  const sb = await createClient()
  const { error } = await sb.from('sched_items')
    .update({ wo_issued: false, wo_number: null, wo_issued_on: null })
    .eq('project_id', input.projectId).in('id', input.itemIds)
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Bulk-assign engineer / contractor / approver to many items at once — by
 *  trade (every item in it) or an explicit id list. Only the provided fields
 *  are written, so setting a contractor doesn't wipe the engineer. */
export async function bulkAssignSchedItems(input: {
  projectId: string
  trade?: string | null
  itemIds?: string[]
  ownerName?: string | null
  contractor?: string | null
  approverName?: string | null
}): Promise<{ ok?: true; count?: number; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  const patch: Record<string, unknown> = {}
  if (input.ownerName !== undefined) patch.owner_name = input.ownerName
  if (input.contractor !== undefined) patch.contractor = input.contractor
  if (input.approverName !== undefined) patch.approver_name = input.approverName
  if (!Object.keys(patch).length) return { error: 'Nothing to assign.' }

  const sb = await createClient()
  let q = sb.from('sched_items').update(patch).eq('project_id', input.projectId).select('id')
  if (input.itemIds?.length) q = q.in('id', input.itemIds)
  else if (input.trade) q = q.eq('trade', input.trade)
  else return { error: 'Choose a trade or items to assign.' }

  const { data, error } = await q
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true, count: (data ?? []).length }
}

/** Populate a project's schedule from the standard template. Skips items that
 *  already exist (by trade+name), so it's safe to run more than once. */
export async function applyTemplate(projectId: string): Promise<{ ok?: true; added?: number; error?: string }> {
  const denied = await gate('admin'); if (denied) return { error: denied }
  const sb = await createClient()
  const me = await currentUid()
  const { data: existing } = await sb.from('sched_items').select('trade, name, seq').eq('project_id', projectId)
  const have = new Set(((existing ?? []) as Array<{ trade: string; name: string }>)
    .map(r => `${r.trade.toLowerCase()}|${r.name.toLowerCase()}`))
  let seq = ((existing ?? []) as Array<{ seq: number }>).reduce((m, r) => Math.max(m, r.seq ?? 0), 0)

  const rows: Array<Record<string, unknown>> = []
  for (const g of DEFAULT_TEMPLATE) {
    for (const it of g.items) {
      if (have.has(`${g.trade.toLowerCase()}|${it.name.toLowerCase()}`)) continue
      seq += 1
      rows.push({
        project_id: projectId, trade: g.trade, name: it.name,
        sub: it.sub ?? null, uom: it.uom, seq, created_by: me,
        cycle_days: it.cycle ?? null, gap_days: it.gap ?? 0,
      })
    }
  }
  if (rows.length) {
    const { error } = await sb.from('sched_items').insert(rows)
    if (error) return { error: error.message }
  }

  // Second pass: wire the "follows" chain by name (needs all rows to exist).
  const { data: all } = await sb.from('sched_items')
    .select('id, trade, name, follows_item_id').eq('project_id', projectId)
  const byKey = new Map(((all ?? []) as Array<{ id: string; trade: string; name: string; follows_item_id: string | null }>)
    .map(r => [`${r.trade}|${r.name}`.toLowerCase(), r]))
  const defaults = templateSequenceDefaults()
  for (const [key, def] of defaults) {
    if (!def.follows) continue
    const row = byKey.get(key)
    const pred = byKey.get(`${def.follows[0]}|${def.follows[1]}`.toLowerCase())
    if (!row || !pred || row.follows_item_id) continue   // never overwrite a manual chain
    await sb.from('sched_items').update({ follows_item_id: pred.id }).eq('id', row.id)
  }

  revalidatePath(`/schedule/${projectId}`)
  return { ok: true, added: rows.length }
}

/** The one-sentence sequence editor: "starts after <item> + <gap> days,
 *  <cycle> days per floor". follows=null clears the chain (own dates). */
export async function setSequence(input: {
  id: string; projectId: string
  followsItemId: string | null; gapDays: number; cycleDays: number | null
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  if (input.followsItemId === input.id) return { error: 'An item cannot follow itself.' }
  const sb = await createClient()
  const { error } = await sb.from('sched_items').update({
    follows_item_id: input.followsItemId,
    gap_days: Math.max(0, Math.round(input.gapDays || 0)),
    cycle_days: input.cycleDays && input.cycleDays > 0 ? Math.round(input.cycleDays) : null,
  }).eq('id', input.id)
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Set an item×location floor status (upsert by hand — the unique is on lower(location)).
 *  One tap also re-syncs the item's overall % + state from the floor matrix, so the
 *  Board rings, Table fill and rollups all move from the same action. */
export async function setFloorStatus(input: {
  itemId: string; projectId: string; location: string; floorId?: string | null
  status: FloorStatus
}): Promise<{ ok?: true; error?: string }> {
  const denied = await gate(); if (denied) return { error: denied }
  const sb = await createClient()
  const me = await currentUid()
  const { data: existing } = await sb.from('sched_progress')
    .select('id').eq('item_id', input.itemId).ilike('location', input.location).maybeSingle()
  if (existing) {
    const { error } = await sb.from('sched_progress')
      .update({ status: input.status, updated_by: me, updated_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id)
    if (error) return { error: error.message }
  } else {
    const { error } = await sb.from('sched_progress').insert({
      item_id: input.itemId, location: input.location, floor_id: input.floorId || null,
      status: input.status, updated_by: me,
    })
    if (error) return { error: error.message }
  }

  // Re-derive the item's % across EVERY floor of the project — not just the
  // floors that happen to have a row. Cells are created lazily (one per tap), so
  // dividing by existing rows made the first tick read 100% "done".
  const { data: cells } = await sb.from('sched_progress')
    .select('location, status').eq('item_id', input.itemId)
  const have = new Map(((cells ?? []) as Array<{ location: string; status: FloorStatus }>)
    .map(c => [c.location.trim().toLowerCase(), c.status]))
  const { data: seeded } = await sb.from('project_floors')
    .select('name').eq('project_id', input.projectId).order('sequence')
  const floors = await getScheduleFloors(input.projectId, (seeded ?? []) as Array<{ name: string }>)
  const statuses = floors.map(f => have.get(f.trim().toLowerCase()) ?? 'not_started') as FloorStatus[]
  if (statuses.length) {
    const pct = progressFromFloors(statuses)
    const { data: cur } = await sb.from('sched_items').select('state').eq('id', input.itemId).maybeSingle()
    const state = (cur?.state as string) === 'on_hold'
      ? 'on_hold'
      : pct >= 100 ? 'done' : pct > 0 ? 'in_progress' : 'planned'
    await sb.from('sched_items').update({ pct, state }).eq('id', input.itemId)
  }

  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

/** Save the floor/location column list for a project's progress matrix. */
export async function setScheduleFloors(
  projectId: string, floors: string[],
): Promise<{ ok?: true; error?: string }> {
  const denied = await gate('admin'); if (denied) return { error: denied }
  const clean = Array.from(new Set(floors.map(f => f.trim()).filter(Boolean)))
  if (!clean.length) return { error: 'Add at least one floor / location.' }
  const sb = await createClient()
  const { error } = await sb.from('app_settings')
    .upsert({ key: floorsSettingKey(projectId), value: JSON.stringify(clean) }, { onConflict: 'key' })
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${projectId}`)
  return { ok: true }
}
