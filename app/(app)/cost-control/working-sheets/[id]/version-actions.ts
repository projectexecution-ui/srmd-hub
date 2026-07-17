'use server'
// Server actions for the version-chain controls on the WS detail page.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { generateSmartWSCode } from '@/components/cost-control/ws-code-action'
import { getCcSettings } from '@/lib/cost-control/settings'
import { evaluateItem } from '@/lib/cost-control/boq-template-parse'

const schema = z.object({
  ws_id: z.string().uuid(),
  break_chain: z.boolean(),
})

/**
 * Flip break_chain on a working sheet. When true, this WS starts a fresh
 * version chain within its (project, discipline, sub_skill, line_type)
 * bucket — older WSes in the same bucket stop being its version-mates.
 *
 * Gated by cost-control edit perms. The view recomputes version_no /
 * chain_size automatically; no row-level updates needed.
 */
export async function setBreakChain(
  wsId: string,
  breakChain: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const parsed = schema.safeParse({ ws_id: wsId, break_chain: breakChain })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_working_sheets')
    .update({ break_chain: breakChain })
    .eq('id', wsId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  return { ok: true }
}

/**
 * Raise the next version (a revision) of an already-approved working sheet,
 * IN-APP — no re-uploaded Excel. Creates a fresh draft in the SAME bucket, so
 * the versions view chains it automatically as v(N+1). The prior approved rows
 * stay frozen in their own version; the engineer enters only the delta here.
 *
 * Only fires when cc_cumulative_versions is on. Guarded so at most ONE version
 * in a chain is open at a time.
 */
export async function raiseNextVersion(
  wsId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  if (!z.string().uuid().safeParse(wsId).success) return { ok: false, error: 'Invalid input' }

  const settings = await getCcSettings()
  if (!settings.cumulative_versions) {
    return { ok: false, error: 'Cumulative versions is turned off' }
  }

  const supabase = await createClient()
  const [user, profile, reviewer] = await Promise.all([getMyUser(), getMyProfile(), checkIsCcReviewer()])
  const isAdmin = profile?.role === 'admin'

  // Load the source sheet via the versions view (for chain_anchor_id).
  const { data: src, error: srcErr } = await supabase
    .from('cc_ws_with_versions')
    .select('id, status, project_id, discipline_id, sub_skill_id, line_type, engineer_id, summary_notes, archived_at, chain_anchor_id')
    .eq('id', wsId)
    .single()
  if (srcErr || !src) return { ok: false, error: 'Working sheet not found' }

  if ((src.summary_notes ?? '').startsWith('[IB')) {
    return { ok: false, error: 'Baseline estimate sheets are revised through the Internal Estimate workflow' }
  }
  const eligible = ['approved', 'partially_approved', 'wo_issued', 'paid']
  if (!eligible.includes(src.status as string)) {
    return { ok: false, error: 'Only an approved sheet can be revised' }
  }
  const isOwner = user?.id === src.engineer_id
  if (!isOwner && !isAdmin && !reviewer) {
    return { ok: false, error: 'Only the sheet owner or management can raise a revision' }
  }

  // Guard: one open version per chain.
  const { data: sibs } = await supabase
    .from('cc_ws_with_versions')
    .select('id, status, archived_at')
    .eq('chain_anchor_id', src.chain_anchor_id)
  const open = (sibs ?? []).find(
    s => !s.archived_at && ['draft', 'returned', 'submitted'].includes(s.status as string),
  )
  if (open) {
    return { ok: false, error: 'There is already an open version in this chain — finish or archive it first' }
  }

  const wsCode = await generateSmartWSCode({
    project_id: src.project_id,
    sub_skill_id: src.sub_skill_id,
    entry_mode: 'excel_summary',
  })

  // Read the source total so the revision starts at the same figure (it
  // carries the whole BOQ forward).
  const { data: srcHdr } = await supabase
    .from('cc_working_sheets')
    .select('total_amount')
    .eq('id', wsId)
    .single()

  const { data: created, error: insErr } = await supabase
    .from('cc_working_sheets')
    .insert({
      ws_code: wsCode,
      project_id: src.project_id,
      discipline_id: src.discipline_id,
      sub_skill_id: src.sub_skill_id,
      line_type: src.line_type,
      status: 'draft',
      engineer_id: user?.id ?? src.engineer_id,
      entry_mode: 'excel_summary',
      total_amount: srcHdr?.total_amount ?? null,
      summary_total: srcHdr?.total_amount ?? null,
      break_chain: false,
    })
    .select('id')
    .single()
  if (insErr || !created) return { ok: false, error: `Could not create the revision: ${insErr?.message ?? 'unknown'}` }

  // Clone the approved version's rows into the draft as the starting full BOQ.
  // The SOURCE version's rows are never touched — the original stays frozen and
  // downloadable — the engineer only edits this fresh copy.
  const { data: srcRows } = await supabase
    .from('cc_excel_rows')
    .select('row_no, raw_label, description, unit, qty, rate, amount, formula_in_amount, rate_breakdown, amount_breakdown, source_sheet, source_cell')
    .eq('working_sheet_id', wsId)
    .order('row_no')
  if (srcRows && srcRows.length > 0) {
    const clone = srcRows.map(r => ({ ...r, working_sheet_id: created.id as string, ai_meta: null, working_ref: null }))
    await supabase.from('cc_excel_rows').insert(clone)
  }

  revalidatePath('/cost-control/working-sheets')
  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true, id: created.id as string }
}

const revRowSchema = z.object({
  description: z.string().min(1),
  unit: z.string().nullable(),
  qty: z.number().nullable(),
  material: z.number().nullable(),
  installation: z.number().nullable(),
  ml: z.number().nullable(),
  working_ref: z.object({
    attachment_id: z.string().nullable(),
    cell_note: z.string().nullable(),
  }).nullable(),
})
const saveRevSchema = z.object({
  ws_id: z.string().uuid(),
  rows: z.array(revRowSchema),
})
export type RevisionRowInput = z.infer<typeof revRowSchema>

/**
 * Persist a revision draft's delta rows to cc_excel_rows and sync the header
 * total. Rate/Amount are RECOMPUTED server-side (never trusted from the
 * client). Owner + draft/returned only. Replaces the sheet's rows wholesale
 * (the editor always sends the full current set).
 */
export async function saveRevisionRows(
  wsId: string,
  rows: RevisionRowInput[],
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const parsed = saveRevSchema.safeParse({ ws_id: wsId, rows })
  if (!parsed.success) return { ok: false, error: 'Invalid rows' }

  const supabase = await createClient()
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  const isAdmin = profile?.role === 'admin'

  const { data: ws, error: wsErr } = await supabase
    .from('cc_working_sheets')
    .select('id, status, engineer_id')
    .eq('id', wsId)
    .single()
  if (wsErr || !ws) return { ok: false, error: 'Working sheet not found' }
  if (ws.status !== 'draft' && ws.status !== 'returned') return { ok: false, error: 'Only a draft can be edited' }
  if (ws.engineer_id !== user?.id && !isAdmin) return { ok: false, error: 'Only the sheet owner can edit it' }

  const insertRows = parsed.data.rows.map((r, i) => {
    const ev = evaluateItem(r)
    const breakdown: Array<{ label: string; value: number }> = []
    if (r.material != null) breakdown.push({ label: 'Material', value: r.material })
    if (r.installation != null) breakdown.push({ label: 'Installation', value: r.installation })
    if (r.ml != null) breakdown.push({ label: 'M+L', value: r.ml })
    return {
      working_sheet_id: wsId,
      row_no: i + 1,
      raw_label: null,
      description: r.description,
      unit: r.unit,
      qty: r.qty,
      rate: ev.rate,
      amount: ev.amount,
      formula_in_amount: null,
      rate_breakdown: breakdown.length ? breakdown : null,
      amount_breakdown: null,
      ai_meta: null,
      source_sheet: null,
      source_cell: null,
      working_ref: r.working_ref,
    }
  })
  const total = insertRows.reduce((s, r) => s + (r.amount || 0), 0)

  // Replace rows wholesale.
  const { error: delErr } = await supabase.from('cc_excel_rows').delete().eq('working_sheet_id', wsId)
  if (delErr) return { ok: false, error: delErr.message }
  if (insertRows.length > 0) {
    const { error: insErr } = await supabase.from('cc_excel_rows').insert(insertRows)
    if (insErr) return { ok: false, error: insErr.message }
  }
  const { error: updErr } = await supabase
    .from('cc_working_sheets')
    .update({ total_amount: total, summary_total: total })
    .eq('id', wsId)
  if (updErr) return { ok: false, error: updErr.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true, total }
}
