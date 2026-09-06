'use server'
// ERP budget transfer requests — moving approved budget from one work
// category to another.
//
// Every rule lives in the database (see 20260903_cc_budget_transfer_requests):
// who may raise, the cap on what is free to move, who signs at each stage, and
// whether IN4 actually did what was approved. These actions are a thin pass
// through to those functions, so the same answer comes back whether the call
// arrives from this screen, the approvals inbox or the billing queue.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

const uuid = z.string().uuid()
type Result = { ok: true; status?: string } | { ok: false; error: string }

/** Postgres RAISE messages are written for the reader, so pass them through
 *  rather than replacing them with something vaguer. */
function speak(error: { message: string } | null, fallback: string): string {
  const m = (error?.message ?? '').trim()
  if (!m) return fallback
  // Strip the driver's prefixes but keep the sentence.
  return m.replace(/^ERROR:\s*/i, '').replace(/^[A-Z0-9]{5}:\s*/, '')
}

export interface TransferLineOption {
  discipline_id: string
  disc_code: string
  disc_name: string
  sub_skill_id: string
  sub_code: string
  sub_name: string
  budget: number
  free_to_move: number
  over_budget: number
  is_completed: boolean
}

/** Every sub-category on the project, with what is on it and what can leave
 *  it. Loaded when the form opens rather than shipped with the page — it is
 *  only needed by the person actually raising a request. */
export async function getTransferLineOptions(
  projectId: string,
): Promise<{ ok: true; lines: TransferLineOption[] } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'view')
  if (!uuid.safeParse(projectId).success) return { ok: false, error: 'Invalid project' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_transfer_line_options', { p_project: projectId })
  if (error) return { ok: false, error: speak(error, 'Could not read the project lines') }

  return {
    ok: true,
    lines: (data ?? []).map((r: Record<string, unknown>) => ({
      discipline_id: String(r.discipline_id),
      disc_code: String(r.disc_code ?? ''),
      disc_name: String(r.disc_name ?? ''),
      sub_skill_id: String(r.sub_skill_id),
      sub_code: String(r.sub_code ?? ''),
      sub_name: String(r.sub_name ?? ''),
      budget: Number(r.budget ?? 0),
      free_to_move: Number(r.free_to_move ?? 0),
      over_budget: Number(r.over_budget ?? 0),
      is_completed: Boolean(r.is_completed),
    })),
  }
}

export async function raiseTransfer(input: {
  projectId: string
  fromDisciplineId: string
  fromSubSkillId: string
  toDisciplineId: string
  toSubSkillId: string
  amount: number
  reason: string
}): Promise<Result> {
  await requirePermission('cost-control', 'view')

  const parsed = z.object({
    projectId: uuid,
    fromDisciplineId: uuid,
    fromSubSkillId: uuid,
    toDisciplineId: uuid,
    toSubSkillId: uuid,
    amount: z.number().finite().positive('Enter an amount to move'),
    reason: z.string().trim().min(1, 'Say why the budget is moving').max(1000),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const v = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_transfer_raise', {
    p_project: v.projectId,
    p_from_disc: v.fromDisciplineId,
    p_from_sub: v.fromSubSkillId,
    p_to_disc: v.toDisciplineId,
    p_to_sub: v.toSubSkillId,
    p_amount: v.amount,
    p_reason: v.reason,
  })
  if (error) return { ok: false, error: speak(error, 'Could not raise the request') }

  revalidatePath(`/cost-control/projects/${v.projectId}`)
  revalidatePath('/cost-control/approvals')
  return { ok: true }
}

export async function approveTransfer(
  id: string,
  comment: string | null,
  projectId?: string,
): Promise<Result> {
  await requirePermission('cost-control', 'view')
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid request' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_transfer_approve', {
    p_id: id,
    p_comment: comment?.trim() || null,
  })
  if (error) return { ok: false, error: speak(error, 'Could not approve it') }

  revalidatePath('/cost-control/approvals')
  revalidatePath('/cost-control/billing')
  if (projectId) revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true, status: (data as string | null) ?? undefined }
}

export async function rejectTransfer(
  id: string,
  reason: string,
  projectId?: string,
): Promise<Result> {
  await requirePermission('cost-control', 'view')
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid request' }
  if (!reason.trim()) {
    return { ok: false, error: 'Say why it is being turned down — the person who raised it has to know what to change' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_transfer_reject', { p_id: id, p_reason: reason.trim() })
  if (error) return { ok: false, error: speak(error, 'Could not turn it down') }

  revalidatePath('/cost-control/approvals')
  revalidatePath('/cost-control/billing')
  if (projectId) revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

export async function cancelTransfer(id: string, projectId?: string): Promise<Result> {
  await requirePermission('cost-control', 'view')
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid request' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_transfer_cancel', { p_id: id })
  if (error) return { ok: false, error: speak(error, 'Could not withdraw it') }

  revalidatePath('/cost-control/approvals')
  if (projectId) revalidatePath(`/cost-control/projects/${projectId}`)
  return { ok: true }
}

/** Billing / the Coordinator recording that the move has been made in IN4.
 *  The returned status says whether it is now waiting for a sync to prove it,
 *  or whether a sync had already picked the move up. */
export async function markTransferInIn4(id: string): Promise<Result> {
  await requirePermission('cost-control', 'view')
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Invalid request' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_transfer_mark_in4', { p_id: id })
  if (error) return { ok: false, error: speak(error, 'Could not record the IN4 move') }

  revalidatePath('/cost-control/billing')
  return { ok: true, status: (data as string | null) ?? undefined }
}
