-- Approvals that belong to another department, not Construction.
--
-- Most budget approved here is CT's own work. Sometimes it is Design's, or
-- Security's, or ICT's — authorised outside the construction chain and then
-- drawn against a project. The Atm Head already writes this into his sign-off
-- remark ("...approved by Maulikji under Design expense", "This is for Odoo
-- expense"), where nobody can read it without opening that one sheet.
--
-- Recorded on the SHEET, not in a table of its own: one Atm Head sign-off per
-- sheet means one record per sheet, and several sheets on a sub-category over
-- time give several records with no extra machinery.
--
-- Null department = ordinary CT work. That is the overwhelming majority and
-- costs nothing to store.

alter table public.cc_working_sheets
  add column if not exists other_dept        text,
  add column if not exists other_dept_note   text,
  add column if not exists other_dept_set_by uuid references public.profiles(id),
  add column if not exists other_dept_set_at timestamptz;

comment on column public.cc_working_sheets.other_dept is
  'Department this budget belongs to when it is NOT Construction — Design / Security / ICT / Housekeeping / free text. Null = CT, the normal case. Set by the Atm Head at sign-off.';
comment on column public.cc_working_sheets.other_dept_note is
  'The Atm Head''s note: who authorised the work and how much of it is being drawn. Read on the project page, so it is kept apart from the sign-off remark (which answers "did I check this working").';

create index if not exists cc_ws_other_dept_idx
  on public.cc_working_sheets (project_id)
  where other_dept is not null;

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
       contingency_pct, contingency_amt, gst_pct, gst_amt,
       other_dept, other_dept_note, other_dept_set_by, other_dept_set_at
from grouped g;
