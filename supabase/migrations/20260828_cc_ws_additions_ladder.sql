-- Save the totals ladder (contingency %, GST %) with the working sheet.
--
-- The engineer already confirms both percentages on the review grid at upload,
-- but only the grand total was kept — so the BOQ footer could show that
-- something had been added on top of the rows, without being able to say what.
-- It printed one line, "GST / additions +₹9,89,112".
--
-- Storing the ladder makes that split a fact read off the sheet rather than a
-- number worked backwards out of two totals.

alter table public.cc_working_sheets
  add column if not exists contingency_pct numeric,
  add column if not exists contingency_amt numeric,
  add column if not exists gst_pct         numeric,
  add column if not exists gst_amt         numeric;

comment on column public.cc_working_sheets.contingency_pct is
  'Contingency % confirmed on the review grid at upload. Null on sheets raised before Aug 2026 — the UI works the split out of the subtotal and grand total for those.';
comment on column public.cc_working_sheets.gst_pct is
  'GST % confirmed on the review grid at upload. Null on older sheets (see contingency_pct).';

-- The versions view has an explicit column list, so it does NOT inherit new
-- base-table columns. Recreate it with the four appended at the end.
create or replace view public.cc_ws_with_versions as
with grouped as (
  select ws.*,
         sum(case when ws.break_chain then 1 else 0 end) over (
           partition by ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type
           order by ws.created_at, ws.id
           rows between unbounded preceding and current row
         ) as chain_group
  from public.cc_working_sheets ws
)
select id, ws_code, project_id, discipline_id, sub_skill_id, line_type, status,
       engineer_id, total_amount, past_approved_in_subskill, created_at,
       submitted_at, approved_at, approved_by, returned_at, returned_by,
       return_reason, locked_at, locked_by, entry_mode, source_excel_url,
       source_excel_name, summary_total, summary_notes, flag_summary,
       last_checked_at, deadline_date, deadline_notes, approved_for_erp_amt,
       approved_for_erp_at, approved_for_erp_by, ai_parse_meta, break_chain,
       ai_preset_prompts, chain_group,
       first_value(id) over (
         partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
         order by created_at, id
         rows between unbounded preceding and unbounded following
       ) as chain_anchor_id,
       row_number() over (
         partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
         order by created_at, id
       ) as version_no,
       count(*) over (
         partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
       ) as chain_size,
       archived_at, archived_by, is_adhoc, adhoc_set_by, adhoc_set_at,
       contingency_pct, contingency_amt, gst_pct, gst_amt
from grouped g;
