'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'

/**
 * Set where an IN4 sub-project books, and who approves its bills.
 *
 * This exists because CT Hub has no project for 30 of the 54 IN4 sub-projects
 * that have work orders against them — Raj Uphaar, Staff Facilities Block, the
 * Warehouse, Raj Saurabh — and those carry most of the money. They are not
 * mis-mapped; Cost Control simply covers a subset of the ashram. Making a clerk
 * pick from a list that does not contain the right answer produces a wrong
 * answer, so Bills Approval keeps its own desk instead.
 *
 * Unlike a sanction, a desk is a setting rather than evidence: a CT Hub project
 * gets created later, an Atm Head changes, and the desk has to follow. So this
 * upserts, and the table carries update and delete policies for admins.
 *
 * The sub-project's name is copied in at the moment the desk is made, so the
 * record of what was decided reads the same after IN4 renames something.
 */
export async function saveProjectDesk(input: {
  subprojectId: number
  ccProjectId?: string | null
  atmHeadId?: string | null
  shortName?: string | null
  note?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  await requireBillsWrite()
  const supabase = await createClient()

  const { data: me } = await supabase.auth.getUser()
  const uid = me?.user?.id
  if (!uid) return { ok: false, error: 'Not signed in.' }

  if (!Number.isInteger(input.subprojectId)) return { ok: false, error: 'No sub-project given.' }

  // The name comes from IN4, never from the form — a desk that records a name
  // somebody typed is a second spelling of a thing that already has one.
  const { data: sp, error: spErr } = await supabase
    .from('in4_subprojects').select('name').eq('id', input.subprojectId).maybeSingle()
  if (spErr) return { ok: false, error: spErr.message }

  // Not found is allowed: a sub-project can leave the mirror while its bills
  // stay. Falling back to the existing desk's name keeps it readable.
  const { data: existing } = await supabase
    .from('bb_project_desks').select('in4_name').eq('subproject_id', input.subprojectId).maybeSingle()

  const name = (sp?.name as string | undefined)?.trim()
    || (existing?.in4_name as string | undefined)
    || `Sub-project ${input.subprojectId}`

  const { error } = await supabase.from('bb_project_desks').upsert({
    subproject_id: input.subprojectId,
    in4_name: name,
    short_name: input.shortName?.trim() || null,
    cc_project_id: input.ccProjectId || null,
    atm_head_id: input.atmHeadId || null,
    note: input.note?.trim() || null,
    created_by: uid,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'subproject_id' })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/bills-booking/mapping')
  revalidatePath(`/bills-booking/mapping/${input.subprojectId}`)
  revalidatePath('/bills-booking/new')
  return { ok: true }
}

/**
 * Seat somebody at one desk of a Bills Approval project, or take them off it.
 *
 * The desks were keyed on a CT Hub project and nothing else, which is why the
 * 32 sub-projects without one could never be given a Site Head, a Disc Head, a
 * CT Head or a Billing desk — 887 of the 1,228 numbered work orders. A desk row
 * can now hang off the IN4 sub-project instead, and the resolution order is
 * the sub-project's own desk, then the project's, then the default team.
 */
export async function setDeskMember(input: {
  subprojectId: number
  desk: string
  userId: string
  on: boolean
}): Promise<{ ok: boolean; error?: string }> {
  await requireBillsWrite()
  const supabase = await createClient()

  const fn = input.on ? 'bb_rpc_add_desk_member' : 'bb_rpc_remove_desk_member'
  const { error } = await supabase.rpc(fn, {
    p_desk: input.desk, p_project: null, p_user: input.userId, p_subproject: input.subprojectId,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/bills-booking/mapping/${input.subprojectId}`)
  return { ok: true }
}

/**
 * Copy one Bills Approval project's desks onto another.
 *
 * Aksha, 14 Sep 2026: "keep it copyable". Raj Uphaar alone is five
 * sub-projects — Execution, Infra Work, Interior Scope, Landscape, ICT Team —
 * that all want the same people, and typing them five times is how one of them
 * quietly ends up different.
 *
 * It REPLACES rather than merges: "copy the desks from Raj Uphaar" means this
 * should end up looking like Raj Uphaar, not like both of them at once. The
 * screen says so before the click.
 */
export async function copyDesks(input: {
  toSubprojectId: number
  fromSubprojectId?: number | null
  fromProjectId?: string | null
}): Promise<{ ok: boolean; error?: string; count?: number }> {
  await requireBillsWrite()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('bb_rpc_copy_desks', {
    p_to_subproject: input.toSubprojectId,
    p_from_subproject: input.fromSubprojectId ?? null,
    p_from_project: input.fromProjectId ?? null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/bills-booking/mapping/${input.toSubprojectId}`)
  revalidatePath('/bills-booking/mapping')
  return { ok: true, count: Number(data ?? 0) }
}
