-- Fix for a page-breaking mistake in 20260827_cc_ws_adhoc_flag.sql.
--
-- That migration added is_adhoc to the BASE TABLE cc_working_sheets, but the
-- working sheet page reads cc_ws_with_versions — a view with an explicit
-- column list, which does not inherit new base-table columns. Every Working
-- Sheet page threw:
--
--   column cc_ws_with_versions.is_adhoc does not exist
--
-- The lesson: in this schema cc_working_sheets is read through a view in most
-- places (it is what supplies chain_anchor_id / version_no / chain_size). Any
-- new column has to be added in BOTH, or the app sees a table that silently
-- lacks it.
--
-- The three new columns are appended at the END so CREATE OR REPLACE VIEW is
-- legal — existing column names, types and order must not change.

create or replace view public.cc_ws_with_versions as
 WITH grouped AS (
         SELECT ws.id,
            ws.ws_code,
            ws.project_id,
            ws.discipline_id,
            ws.sub_skill_id,
            ws.line_type,
            ws.status,
            ws.engineer_id,
            ws.total_amount,
            ws.past_approved_in_subskill,
            ws.created_at,
            ws.submitted_at,
            ws.approved_at,
            ws.approved_by,
            ws.returned_at,
            ws.returned_by,
            ws.return_reason,
            ws.locked_at,
            ws.locked_by,
            ws.entry_mode,
            ws.source_excel_url,
            ws.source_excel_name,
            ws.summary_total,
            ws.summary_notes,
            ws.flag_summary,
            ws.last_checked_at,
            ws.deadline_date,
            ws.deadline_notes,
            ws.approved_for_erp_amt,
            ws.approved_for_erp_at,
            ws.approved_for_erp_by,
            ws.ai_parse_meta,
            ws.break_chain,
            ws.ai_preset_prompts,
            ws.archived_at,
            ws.archived_by,
            ws.is_adhoc,
            ws.adhoc_set_by,
            ws.adhoc_set_at,
            sum(
                CASE
                    WHEN ws.break_chain THEN 1
                    ELSE 0
                END) OVER (PARTITION BY ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type ORDER BY ws.created_at, ws.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS chain_group
           FROM cc_working_sheets ws
        )
 SELECT id,
    ws_code,
    project_id,
    discipline_id,
    sub_skill_id,
    line_type,
    status,
    engineer_id,
    total_amount,
    past_approved_in_subskill,
    created_at,
    submitted_at,
    approved_at,
    approved_by,
    returned_at,
    returned_by,
    return_reason,
    locked_at,
    locked_by,
    entry_mode,
    source_excel_url,
    source_excel_name,
    summary_total,
    summary_notes,
    flag_summary,
    last_checked_at,
    deadline_date,
    deadline_notes,
    approved_for_erp_amt,
    approved_for_erp_at,
    approved_for_erp_by,
    ai_parse_meta,
    break_chain,
    ai_preset_prompts,
    chain_group,
    first_value(id) OVER (PARTITION BY project_id, discipline_id, sub_skill_id, line_type, chain_group ORDER BY created_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS chain_anchor_id,
    row_number() OVER (PARTITION BY project_id, discipline_id, sub_skill_id, line_type, chain_group ORDER BY created_at, id) AS version_no,
    count(*) OVER (PARTITION BY project_id, discipline_id, sub_skill_id, line_type, chain_group) AS chain_size,
    archived_at,
    archived_by,
    is_adhoc,
    adhoc_set_by,
    adhoc_set_at
   FROM grouped g;
