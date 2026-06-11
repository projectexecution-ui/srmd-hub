'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, requirePermission } from '@/lib/auth'

export interface ImportRow {
  discipline_code: string | null
  sub_skill_code: string | null
  description: string | null
  uom: string | null
  budget_amount: number | null
  committed_amount: number | null
  paid_amount: number | null
  line_type: 'work' | 'material'
}

export interface CommitImportPayload {
  filename: string
  project_id: string
  rows: ImportRow[]
  raw_data?: unknown
}

export async function commitImport(payload: CommitImportPayload) {
  await requirePermission('cost-control', 'edit')
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  if (!payload.project_id) return { error: 'project_id required' }
  if (payload.rows.length === 0) return { error: 'no rows to import' }

  const supabase = await createClient()

  // 1. Create the import record
  const { data: importRow, error: importErr } = await supabase
    .from('cc_excel_imports')
    .insert({
      filename: payload.filename,
      project_id: payload.project_id,
      detected_format: 'engg_consolidated_budget_report',
      lines_found: payload.rows.length,
      import_status: 'preview',
      imported_by: user.id,
      raw_data: payload.raw_data ?? null,
    })
    .select('id')
    .single()
  if (importErr || !importRow) return { error: importErr?.message ?? 'failed to create import record' }

  // 2. Resolve discipline + sub-skill codes to IDs
  const disciplineCodes = [...new Set(payload.rows.map(r => r.discipline_code).filter(Boolean) as string[])]
  const subSkillCodes = [...new Set(payload.rows.map(r => r.sub_skill_code).filter(Boolean) as string[])]

  const { data: disciplines } = await supabase
    .from('cc_disciplines')
    .select('id, code')
    .in('code', disciplineCodes.length > 0 ? disciplineCodes : ['__none__'])
  const discByCode = new Map((disciplines ?? []).map(d => [d.code, d.id]))

  const { data: subSkills } = await supabase
    .from('cc_sub_skills')
    .select('id, code, discipline_id')
    .in('code', subSkillCodes.length > 0 ? subSkillCodes : ['__none__'])
  const subByCode = new Map((subSkills ?? []).map(s => [s.code, { id: s.id, discipline_id: s.discipline_id }]))

  // 3. Insert / upsert budget lines + emit events
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of payload.rows) {
    if (!row.discipline_code) {
      skipped++
      errors.push(`skipped: row missing discipline code (${row.description ?? ''})`)
      continue
    }
    let discipline_id = discByCode.get(row.discipline_code)
    if (!discipline_id) {
      skipped++
      errors.push(`skipped: unknown discipline "${row.discipline_code}" (add it under Admin → Disciplines)`)
      continue
    }
    let sub_skill_id: string | null = null
    if (row.sub_skill_code) {
      const ss = subByCode.get(row.sub_skill_code)
      if (ss) {
        sub_skill_id = ss.id
        if (ss.discipline_id !== discipline_id) {
          // The sub-skill master decides which discipline a line sits under —
          // the project page groups lines by the sub-skill's parent, so
          // importing under the file's claimed discipline would orphan it.
          discipline_id = ss.discipline_id
          errors.push(`note: sub-skill ${row.sub_skill_code} sits under a different discipline than ${row.discipline_code} in the file — imported under its own discipline`)
        }
      } else {
        errors.push(`warning: unknown sub-skill "${row.sub_skill_code}"; importing at discipline level`)
      }
    }

    // Upsert the budget line (one row per project + discipline + sub-skill + line_type).
    // sub_skill_id is nullable — the previous code chained `.is(...)` AND
    // `.eq(...)` which produced `is.null AND eq.null` for null inputs and
    // matched nothing, so every re-import inserted duplicates instead of
    // updating. Split the query depending on null-ness.
    const baseQuery = supabase
      .from('cc_budget_lines')
      .select('id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', payload.project_id)
      .eq('discipline_id', discipline_id)
      .eq('line_type', row.line_type)
    const { data: existingLine } = await (sub_skill_id === null
      ? baseQuery.is('sub_skill_id', null)
      : baseQuery.eq('sub_skill_id', sub_skill_id)
    ).maybeSingle()

    let budget_line_id = existingLine?.id ?? null

    if (!budget_line_id) {
      const { data: newLine, error: blErr } = await supabase
        .from('cc_budget_lines')
        .insert({
          project_id: payload.project_id,
          discipline_id,
          sub_skill_id,
          line_type: row.line_type,
          current_budget_amt: row.budget_amount ?? 0,
          current_wo_committed_amt: row.committed_amount ?? 0,
          current_paid_amt: row.paid_amount ?? 0,
          notes: row.description ?? null,
        })
        .select('id')
        .single()
      if (blErr) {
        errors.push(`row ${imported + skipped + 1}: ${blErr.message}`)
        skipped++
        continue
      }
      budget_line_id = newLine.id
    } else {
      // Adjust existing
      await supabase
        .from('cc_budget_lines')
        .update({
          current_budget_amt: row.budget_amount ?? existingLine!.current_budget_amt,
          current_wo_committed_amt: row.committed_amount ?? existingLine!.current_wo_committed_amt,
          current_paid_amt: row.paid_amount ?? existingLine!.current_paid_amt,
        })
        .eq('id', budget_line_id!)
    }

    // Emit one budget_add event so reconciliation works
    if (row.budget_amount && row.budget_amount > 0) {
      await supabase.from('cc_budget_events').insert({
        budget_line_id,
        project_id: payload.project_id,
        event_type: 'budget_add',
        delta_amount: row.budget_amount,
        remarks: `Excel import: ${payload.filename} — ${row.description ?? ''}`.slice(0, 500),
        channel: 'excel_import',
        requested_by: user.id,
      })
    }
    imported++
  }

  // 4. Mark import committed
  await supabase
    .from('cc_excel_imports')
    .update({
      lines_imported: imported,
      lines_skipped: skipped,
      import_status: 'committed',
      committed_at: new Date().toISOString(),
    })
    .eq('id', importRow.id)

  revalidatePath('/cost-control/import')
  revalidatePath('/cost-control')
  revalidatePath(`/cost-control/projects/${payload.project_id}`)

  return { ok: true, imported, skipped, errors, import_id: importRow.id }
}
