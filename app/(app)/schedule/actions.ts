'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'

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

/** Generic item patch (pct, state, wo_issued/number/on, owner, notes, sub, name, trade). */
export async function updateSchedItem(
  id: string,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<{ ok?: true; error?: string }> {
  const sb = await createClient()
  const { error } = await sb.from('sched_items').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${projectId}`)
  return { ok: true }
}

/** Mark the WO issued (or clear it) — the hard fact. */
export async function setWoIssued(input: {
  id: string; projectId: string; issued: boolean; woNumber?: string | null; issuedOn?: string | null
}): Promise<{ ok?: true; error?: string }> {
  return updateSchedItem(input.id, input.projectId, {
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
  const sb = await createClient()
  const me = await currentUid()
  const { error } = await sb.from('sched_items').update({ [input.field]: input.to || null }).eq('id', input.id)
  if (error) return { error: error.message }
  await sb.from('sched_date_changes').insert({
    item_id: input.id, field: input.field,
    from_date: input.from, to_date: input.to || null,
    reason: input.reason?.trim() || null, changed_by: me,
  })
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}

export async function deleteSchedItem(id: string, projectId: string): Promise<{ ok?: true; error?: string }> {
  const sb = await createClient()
  const { error } = await sb.from('sched_items').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/schedule/${projectId}`)
  return { ok: true }
}

/** Set an item×location floor status (upsert by hand — the unique is on lower(location)). */
export async function setFloorStatus(input: {
  itemId: string; projectId: string; location: string; floorId?: string | null
  status: 'not_started' | 'wip' | 'done' | 'na'
}): Promise<{ ok?: true; error?: string }> {
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
  revalidatePath(`/schedule/${input.projectId}`)
  return { ok: true }
}
