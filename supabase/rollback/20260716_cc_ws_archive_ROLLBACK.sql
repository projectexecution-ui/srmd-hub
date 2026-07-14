-- Rollback for 20260716_cc_ws_archive.sql
drop function if exists public.cc_archive_ws(uuid, text);

-- Recreate the view WITHOUT the archive columns (original definition),
-- then drop the columns.
create or replace view public.cc_ws_with_versions as
 with grouped as (
         select ws.id, ws.ws_code, ws.project_id, ws.discipline_id, ws.sub_skill_id,
            ws.line_type, ws.status, ws.engineer_id, ws.total_amount,
            ws.past_approved_in_subskill, ws.created_at, ws.submitted_at,
            ws.approved_at, ws.approved_by, ws.returned_at, ws.returned_by,
            ws.return_reason, ws.locked_at, ws.locked_by, ws.entry_mode,
            ws.source_excel_url, ws.source_excel_name, ws.summary_total,
            ws.summary_notes, ws.flag_summary, ws.last_checked_at,
            ws.deadline_date, ws.deadline_notes, ws.approved_for_erp_amt,
            ws.approved_for_erp_at, ws.approved_for_erp_by, ws.ai_parse_meta,
            ws.break_chain, ws.ai_preset_prompts,
            sum(case when ws.break_chain then 1 else 0 end)
              over (partition by ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type
                    order by ws.created_at, ws.id
                    rows between unbounded preceding and current row) as chain_group
           from cc_working_sheets ws
        )
 select id, ws_code, project_id, discipline_id, sub_skill_id, line_type, status,
    engineer_id, total_amount, past_approved_in_subskill, created_at,
    submitted_at, approved_at, approved_by, returned_at, returned_by,
    return_reason, locked_at, locked_by, entry_mode, source_excel_url,
    source_excel_name, summary_total, summary_notes, flag_summary,
    last_checked_at, deadline_date, deadline_notes, approved_for_erp_amt,
    approved_for_erp_at, approved_for_erp_by, ai_parse_meta, break_chain,
    ai_preset_prompts, chain_group,
    first_value(id) over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
                          order by created_at, id
                          rows between unbounded preceding and unbounded following) as chain_anchor_id,
    row_number() over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
                       order by created_at, id) as version_no,
    count(*) over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group) as chain_size
   from grouped g;
-- NOTE: recreating a view with FEWER columns needs drop+create:
-- run: drop view public.cc_ws_with_versions; then the create above.

alter table public.cc_working_sheets
  drop column if exists archived_at,
  drop column if exists archived_by;

delete from public.app_settings where key = 'cc_archive_users';
