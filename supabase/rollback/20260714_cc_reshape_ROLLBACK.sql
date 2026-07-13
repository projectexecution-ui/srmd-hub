-- ROLLBACK for 20260714_cc_reshape_stage1_enum + stage2 (CC reshape v2).
-- Run top to bottom. Notes:
--   • the 'billing' enum value cannot be dropped — it stays in user_role,
--     which is harmless (inert) once the label/permission rows are gone.
--     Reassign any billing users to 'viewer' first if fully retiring it.
--   • cc_ws_with_versions was never recreated, so dropping the columns is safe.

-- Comments
drop policy if exists cc_ws_comments_read on public.cc_ws_comments;
drop policy if exists cc_ws_comments_insert on public.cc_ws_comments;
drop table if exists public.cc_ws_comments;

-- RPCs
drop function if exists public.cc_mark_in4_entered(uuid, text);
drop function if exists public.cc_set_project_area(uuid, numeric);

-- Restore fn_cc_user_in_project to its pre-reshape body (captured verbatim
-- from the live DB on 2026-07-13, before the billing arm was added).
create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from project_assignments
    where user_id = p_user and project_id = p_project
  )
  or fn_cc_is_admin(p_user)
  or exists (
    select 1 from role_permissions rp
    join profiles pro on pro.role::text = rp.role::text
    where pro.id = p_user
      and rp.module_slug = 'cost-control'
      and rp.can_admin = true
  );
$$;

drop function if exists public.fn_cc_is_reviewer(uuid);

-- Columns
alter table public.cc_working_sheets
  drop column if exists ph_checked_amt,
  drop column if exists ph_checked_at,
  drop column if exists ph_checked_by,
  drop column if exists atm_checked_amt,
  drop column if exists atm_checked_at,
  drop column if exists atm_checked_by,
  drop column if exists in4_entered_at,
  drop column if exists in4_entered_by,
  drop column if exists in4_ref;

-- Billing role seeds
update public.role_labels set is_active = false where role = 'billing';
delete from public.role_permissions where role = 'billing';

-- CC settings keys written by the settings page
delete from public.app_settings where key in (
  'cc_show_deadlines', 'cc_show_erp_columns', 'cc_show_per_sft', 'cc_ai_tools',
  'cc_comments', 'cc_billing_step',
  'cc_label_ph_checked', 'cc_label_atm_checked', 'cc_label_approved');
