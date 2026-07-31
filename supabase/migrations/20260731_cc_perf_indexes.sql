-- Performance: cover the foreign keys that Cost Control actually filters/joins
-- on. These are the columns behind the sequential scans on cc_working_sheets
-- and the per-sheet item joins. Additive + invisible: no data, behaviour, or
-- access changes — only faster lookups. Audit-only FKs (approved_by, locked_by,
-- returned_by, …) are intentionally skipped; they are never filtered, so an
-- index there would only slow writes.

create index if not exists idx_cc_ws_sub_skill        on public.cc_working_sheets (sub_skill_id);
create index if not exists idx_cc_ws_discipline        on public.cc_working_sheets (discipline_id);
create index if not exists idx_cc_wsi_working_sheet     on public.cc_working_sheet_items (working_sheet_id);
create index if not exists idx_cc_pss_sub_skill         on public.cc_project_sub_skills (sub_skill_id);
create index if not exists idx_cc_pd_discipline         on public.cc_project_disciplines (discipline_id);
create index if not exists idx_cc_ssa_sub_skill         on public.cc_subskill_assignments (sub_skill_id);
create index if not exists idx_cc_budget_events_bl      on public.cc_budget_events (related_budget_line_id);
create index if not exists idx_notif_deliveries_notif   on public.notification_deliveries (notification_id);
