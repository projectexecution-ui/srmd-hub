// Builds a multi-sheet .xlsx workbook containing every Cost Control table,
// so the whole module's data can be snapshotted and kept safe outside the
// DB. Used by both the on-demand "Download backup" button and the daily
// cron (which uploads the file to the private cc-backups storage bucket).
//
// Server-only (Node runtime) — uses the xlsx package's buffer writer.

import * as XLSX from 'xlsx'
import type { SupabaseClient } from '@supabase/supabase-js'

// Each entry: a worksheet name + the table/columns to dump. Order = the
// tab order in the workbook. Kept flat (no joins) so the backup is a
// faithful raw snapshot you could re-import if ever needed.
const TABLES: Array<{ sheet: string; table: string; select: string; order?: string }> = [
  { sheet: 'Projects',          table: 'projects',                select: 'id, code, name, cc_status, setup_progress_pct, built_up_sft, parent_project_id, pm_user_id, start_date, target_completion', order: 'code' },
  { sheet: 'Disciplines',       table: 'cc_disciplines',          select: 'id, code, name, display_order, is_archived', order: 'display_order' },
  { sheet: 'SubSkills',         table: 'cc_sub_skills',            select: 'id, discipline_id, code, name, default_uom, is_archived', order: 'code' },
  { sheet: 'ProjectDisc',       table: 'cc_project_disciplines',   select: 'project_id, discipline_id, is_enabled, estimation_mode, thumbrule_rate_per_sft, target_deadline' },
  { sheet: 'ProjectSubSkills',  table: 'cc_project_sub_skills',    select: 'project_id, sub_skill_id, is_enabled, estimation_mode, thumbrule_rate_per_sft, target_deadline' },
  { sheet: 'WorkingSheets',     table: 'cc_working_sheets',        select: 'id, ws_code, project_id, discipline_id, sub_skill_id, line_type, entry_mode, status, total_amount, summary_total, approved_for_erp_amt, past_approved_in_subskill, deadline_date, break_chain, engineer_id, source_excel_name, created_at', order: 'created_at' },
  { sheet: 'WSItems',           table: 'cc_working_sheet_items',   select: 'id, working_sheet_id, sr_no, description, uom, qty, rate, gst_pct, total_amount, vendor_id, location_tag, remark' },
  { sheet: 'ExcelRows',         table: 'cc_excel_rows',            select: 'id, working_sheet_id, row_no, description, unit, qty, rate, amount, flag, flag_severity' },
  { sheet: 'BudgetLines',       table: 'cc_budget_lines',          select: 'id, project_id, discipline_id, sub_skill_id, line_type, current_budget_amt, current_wo_committed_amt, current_paid_amt, notes' },
  { sheet: 'BudgetEvents',      table: 'cc_budget_events',         select: 'id, project_id, budget_line_id, event_type, delta_amount, related_ws_id, remarks, event_date', order: 'event_date' },
  { sheet: 'ApprovalEvents',    table: 'approval_events',          select: 'id, doc_type, doc_id, from_stage, to_stage, decision, comment, actor_id, created_at', order: 'created_at' },
  { sheet: 'ExcelImports',      table: 'cc_excel_imports',         select: 'id, project_id, filename, lines_found, lines_imported, lines_skipped, import_status, created_at', order: 'created_at' },
  { sheet: 'BphLinks',          table: 'cc_bph_project_links',     select: 'bph_project_id, cc_project_id, last_pulled_at, last_pull_result' },
]

export interface BackupResult {
  buffer: Buffer
  filename: string
  sheetCounts: Record<string, number>
}

// PostgREST caps every response at 1000 rows regardless of .limit(), so a
// single big read silently truncates. Page with .range() instead.
const PAGE_SIZE = 1000

export async function buildCostControlBackup(supabase: SupabaseClient, stampISO: string): Promise<BackupResult> {
  const wb = XLSX.utils.book_new()
  const sheetCounts: Record<string, number> = {}

  // A small cover sheet so the file is self-describing.
  const cover = [
    { Field: 'Backup', Value: 'SRMD Cost Control — full data export' },
    { Field: 'Generated (UTC)', Value: stampISO },
    { Field: 'Sheets', Value: TABLES.map(t => t.sheet).join(', ') },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cover), 'README')

  for (const t of TABLES) {
    // Always order — page boundaries are only stable with an explicit sort.
    // Tables without a natural order sort by their first selected column.
    // 'id' as a second key breaks ties: a non-unique sort column (e.g.
    // created_at) would otherwise let rows repeat or vanish across pages.
    const orderCol = t.order ?? t.select.split(',')[0].trim()
    const rows: unknown[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabase
        .from(t.table)
        .select(t.select)
        .order(orderCol, { ascending: true })
      if (orderCol !== 'id') q = q.order('id', { ascending: true })
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`Backup failed while reading the ${t.table} table: ${error.message}`)
      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
    sheetCounts[t.sheet] = rows.length
    // Empty table → still create the sheet with a header row so the tab
    // exists and the structure is documented.
    const sheetData = rows.length > 0 ? rows : [{ _note: 'no rows' }]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), t.sheet.slice(0, 31))
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const datePart = stampISO.slice(0, 10)
  return { buffer, filename: `cost-control-backup-${datePart}.xlsx`, sheetCounts }
}
