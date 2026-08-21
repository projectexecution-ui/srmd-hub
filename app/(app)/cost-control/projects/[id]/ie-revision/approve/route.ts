// Trustee/Admin approves a submitted Internal Estimate revision. Parses the
// uploaded revised Internal Budget Excel, archives the project's current
// estimate sheets, inserts fresh ones from the revised parse, then finalizes
// the revision. Aborts (touching nothing) if the parse fails or reconciles
// to zero — the old estimate is never lost.
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkCanDecideInternalEstimate } from '@/components/cost-control/ws-actions'
import { notifyInternalEstimateAccepted } from '@/lib/cost-control/ie-notify'
import { workbookToSheetInputs } from '@/lib/cost-control/excel-parse-adapter'
import { parseInternalBudget } from '@/lib/cost-control/internal-budget-parse'
import { mapBudgetToWS } from '@/lib/cost-control/ib-reimport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission('cost-control', 'edit')
  // CRITICAL: only the Trustee / Admin may run the destructive re-import.
  // (Engineers hold cost-control edit, so requirePermission alone is not
  // enough — check the decider role BEFORE any archive/insert happens.)
  if (!(await checkCanDecideInternalEstimate())) {
    return NextResponse.json({ ok: false, reason: 'Only the Trustee or an Admin can approve the revision.' }, { status: 403 })
  }
  const { id: projectId } = await params
  const body = await req.json().catch(() => ({}))
  const revisionId = body?.revision_id as string | undefined
  if (!revisionId) return NextResponse.json({ ok: false, reason: 'revision_id required' }, { status: 400 })

  const supabase = await createClient()

  // Revision must be submitted (with an attached Excel) for this project.
  const { data: rev, error: revErr } = await supabase
    .from('cc_ie_revisions')
    .select('id, project_id, status, revised_excel_url, revised_excel_name')
    .eq('id', revisionId)
    .single()
  if (revErr || !rev) return NextResponse.json({ ok: false, reason: 'Revision not found' }, { status: 404 })
  if (rev.project_id !== projectId) return NextResponse.json({ ok: false, reason: 'Revision is for another project' }, { status: 400 })
  if (rev.status !== 'revision_submitted') return NextResponse.json({ ok: false, reason: 'Revision is not awaiting approval' }, { status: 409 })
  if (!rev.revised_excel_url) return NextResponse.json({ ok: false, reason: 'No revised Excel attached' }, { status: 400 })

  // Parse the revised Excel.
  const { data: fileBlob, error: dlErr } = await supabase.storage.from('cc-sheets').download(rev.revised_excel_url)
  if (dlErr || !fileBlob) return NextResponse.json({ ok: false, reason: `Could not download the revised Excel: ${dlErr?.message ?? 'unknown'}` }, { status: 500 })
  const wb = XLSX.read(await fileBlob.arrayBuffer(), { type: 'array' })
  const parsed = parseInternalBudget(workbookToSheetInputs(wb))
  if (!parsed.parseOk) {
    return NextResponse.json({ ok: false, reason: `The revised sheet could not be read (${parsed.failReason}). Nothing was changed.` }, { status: 422 })
  }

  // Master data for mapping.
  const [{ data: subs }, { data: discs }, { data: proj }] = await Promise.all([
    supabase.from('cc_sub_skills').select('id, code, discipline_id, cc_disciplines(code)'),
    supabase.from('cc_disciplines').select('id, code'),
    supabase.from('projects').select('built_up_sft').eq('id', projectId).single(),
  ])
  const discCodeById = new Map<string, string>()
  for (const d of discs ?? []) discCodeById.set(d.id as string, d.code as string)
  const masterDiscs = new Set<string>([...discCodeById.values()])
  const masterSubDisc = new Map<string, string>()   // sub code -> disc code
  const subIdByCode = new Map<string, string>()      // sub code -> sub id
  for (const s of (subs ?? []) as Array<{ id: string; code: string; discipline_id: string }>) {
    const dc = discCodeById.get(s.discipline_id)
    if (dc) masterSubDisc.set(s.code, dc)
    subIdByCode.set(s.code, s.id)
  }
  const discIdByCode = new Map<string, string>()
  for (const [uid, code] of discCodeById) discIdByCode.set(code, uid)

  const plan = mapBudgetToWS(parsed, masterSubDisc, masterDiscs)
  if (plan.total <= 0) return NextResponse.json({ ok: false, reason: 'The revised sheet parsed to zero — nothing was changed.' }, { status: 422 })

  const sft = Number(proj?.built_up_sft ?? 0)
  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const stamp = new Date().toISOString().slice(0, 10)
  const tag = `[IB-Rev ${stamp}]`

  // Create any missing "Others — Budget Import" bucket sub-skills.
  for (const dc of plan.bucketDiscs) {
    const bucket = String(parseInt(dc, 10)) + '99'
    if (subIdByCode.has(bucket)) continue
    const discId = discIdByCode.get(dc)
    if (!discId) continue
    const { data: made } = await supabase
      .from('cc_sub_skills')
      .insert({ discipline_id: discId, code: bucket, name: 'Others — Budget Import' })
      .select('id').single()
    if (made) { subIdByCode.set(bucket, made.id as string); masterSubDisc.set(bucket, dc) }
  }

  // Archive the project's CURRENT estimate sheets (any prior [IB…] import),
  // rather than delete — fully reversible.
  const archivedAt = new Date().toISOString()
  const { data: archivedRows } = await supabase
    .from('cc_working_sheets')
    .update({ archived_at: archivedAt })
    .eq('project_id', projectId)
    .is('archived_at', null)
    .like('summary_notes', '[IB%')
    .select('id')

  // Insert the revised estimate sheets. ws_code carries the revision id so it
  // is unique across projects and re-imports (the old projectId-prefix +
  // date scheme could collide and silently drop rows).
  const revShort = revisionId.replace(/-/g, '').slice(0, 8)
  let inserted = 0
  const insertErrors: string[] = []
  for (const [idx, row] of plan.rows.entries()) {
    const subId = subIdByCode.get(row.subCode)
    const discId = discIdByCode.get(row.discCode)
    if (!subId || !discId) continue
    const perSft = sft > 0 ? ` ≈ ${inr(row.amount / sft)}/sft on ${sft.toLocaleString('en-IN')} sft` : ''
    const notes = [
      `${tag} Revised Internal Budget — ${rev.revised_excel_name ?? 'uploaded sheet'}`,
      row.remark ? `Remark: ${row.remark}` : null,
      row.subCode.endsWith('99') ? 'Grouped under "Others — Budget Import".' : null,
      `Total ${inr(row.amount)}${perSft}`,
    ].filter(Boolean).join('\n')

    const { data: wsIns, error: insErr } = await supabase.from('cc_working_sheets').insert({
      ws_code: `${row.subCode}-Rev-${revShort}-${idx}`,
      project_id: projectId, discipline_id: discId, sub_skill_id: subId,
      line_type: 'work', status: 'draft', engineer_id: null,
      total_amount: row.amount, entry_mode: row.mode, summary_total: row.amount,
      summary_notes: notes, source_excel_name: rev.revised_excel_name,
      source_excel_url: rev.revised_excel_url,
    }).select('id').single()
    if (insErr || !wsIns) { insertErrors.push(`${row.subCode}: ${insErr?.message ?? 'insert failed'}`); continue }
    inserted++
    if (row.lines.length) {
      const rows = row.lines.slice(0, 300).map((l, i) => ({
        working_sheet_id: wsIns.id, row_no: i + 1, description: l.description.slice(0, 300),
        unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount,
      }))
      await supabase.from('cc_excel_rows').insert(rows)
    }
    // Make sure the discipline + sub-skill stay enabled on the project.
    await supabase.from('cc_project_disciplines')
      .upsert({ project_id: projectId, discipline_id: discId, is_enabled: true }, { onConflict: 'project_id,discipline_id' })
    await supabase.from('cc_project_sub_skills')
      .upsert({ project_id: projectId, sub_skill_id: subId, is_enabled: true }, { onConflict: 'project_id,sub_skill_id' })
  }

  // Nothing inserted → the revised sheet mapped to no known sub-skills.
  // Un-archive the old estimate so it isn't lost, and abort.
  if (inserted === 0) {
    const ids = (archivedRows ?? []).map(r => r.id as string)
    if (ids.length) await supabase.from('cc_working_sheets').update({ archived_at: null }).in('id', ids)
    return NextResponse.json({ ok: false, reason: 'The revised sheet produced no mappable sheets — the previous estimate was kept unchanged.' }, { status: 422 })
  }

  const summary = {
    file: rev.revised_excel_name, total: plan.total, sheets: inserted,
    unplaced: plan.unplaced.length, insert_errors: insertErrors.length, at: new Date().toISOString(),
  }
  const { error: finErr } = await supabase.rpc('cc_ie_finalize', { p_revision: revisionId, p_summary: summary })
  if (finErr) return NextResponse.json({ ok: false, reason: finErr.message }, { status: 403 })

  // Tell the named few (Aksha + Parimal + this project's Atm Head) that the
  // Trustee approved the revised Internal Estimate — all channels, best-effort.
  const me = await getMyUser()
  after(() => notifyInternalEstimateAccepted({
    projectId, actorId: me?.id ?? null, kind: 'revision', amount: plan.total, sheets: inserted,
  }).catch(() => {}))

  return NextResponse.json({ ok: true, ...summary })
}
