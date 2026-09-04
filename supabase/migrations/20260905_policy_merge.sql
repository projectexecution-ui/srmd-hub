-- Generated 5 Sept 2026 from pg_policies on the live database.
-- Supabase's performance advisor listed 245 "multiple permissive policies":
-- the same action on the same table covered by two policies (typically a
-- *_read SELECT policy plus a *_write FOR ALL policy), so Postgres evaluates
-- both on every row. For each affected table and role set this drops the
-- group and recreates ONE policy per action whose expression is the OR of the
-- originals — the same rows are allowed, checked once. Nothing about WHO may
-- do WHAT changes. Rollback: supabase/rollback/20260905_policy_merge_rollback.sql
-- recreates every dropped policy verbatim.

-- ── allowed_emails ──
drop policy if exists "allowed_emails_read" on public."allowed_emails";
drop policy if exists "allowed_emails_write" on public."allowed_emails";
drop policy if exists "allowed_emails_select_merged" on public."allowed_emails";
create policy "allowed_emails_select_merged" on public."allowed_emails" for select to authenticated
  using ((((email = lower(( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "allowed_emails_insert_merged" on public."allowed_emails";
create policy "allowed_emails_insert_merged" on public."allowed_emails" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "allowed_emails_update_merged" on public."allowed_emails";
create policy "allowed_emails_update_merged" on public."allowed_emails" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "allowed_emails_delete_merged" on public."allowed_emails";
create policy "allowed_emails_delete_merged" on public."allowed_emails" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));

-- ── app_settings ──
drop policy if exists "admin can insert app_settings" on public."app_settings";
drop policy if exists "admin can update app_settings" on public."app_settings";
drop policy if exists "anyone can read app_settings" on public."app_settings";
drop policy if exists "portal owner can update app_settings" on public."app_settings";
drop policy if exists "app_settings_select_merged" on public."app_settings";
create policy "app_settings_select_merged" on public."app_settings" for select to authenticated
  using ((true));
drop policy if exists "app_settings_insert_merged" on public."app_settings";
create policy "app_settings_insert_merged" on public."app_settings" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role)::text = 'admin'::text) OR (p.is_portal_owner = true)))))));
drop policy if exists "app_settings_update_merged" on public."app_settings";
create policy "app_settings_update_merged" on public."app_settings" for update to authenticated
  using (((current_user_role() = 'admin'::user_role)) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_portal_owner = true))))))
  with check (((current_user_role() = 'admin'::user_role)) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_portal_owner = true))))));

-- ── approval_rules ──
drop policy if exists "approval_rules_read" on public."approval_rules";
drop policy if exists "approval_rules_write" on public."approval_rules";
drop policy if exists "approval_rules_select_merged" on public."approval_rules";
create policy "approval_rules_select_merged" on public."approval_rules" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "approval_rules_insert_merged" on public."approval_rules";
create policy "approval_rules_insert_merged" on public."approval_rules" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "approval_rules_update_merged" on public."approval_rules";
create policy "approval_rules_update_merged" on public."approval_rules" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "approval_rules_delete_merged" on public."approval_rules";
create policy "approval_rules_delete_merged" on public."approval_rules" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── approval_stages ──
drop policy if exists "approval_stages_read" on public."approval_stages";
drop policy if exists "approval_stages_write" on public."approval_stages";
drop policy if exists "approval_stages_select_merged" on public."approval_stages";
create policy "approval_stages_select_merged" on public."approval_stages" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "approval_stages_insert_merged" on public."approval_stages";
create policy "approval_stages_insert_merged" on public."approval_stages" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "approval_stages_update_merged" on public."approval_stages";
create policy "approval_stages_update_merged" on public."approval_stages" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "approval_stages_delete_merged" on public."approval_stages";
create policy "approval_stages_delete_merged" on public."approval_stages" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));

-- ── blueprint_demo_requests ──
drop policy if exists "bd_req_read" on public."blueprint_demo_requests";
drop policy if exists "bd_req_write" on public."blueprint_demo_requests";
drop policy if exists "blueprint_demo_requests_select_merged" on public."blueprint_demo_requests";
create policy "blueprint_demo_requests_select_merged" on public."blueprint_demo_requests" for select to authenticated
  using ((true));
drop policy if exists "blueprint_demo_requests_insert_merged" on public."blueprint_demo_requests";
create policy "blueprint_demo_requests_insert_merged" on public."blueprint_demo_requests" for insert to authenticated
  with check ((true));
drop policy if exists "blueprint_demo_requests_update_merged" on public."blueprint_demo_requests";
create policy "blueprint_demo_requests_update_merged" on public."blueprint_demo_requests" for update to authenticated
  using ((true))
  with check ((true));
drop policy if exists "blueprint_demo_requests_delete_merged" on public."blueprint_demo_requests";
create policy "blueprint_demo_requests_delete_merged" on public."blueprint_demo_requests" for delete to authenticated
  using ((true));

-- ── budget_v2_alias ──
drop policy if exists "bv2_alias_read" on public."budget_v2_alias";
drop policy if exists "bv2_alias_write" on public."budget_v2_alias";
drop policy if exists "budget_v2_alias_select_merged" on public."budget_v2_alias";
create policy "budget_v2_alias_select_merged" on public."budget_v2_alias" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_alias_insert_merged" on public."budget_v2_alias";
create policy "budget_v2_alias_insert_merged" on public."budget_v2_alias" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_alias_update_merged" on public."budget_v2_alias";
create policy "budget_v2_alias_update_merged" on public."budget_v2_alias" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_alias_delete_merged" on public."budget_v2_alias";
create policy "budget_v2_alias_delete_merged" on public."budget_v2_alias" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── budget_v2_extra_project ──
drop policy if exists "bv2_extra_read" on public."budget_v2_extra_project";
drop policy if exists "bv2_extra_write" on public."budget_v2_extra_project";
drop policy if exists "budget_v2_extra_project_select_merged" on public."budget_v2_extra_project";
create policy "budget_v2_extra_project_select_merged" on public."budget_v2_extra_project" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_extra_project_insert_merged" on public."budget_v2_extra_project";
create policy "budget_v2_extra_project_insert_merged" on public."budget_v2_extra_project" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_extra_project_update_merged" on public."budget_v2_extra_project";
create policy "budget_v2_extra_project_update_merged" on public."budget_v2_extra_project" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_extra_project_delete_merged" on public."budget_v2_extra_project";
create policy "budget_v2_extra_project_delete_merged" on public."budget_v2_extra_project" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── budget_v2_override ──
drop policy if exists "bv2_override_read" on public."budget_v2_override";
drop policy if exists "bv2_override_write" on public."budget_v2_override";
drop policy if exists "budget_v2_override_select_merged" on public."budget_v2_override";
create policy "budget_v2_override_select_merged" on public."budget_v2_override" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_override_insert_merged" on public."budget_v2_override";
create policy "budget_v2_override_insert_merged" on public."budget_v2_override" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_override_update_merged" on public."budget_v2_override";
create policy "budget_v2_override_update_merged" on public."budget_v2_override" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_override_delete_merged" on public."budget_v2_override";
create policy "budget_v2_override_delete_merged" on public."budget_v2_override" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── budget_v2_project_area ──
drop policy if exists "bv2_area_read" on public."budget_v2_project_area";
drop policy if exists "bv2_area_write" on public."budget_v2_project_area";
drop policy if exists "budget_v2_project_area_select_merged" on public."budget_v2_project_area";
create policy "budget_v2_project_area_select_merged" on public."budget_v2_project_area" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_area_insert_merged" on public."budget_v2_project_area";
create policy "budget_v2_project_area_insert_merged" on public."budget_v2_project_area" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_area_update_merged" on public."budget_v2_project_area";
create policy "budget_v2_project_area_update_merged" on public."budget_v2_project_area" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_area_delete_merged" on public."budget_v2_project_area";
create policy "budget_v2_project_area_delete_merged" on public."budget_v2_project_area" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── budget_v2_project_status ──
drop policy if exists "bv2_status_read" on public."budget_v2_project_status";
drop policy if exists "bv2_status_write" on public."budget_v2_project_status";
drop policy if exists "budget_v2_project_status_select_merged" on public."budget_v2_project_status";
create policy "budget_v2_project_status_select_merged" on public."budget_v2_project_status" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_status_insert_merged" on public."budget_v2_project_status";
create policy "budget_v2_project_status_insert_merged" on public."budget_v2_project_status" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_status_update_merged" on public."budget_v2_project_status";
create policy "budget_v2_project_status_update_merged" on public."budget_v2_project_status" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_project_status_delete_merged" on public."budget_v2_project_status";
create policy "budget_v2_project_status_delete_merged" on public."budget_v2_project_status" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── budget_v2_weekly_snapshot ──
drop policy if exists "bv2_snap_read" on public."budget_v2_weekly_snapshot";
drop policy if exists "bv2_snap_write" on public."budget_v2_weekly_snapshot";
drop policy if exists "budget_v2_weekly_snapshot_select_merged" on public."budget_v2_weekly_snapshot";
create policy "budget_v2_weekly_snapshot_select_merged" on public."budget_v2_weekly_snapshot" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_weekly_snapshot_insert_merged" on public."budget_v2_weekly_snapshot";
create policy "budget_v2_weekly_snapshot_insert_merged" on public."budget_v2_weekly_snapshot" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_weekly_snapshot_update_merged" on public."budget_v2_weekly_snapshot";
create policy "budget_v2_weekly_snapshot_update_merged" on public."budget_v2_weekly_snapshot" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "budget_v2_weekly_snapshot_delete_merged" on public."budget_v2_weekly_snapshot";
create policy "budget_v2_weekly_snapshot_delete_merged" on public."budget_v2_weekly_snapshot" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── cc_approval_thresholds ──
drop policy if exists "cc_at_admin_write" on public."cc_approval_thresholds";
drop policy if exists "cc_at_read" on public."cc_approval_thresholds";
drop policy if exists "cc_approval_thresholds_select_merged" on public."cc_approval_thresholds";
create policy "cc_approval_thresholds_select_merged" on public."cc_approval_thresholds" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (true));
drop policy if exists "cc_approval_thresholds_insert_merged" on public."cc_approval_thresholds";
create policy "cc_approval_thresholds_insert_merged" on public."cc_approval_thresholds" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_approval_thresholds_update_merged" on public."cc_approval_thresholds";
create policy "cc_approval_thresholds_update_merged" on public."cc_approval_thresholds" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_approval_thresholds_delete_merged" on public."cc_approval_thresholds";
create policy "cc_approval_thresholds_delete_merged" on public."cc_approval_thresholds" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── cc_bills ──
drop policy if exists "cc_bills_read" on public."cc_bills";
drop policy if exists "cc_bills_write" on public."cc_bills";
drop policy if exists "cc_bills_select_merged" on public."cc_bills";
create policy "cc_bills_select_merged" on public."cc_bills" for select to authenticated
  using ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
drop policy if exists "cc_bills_insert_merged" on public."cc_bills";
create policy "cc_bills_insert_merged" on public."cc_bills" for insert to authenticated
  with check ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
drop policy if exists "cc_bills_update_merged" on public."cc_bills";
create policy "cc_bills_update_merged" on public."cc_bills" for update to authenticated
  using ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)))
  with check ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
drop policy if exists "cc_bills_delete_merged" on public."cc_bills";
create policy "cc_bills_delete_merged" on public."cc_bills" for delete to authenticated
  using ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));

-- ── cc_budget_lines ──
drop policy if exists "cc_bl_admin_write" on public."cc_budget_lines";
drop policy if exists "cc_bl_read" on public."cc_budget_lines";
drop policy if exists "cc_budget_lines_select_merged" on public."cc_budget_lines";
create policy "cc_budget_lines_select_merged" on public."cc_budget_lines" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
drop policy if exists "cc_budget_lines_insert_merged" on public."cc_budget_lines";
create policy "cc_budget_lines_insert_merged" on public."cc_budget_lines" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_budget_lines_update_merged" on public."cc_budget_lines";
create policy "cc_budget_lines_update_merged" on public."cc_budget_lines" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_budget_lines_delete_merged" on public."cc_budget_lines";
create policy "cc_budget_lines_delete_merged" on public."cc_budget_lines" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── cc_discipline_approvers ──
drop policy if exists "cc_da_admin_write" on public."cc_discipline_approvers";
drop policy if exists "cc_da_read" on public."cc_discipline_approvers";
drop policy if exists "cc_discipline_approvers_select_merged" on public."cc_discipline_approvers";
create policy "cc_discipline_approvers_select_merged" on public."cc_discipline_approvers" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (true));
drop policy if exists "cc_discipline_approvers_insert_merged" on public."cc_discipline_approvers";
create policy "cc_discipline_approvers_insert_merged" on public."cc_discipline_approvers" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_discipline_approvers_update_merged" on public."cc_discipline_approvers";
create policy "cc_discipline_approvers_update_merged" on public."cc_discipline_approvers" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_discipline_approvers_delete_merged" on public."cc_discipline_approvers";
create policy "cc_discipline_approvers_delete_merged" on public."cc_discipline_approvers" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── cc_disciplines ──
drop policy if exists "cc_disciplines_admin_write" on public."cc_disciplines";
drop policy if exists "cc_disciplines_read" on public."cc_disciplines";
drop policy if exists "cc_disciplines_select_merged" on public."cc_disciplines";
create policy "cc_disciplines_select_merged" on public."cc_disciplines" for select to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))) OR (true));
drop policy if exists "cc_disciplines_insert_merged" on public."cc_disciplines";
create policy "cc_disciplines_insert_merged" on public."cc_disciplines" for insert to authenticated
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "cc_disciplines_update_merged" on public."cc_disciplines";
create policy "cc_disciplines_update_merged" on public."cc_disciplines" for update to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))))
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "cc_disciplines_delete_merged" on public."cc_disciplines";
create policy "cc_disciplines_delete_merged" on public."cc_disciplines" for delete to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));

-- ── cc_excel_imports ──
drop policy if exists "cc_ei_read" on public."cc_excel_imports";
drop policy if exists "cc_ei_write" on public."cc_excel_imports";
drop policy if exists "cc_excel_imports_select_merged" on public."cc_excel_imports";
create policy "cc_excel_imports_select_merged" on public."cc_excel_imports" for select to authenticated
  using ((((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))));
drop policy if exists "cc_excel_imports_insert_merged" on public."cc_excel_imports";
create policy "cc_excel_imports_insert_merged" on public."cc_excel_imports" for insert to authenticated
  with check ((((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))));
drop policy if exists "cc_excel_imports_update_merged" on public."cc_excel_imports";
create policy "cc_excel_imports_update_merged" on public."cc_excel_imports" for update to authenticated
  using ((((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))))
  with check ((((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))));
drop policy if exists "cc_excel_imports_delete_merged" on public."cc_excel_imports";
create policy "cc_excel_imports_delete_merged" on public."cc_excel_imports" for delete to authenticated
  using ((((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))));

-- ── cc_excel_rows ──
drop policy if exists "cc_excel_rows_read" on public."cc_excel_rows";
drop policy if exists "cc_excel_rows_write" on public."cc_excel_rows";
drop policy if exists "cc_excel_rows_select_merged" on public."cc_excel_rows";
create policy "cc_excel_rows_select_merged" on public."cc_excel_rows" for select to authenticated
  using (((fn_cc_can_view(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))) OR ((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))));
drop policy if exists "cc_excel_rows_insert_merged" on public."cc_excel_rows";
create policy "cc_excel_rows_insert_merged" on public."cc_excel_rows" for insert to authenticated
  with check (((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))));
drop policy if exists "cc_excel_rows_update_merged" on public."cc_excel_rows";
create policy "cc_excel_rows_update_merged" on public."cc_excel_rows" for update to authenticated
  using (((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))))
  with check (((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))));
drop policy if exists "cc_excel_rows_delete_merged" on public."cc_excel_rows";
create policy "cc_excel_rows_delete_merged" on public."cc_excel_rows" for delete to authenticated
  using (((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))))));

-- ── cc_notification_rules ──
drop policy if exists "cc_nr_admin_write" on public."cc_notification_rules";
drop policy if exists "cc_nr_read" on public."cc_notification_rules";
drop policy if exists "cc_notification_rules_select_merged" on public."cc_notification_rules";
create policy "cc_notification_rules_select_merged" on public."cc_notification_rules" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (true));
drop policy if exists "cc_notification_rules_insert_merged" on public."cc_notification_rules";
create policy "cc_notification_rules_insert_merged" on public."cc_notification_rules" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_notification_rules_update_merged" on public."cc_notification_rules";
create policy "cc_notification_rules_update_merged" on public."cc_notification_rules" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_notification_rules_delete_merged" on public."cc_notification_rules";
create policy "cc_notification_rules_delete_merged" on public."cc_notification_rules" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── cc_payments ──
drop policy if exists "cc_pay_read" on public."cc_payments";
drop policy if exists "cc_pay_write" on public."cc_payments";
drop policy if exists "cc_payments_select_merged" on public."cc_payments";
create policy "cc_payments_select_merged" on public."cc_payments" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id))))));
drop policy if exists "cc_payments_insert_merged" on public."cc_payments";
create policy "cc_payments_insert_merged" on public."cc_payments" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id))))));
drop policy if exists "cc_payments_update_merged" on public."cc_payments";
create policy "cc_payments_update_merged" on public."cc_payments" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id))))))
  with check (((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id))))));
drop policy if exists "cc_payments_delete_merged" on public."cc_payments";
create policy "cc_payments_delete_merged" on public."cc_payments" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id))))));

-- ── cc_project_disciplines ──
drop policy if exists "cc_proj_disc_read" on public."cc_project_disciplines";
drop policy if exists "cc_proj_disc_write" on public."cc_project_disciplines";
drop policy if exists "cc_project_disciplines_select_merged" on public."cc_project_disciplines";
create policy "cc_project_disciplines_select_merged" on public."cc_project_disciplines" for select to authenticated
  using ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)) OR ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_disciplines_insert_merged" on public."cc_project_disciplines";
create policy "cc_project_disciplines_insert_merged" on public."cc_project_disciplines" for insert to authenticated
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_disciplines_update_merged" on public."cc_project_disciplines";
create policy "cc_project_disciplines_update_merged" on public."cc_project_disciplines" for update to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))))
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_disciplines_delete_merged" on public."cc_project_disciplines";
create policy "cc_project_disciplines_delete_merged" on public."cc_project_disciplines" for delete to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));

-- ── cc_project_sub_skills ──
drop policy if exists "cc_proj_ss_read" on public."cc_project_sub_skills";
drop policy if exists "cc_proj_ss_write" on public."cc_project_sub_skills";
drop policy if exists "cc_project_sub_skills_select_merged" on public."cc_project_sub_skills";
create policy "cc_project_sub_skills_select_merged" on public."cc_project_sub_skills" for select to authenticated
  using ((fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)) OR ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_sub_skills_insert_merged" on public."cc_project_sub_skills";
create policy "cc_project_sub_skills_insert_merged" on public."cc_project_sub_skills" for insert to authenticated
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_sub_skills_update_merged" on public."cc_project_sub_skills";
create policy "cc_project_sub_skills_update_merged" on public."cc_project_sub_skills" for update to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))))
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_project_sub_skills_delete_merged" on public."cc_project_sub_skills";
create policy "cc_project_sub_skills_delete_merged" on public."cc_project_sub_skills" for delete to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid))))))));

-- ── cc_qty_templates ──
drop policy if exists "cc_qt_admin_write" on public."cc_qty_templates";
drop policy if exists "cc_qt_read" on public."cc_qty_templates";
drop policy if exists "cc_qty_templates_select_merged" on public."cc_qty_templates";
create policy "cc_qty_templates_select_merged" on public."cc_qty_templates" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (((is_active = true) OR fn_cc_is_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "cc_qty_templates_insert_merged" on public."cc_qty_templates";
create policy "cc_qty_templates_insert_merged" on public."cc_qty_templates" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_qty_templates_update_merged" on public."cc_qty_templates";
create policy "cc_qty_templates_update_merged" on public."cc_qty_templates" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "cc_qty_templates_delete_merged" on public."cc_qty_templates";
create policy "cc_qty_templates_delete_merged" on public."cc_qty_templates" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── cc_sub_skills ──
drop policy if exists "cc_sub_skills_admin_write" on public."cc_sub_skills";
drop policy if exists "cc_sub_skills_read" on public."cc_sub_skills";
drop policy if exists "cc_sub_skills_select_merged" on public."cc_sub_skills";
create policy "cc_sub_skills_select_merged" on public."cc_sub_skills" for select to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))) OR (true));
drop policy if exists "cc_sub_skills_insert_merged" on public."cc_sub_skills";
create policy "cc_sub_skills_insert_merged" on public."cc_sub_skills" for insert to authenticated
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "cc_sub_skills_update_merged" on public."cc_sub_skills";
create policy "cc_sub_skills_update_merged" on public."cc_sub_skills" for update to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))))
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "cc_sub_skills_delete_merged" on public."cc_sub_skills";
create policy "cc_sub_skills_delete_merged" on public."cc_sub_skills" for delete to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));

-- ── cc_working_sheet_items ──
drop policy if exists "cc_wsi_read" on public."cc_working_sheet_items";
drop policy if exists "cc_wsi_write" on public."cc_working_sheet_items";
drop policy if exists "cc_working_sheet_items_select_merged" on public."cc_working_sheet_items";
create policy "cc_working_sheet_items_select_merged" on public."cc_working_sheet_items" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))) OR ((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_working_sheet_items_insert_merged" on public."cc_working_sheet_items";
create policy "cc_working_sheet_items_insert_merged" on public."cc_working_sheet_items" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_working_sheet_items_update_merged" on public."cc_working_sheet_items";
create policy "cc_working_sheet_items_update_merged" on public."cc_working_sheet_items" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid))))))))
  with check (((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid))))))));
drop policy if exists "cc_working_sheet_items_delete_merged" on public."cc_working_sheet_items";
create policy "cc_working_sheet_items_delete_merged" on public."cc_working_sheet_items" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid))))))));

-- ── cc_ws_item_qty_rows ──
drop policy if exists "cc_qr_read" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_qr_write" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_ws_item_qty_rows_select_merged" on public."cc_ws_item_qty_rows";
create policy "cc_ws_item_qty_rows_select_merged" on public."cc_ws_item_qty_rows" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))) OR ((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_rows_insert_merged" on public."cc_ws_item_qty_rows";
create policy "cc_ws_item_qty_rows_insert_merged" on public."cc_ws_item_qty_rows" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_rows_update_merged" on public."cc_ws_item_qty_rows";
create policy "cc_ws_item_qty_rows_update_merged" on public."cc_ws_item_qty_rows" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))))
  with check (((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_rows_delete_merged" on public."cc_ws_item_qty_rows";
create policy "cc_ws_item_qty_rows_delete_merged" on public."cc_ws_item_qty_rows" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));

-- ── cc_ws_item_qty_sections ──
drop policy if exists "cc_qs_read" on public."cc_ws_item_qty_sections";
drop policy if exists "cc_qs_write" on public."cc_ws_item_qty_sections";
drop policy if exists "cc_ws_item_qty_sections_select_merged" on public."cc_ws_item_qty_sections";
create policy "cc_ws_item_qty_sections_select_merged" on public."cc_ws_item_qty_sections" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id))))) OR ((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_sections_insert_merged" on public."cc_ws_item_qty_sections";
create policy "cc_ws_item_qty_sections_insert_merged" on public."cc_ws_item_qty_sections" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_sections_update_merged" on public."cc_ws_item_qty_sections";
create policy "cc_ws_item_qty_sections_update_merged" on public."cc_ws_item_qty_sections" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))))
  with check (((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));
drop policy if exists "cc_ws_item_qty_sections_delete_merged" on public."cc_ws_item_qty_sections";
create policy "cc_ws_item_qty_sections_delete_merged" on public."cc_ws_item_qty_sections" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id)))))));

-- ── cmp_comparisons ──
drop policy if exists "cmp_comparisons_read" on public."cmp_comparisons";
drop policy if exists "cmp_comparisons_write" on public."cmp_comparisons";
drop policy if exists "cmp_comparisons_select_merged" on public."cmp_comparisons";
create policy "cmp_comparisons_select_merged" on public."cmp_comparisons" for select to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_comparisons_insert_merged" on public."cmp_comparisons";
create policy "cmp_comparisons_insert_merged" on public."cmp_comparisons" for insert to authenticated
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_comparisons_update_merged" on public."cmp_comparisons";
create policy "cmp_comparisons_update_merged" on public."cmp_comparisons" for update to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))))
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_comparisons_delete_merged" on public."cmp_comparisons";
create policy "cmp_comparisons_delete_merged" on public."cmp_comparisons" for delete to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));

-- ── cmp_items ──
drop policy if exists "cmp_items_read" on public."cmp_items";
drop policy if exists "cmp_items_write" on public."cmp_items";
drop policy if exists "cmp_items_select_merged" on public."cmp_items";
create policy "cmp_items_select_merged" on public."cmp_items" for select to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_items_insert_merged" on public."cmp_items";
create policy "cmp_items_insert_merged" on public."cmp_items" for insert to authenticated
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_items_update_merged" on public."cmp_items";
create policy "cmp_items_update_merged" on public."cmp_items" for update to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))))
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_items_delete_merged" on public."cmp_items";
create policy "cmp_items_delete_merged" on public."cmp_items" for delete to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));

-- ── cmp_quotes ──
drop policy if exists "cmp_quotes_read" on public."cmp_quotes";
drop policy if exists "cmp_quotes_write" on public."cmp_quotes";
drop policy if exists "cmp_quotes_select_merged" on public."cmp_quotes";
create policy "cmp_quotes_select_merged" on public."cmp_quotes" for select to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_quotes_insert_merged" on public."cmp_quotes";
create policy "cmp_quotes_insert_merged" on public."cmp_quotes" for insert to authenticated
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_quotes_update_merged" on public."cmp_quotes";
create policy "cmp_quotes_update_merged" on public."cmp_quotes" for update to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))))
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_quotes_delete_merged" on public."cmp_quotes";
create policy "cmp_quotes_delete_merged" on public."cmp_quotes" for delete to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));

-- ── cmp_vendors ──
drop policy if exists "cmp_vendors_read" on public."cmp_vendors";
drop policy if exists "cmp_vendors_write" on public."cmp_vendors";
drop policy if exists "cmp_vendors_select_merged" on public."cmp_vendors";
create policy "cmp_vendors_select_merged" on public."cmp_vendors" for select to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_vendors_insert_merged" on public."cmp_vendors";
create policy "cmp_vendors_insert_merged" on public."cmp_vendors" for insert to authenticated
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_vendors_update_merged" on public."cmp_vendors";
create policy "cmp_vendors_update_merged" on public."cmp_vendors" for update to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))))
  with check ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));
drop policy if exists "cmp_vendors_delete_merged" on public."cmp_vendors";
create policy "cmp_vendors_delete_merged" on public."cmp_vendors" for delete to authenticated
  using ((((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))));

-- ── dsr_tracking ──
drop policy if exists "dsr_tracking_select" on public."dsr_tracking";
drop policy if exists "dsr_tracking_write" on public."dsr_tracking";
drop policy if exists "dsr_tracking_select_merged" on public."dsr_tracking";
create policy "dsr_tracking_select_merged" on public."dsr_tracking" for select to authenticated
  using (((dsr_is_management() OR (EXISTS ( SELECT 1
   FROM dsr_reports r
  WHERE ((r.id = dsr_tracking.report_id) AND (r.created_by = ( SELECT auth.uid() AS uid))))))) OR (dsr_is_management()));
drop policy if exists "dsr_tracking_insert_merged" on public."dsr_tracking";
create policy "dsr_tracking_insert_merged" on public."dsr_tracking" for insert to authenticated
  with check ((dsr_is_management()));
drop policy if exists "dsr_tracking_update_merged" on public."dsr_tracking";
create policy "dsr_tracking_update_merged" on public."dsr_tracking" for update to authenticated
  using ((dsr_is_management()))
  with check ((dsr_is_management()));
drop policy if exists "dsr_tracking_delete_merged" on public."dsr_tracking";
create policy "dsr_tracking_delete_merged" on public."dsr_tracking" for delete to authenticated
  using ((dsr_is_management()));

-- ── est_categories ──
drop policy if exists "est_categories_read" on public."est_categories";
drop policy if exists "est_categories_write" on public."est_categories";
drop policy if exists "est_categories_select_merged" on public."est_categories";
create policy "est_categories_select_merged" on public."est_categories" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_categories_insert_merged" on public."est_categories";
create policy "est_categories_insert_merged" on public."est_categories" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_categories_update_merged" on public."est_categories";
create policy "est_categories_update_merged" on public."est_categories" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_categories_delete_merged" on public."est_categories";
create policy "est_categories_delete_merged" on public."est_categories" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── est_disciplines ──
drop policy if exists "est_disciplines_read" on public."est_disciplines";
drop policy if exists "est_disciplines_write" on public."est_disciplines";
drop policy if exists "est_disciplines_select_merged" on public."est_disciplines";
create policy "est_disciplines_select_merged" on public."est_disciplines" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_disciplines_insert_merged" on public."est_disciplines";
create policy "est_disciplines_insert_merged" on public."est_disciplines" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_disciplines_update_merged" on public."est_disciplines";
create policy "est_disciplines_update_merged" on public."est_disciplines" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_disciplines_delete_merged" on public."est_disciplines";
create policy "est_disciplines_delete_merged" on public."est_disciplines" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── est_rates ──
drop policy if exists "est_rates_read" on public."est_rates";
drop policy if exists "est_rates_write" on public."est_rates";
drop policy if exists "est_rates_select_merged" on public."est_rates";
create policy "est_rates_select_merged" on public."est_rates" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_rates_insert_merged" on public."est_rates";
create policy "est_rates_insert_merged" on public."est_rates" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_rates_update_merged" on public."est_rates";
create policy "est_rates_update_merged" on public."est_rates" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_rates_delete_merged" on public."est_rates";
create policy "est_rates_delete_merged" on public."est_rates" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── est_subcategories ──
drop policy if exists "est_subcategories_read" on public."est_subcategories";
drop policy if exists "est_subcategories_write" on public."est_subcategories";
drop policy if exists "est_subcategories_select_merged" on public."est_subcategories";
create policy "est_subcategories_select_merged" on public."est_subcategories" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_subcategories_insert_merged" on public."est_subcategories";
create policy "est_subcategories_insert_merged" on public."est_subcategories" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_subcategories_update_merged" on public."est_subcategories";
create policy "est_subcategories_update_merged" on public."est_subcategories" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_subcategories_delete_merged" on public."est_subcategories";
create policy "est_subcategories_delete_merged" on public."est_subcategories" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── est_upload_log ──
drop policy if exists "est_upload_log_read" on public."est_upload_log";
drop policy if exists "est_upload_log_write" on public."est_upload_log";
drop policy if exists "est_upload_log_select_merged" on public."est_upload_log";
create policy "est_upload_log_select_merged" on public."est_upload_log" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_upload_log_insert_merged" on public."est_upload_log";
create policy "est_upload_log_insert_merged" on public."est_upload_log" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_upload_log_update_merged" on public."est_upload_log";
create policy "est_upload_log_update_merged" on public."est_upload_log" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_upload_log_delete_merged" on public."est_upload_log";
create policy "est_upload_log_delete_merged" on public."est_upload_log" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── est_wo_history ──
drop policy if exists "est_wo_history_read" on public."est_wo_history";
drop policy if exists "est_wo_history_write" on public."est_wo_history";
drop policy if exists "est_wo_history_select_merged" on public."est_wo_history";
create policy "est_wo_history_select_merged" on public."est_wo_history" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_wo_history_insert_merged" on public."est_wo_history";
create policy "est_wo_history_insert_merged" on public."est_wo_history" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_wo_history_update_merged" on public."est_wo_history";
create policy "est_wo_history_update_merged" on public."est_wo_history" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "est_wo_history_delete_merged" on public."est_wo_history";
create policy "est_wo_history_delete_merged" on public."est_wo_history" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── in4_subproject_links ──
drop policy if exists "in4_subproject_links_admin_write" on public."in4_subproject_links";
drop policy if exists "in4_subproject_links_read" on public."in4_subproject_links";
drop policy if exists "in4_subproject_links_select_merged" on public."in4_subproject_links";
create policy "in4_subproject_links_select_merged" on public."in4_subproject_links" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "in4_subproject_links_insert_merged" on public."in4_subproject_links";
create policy "in4_subproject_links_insert_merged" on public."in4_subproject_links" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "in4_subproject_links_update_merged" on public."in4_subproject_links";
create policy "in4_subproject_links_update_merged" on public."in4_subproject_links" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "in4_subproject_links_delete_merged" on public."in4_subproject_links";
create policy "in4_subproject_links_delete_merged" on public."in4_subproject_links" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── inv_engineer_projects ──
drop policy if exists "inv_engineer_projects_read" on public."inv_engineer_projects";
drop policy if exists "inv_engineer_projects_write_editor" on public."inv_engineer_projects";
drop policy if exists "inv_engineer_projects_select_merged" on public."inv_engineer_projects";
create policy "inv_engineer_projects_select_merged" on public."inv_engineer_projects" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_engineer_projects_insert_merged" on public."inv_engineer_projects";
create policy "inv_engineer_projects_insert_merged" on public."inv_engineer_projects" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_engineer_projects_update_merged" on public."inv_engineer_projects";
create policy "inv_engineer_projects_update_merged" on public."inv_engineer_projects" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_engineer_projects_delete_merged" on public."inv_engineer_projects";
create policy "inv_engineer_projects_delete_merged" on public."inv_engineer_projects" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_items ──
drop policy if exists "inv_items_read" on public."inv_items";
drop policy if exists "inv_items_write_editor" on public."inv_items";
drop policy if exists "inv_items_select_merged" on public."inv_items";
create policy "inv_items_select_merged" on public."inv_items" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_items_insert_merged" on public."inv_items";
create policy "inv_items_insert_merged" on public."inv_items" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_items_update_merged" on public."inv_items";
create policy "inv_items_update_merged" on public."inv_items" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_items_delete_merged" on public."inv_items";
create policy "inv_items_delete_merged" on public."inv_items" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_project_setup ──
drop policy if exists "inv_project_setup_read" on public."inv_project_setup";
drop policy if exists "inv_project_setup_write_editor" on public."inv_project_setup";
drop policy if exists "inv_project_setup_select_merged" on public."inv_project_setup";
create policy "inv_project_setup_select_merged" on public."inv_project_setup" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_project_setup_insert_merged" on public."inv_project_setup";
create policy "inv_project_setup_insert_merged" on public."inv_project_setup" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_project_setup_update_merged" on public."inv_project_setup";
create policy "inv_project_setup_update_merged" on public."inv_project_setup" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_project_setup_delete_merged" on public."inv_project_setup";
create policy "inv_project_setup_delete_merged" on public."inv_project_setup" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_request_items ──
drop policy if exists "inv_request_items_read" on public."inv_request_items";
drop policy if exists "inv_request_items_write_editor" on public."inv_request_items";
drop policy if exists "inv_request_items_select_merged" on public."inv_request_items";
create policy "inv_request_items_select_merged" on public."inv_request_items" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_items_insert_merged" on public."inv_request_items";
create policy "inv_request_items_insert_merged" on public."inv_request_items" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_items_update_merged" on public."inv_request_items";
create policy "inv_request_items_update_merged" on public."inv_request_items" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_items_delete_merged" on public."inv_request_items";
create policy "inv_request_items_delete_merged" on public."inv_request_items" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_request_status_log ──
drop policy if exists "inv_request_status_log_read" on public."inv_request_status_log";
drop policy if exists "inv_request_status_log_write_editor" on public."inv_request_status_log";
drop policy if exists "inv_request_status_log_select_merged" on public."inv_request_status_log";
create policy "inv_request_status_log_select_merged" on public."inv_request_status_log" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_status_log_insert_merged" on public."inv_request_status_log";
create policy "inv_request_status_log_insert_merged" on public."inv_request_status_log" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_status_log_update_merged" on public."inv_request_status_log";
create policy "inv_request_status_log_update_merged" on public."inv_request_status_log" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_request_status_log_delete_merged" on public."inv_request_status_log";
create policy "inv_request_status_log_delete_merged" on public."inv_request_status_log" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_requests ──
drop policy if exists "inv_requests_read" on public."inv_requests";
drop policy if exists "inv_requests_write_editor" on public."inv_requests";
drop policy if exists "inv_requests_select_merged" on public."inv_requests";
create policy "inv_requests_select_merged" on public."inv_requests" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_requests_insert_merged" on public."inv_requests";
create policy "inv_requests_insert_merged" on public."inv_requests" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_requests_update_merged" on public."inv_requests";
create policy "inv_requests_update_merged" on public."inv_requests" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_requests_delete_merged" on public."inv_requests";
create policy "inv_requests_delete_merged" on public."inv_requests" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_returns ──
drop policy if exists "inv_returns_read" on public."inv_returns";
drop policy if exists "inv_returns_write_editor" on public."inv_returns";
drop policy if exists "inv_returns_select_merged" on public."inv_returns";
create policy "inv_returns_select_merged" on public."inv_returns" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_returns_insert_merged" on public."inv_returns";
create policy "inv_returns_insert_merged" on public."inv_returns" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_returns_update_merged" on public."inv_returns";
create policy "inv_returns_update_merged" on public."inv_returns" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_returns_delete_merged" on public."inv_returns";
create policy "inv_returns_delete_merged" on public."inv_returns" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_stock ──
drop policy if exists "inv_stock_read" on public."inv_stock";
drop policy if exists "inv_stock_write_editor" on public."inv_stock";
drop policy if exists "inv_stock_select_merged" on public."inv_stock";
create policy "inv_stock_select_merged" on public."inv_stock" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_insert_merged" on public."inv_stock";
create policy "inv_stock_insert_merged" on public."inv_stock" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_update_merged" on public."inv_stock";
create policy "inv_stock_update_merged" on public."inv_stock" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_delete_merged" on public."inv_stock";
create policy "inv_stock_delete_merged" on public."inv_stock" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_stock_movements ──
drop policy if exists "inv_stock_movements_read" on public."inv_stock_movements";
drop policy if exists "inv_stock_movements_write_editor" on public."inv_stock_movements";
drop policy if exists "inv_stock_movements_select_merged" on public."inv_stock_movements";
create policy "inv_stock_movements_select_merged" on public."inv_stock_movements" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_movements_insert_merged" on public."inv_stock_movements";
create policy "inv_stock_movements_insert_merged" on public."inv_stock_movements" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_movements_update_merged" on public."inv_stock_movements";
create policy "inv_stock_movements_update_merged" on public."inv_stock_movements" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_stock_movements_delete_merged" on public."inv_stock_movements";
create policy "inv_stock_movements_delete_merged" on public."inv_stock_movements" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── inv_warehouses ──
drop policy if exists "inv_warehouses_read" on public."inv_warehouses";
drop policy if exists "inv_warehouses_write_editor" on public."inv_warehouses";
drop policy if exists "inv_warehouses_select_merged" on public."inv_warehouses";
create policy "inv_warehouses_select_merged" on public."inv_warehouses" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true))))) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_warehouses_insert_merged" on public."inv_warehouses";
create policy "inv_warehouses_insert_merged" on public."inv_warehouses" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_warehouses_update_merged" on public."inv_warehouses";
create policy "inv_warehouses_update_merged" on public."inv_warehouses" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));
drop policy if exists "inv_warehouses_delete_merged" on public."inv_warehouses";
create policy "inv_warehouses_delete_merged" on public."inv_warehouses" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true))))));

-- ── jmr_contractors ──
drop policy if exists "jmr_contractors_select" on public."jmr_contractors";
drop policy if exists "jmr_contractors_write" on public."jmr_contractors";
drop policy if exists "jmr_contractors_select_merged" on public."jmr_contractors";
create policy "jmr_contractors_select_merged" on public."jmr_contractors" for select to authenticated
  using ((((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role, 'founder'::user_role, 'uploader'::user_role, 'viewer'::user_role, 'engineer'::user_role, 'site_staff'::user_role])) OR ((jmr_user_role() = 'contractor'::user_role) AND (profile_id = ( SELECT auth.uid() AS uid))))) OR ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_contractors_insert_merged" on public."jmr_contractors";
create policy "jmr_contractors_insert_merged" on public."jmr_contractors" for insert to authenticated
  with check (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_contractors_update_merged" on public."jmr_contractors";
create policy "jmr_contractors_update_merged" on public."jmr_contractors" for update to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))))
  with check (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_contractors_delete_merged" on public."jmr_contractors";
create policy "jmr_contractors_delete_merged" on public."jmr_contractors" for delete to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));

-- ── jmr_user_project_access ──
drop policy if exists "jmr_upa_select" on public."jmr_user_project_access";
drop policy if exists "jmr_upa_write" on public."jmr_user_project_access";
drop policy if exists "jmr_user_project_access_select_merged" on public."jmr_user_project_access";
create policy "jmr_user_project_access_select_merged" on public."jmr_user_project_access" for select to authenticated
  using ((((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role, 'founder'::user_role])) OR (user_id = ( SELECT auth.uid() AS uid)))) OR ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_user_project_access_insert_merged" on public."jmr_user_project_access";
create policy "jmr_user_project_access_insert_merged" on public."jmr_user_project_access" for insert to authenticated
  with check (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_user_project_access_update_merged" on public."jmr_user_project_access";
create policy "jmr_user_project_access_update_merged" on public."jmr_user_project_access" for update to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))))
  with check (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));
drop policy if exists "jmr_user_project_access_delete_merged" on public."jmr_user_project_access";
create policy "jmr_user_project_access_delete_merged" on public."jmr_user_project_access" for delete to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role]))));

-- ── master_links ──
drop policy if exists "master_links_admin_write" on public."master_links";
drop policy if exists "master_links_read" on public."master_links";
drop policy if exists "master_links_select_merged" on public."master_links";
create policy "master_links_select_merged" on public."master_links" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "master_links_insert_merged" on public."master_links";
create policy "master_links_insert_merged" on public."master_links" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "master_links_update_merged" on public."master_links";
create policy "master_links_update_merged" on public."master_links" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "master_links_delete_merged" on public."master_links";
create policy "master_links_delete_merged" on public."master_links" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── module_labels ──
drop policy if exists "module_labels_read" on public."module_labels";
drop policy if exists "module_labels_write" on public."module_labels";
drop policy if exists "module_labels_select_merged" on public."module_labels";
create policy "module_labels_select_merged" on public."module_labels" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_labels_insert_merged" on public."module_labels";
create policy "module_labels_insert_merged" on public."module_labels" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_labels_update_merged" on public."module_labels";
create policy "module_labels_update_merged" on public."module_labels" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_labels_delete_merged" on public."module_labels";
create policy "module_labels_delete_merged" on public."module_labels" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── module_visibility ──
drop policy if exists "module_visibility_select_all" on public."module_visibility";
drop policy if exists "module_visibility_write_admin" on public."module_visibility";
drop policy if exists "module_visibility_select_merged" on public."module_visibility";
create policy "module_visibility_select_merged" on public."module_visibility" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_visibility_insert_merged" on public."module_visibility";
create policy "module_visibility_insert_merged" on public."module_visibility" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_visibility_update_merged" on public."module_visibility";
create policy "module_visibility_update_merged" on public."module_visibility" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));
drop policy if exists "module_visibility_delete_merged" on public."module_visibility";
create policy "module_visibility_delete_merged" on public."module_visibility" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role)))))));

-- ── notification_rules ──
drop policy if exists "notification_rules_admin_write" on public."notification_rules";
drop policy if exists "notification_rules_read" on public."notification_rules";
drop policy if exists "notification_rules_select_merged" on public."notification_rules";
create policy "notification_rules_select_merged" on public."notification_rules" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))) OR (true));
drop policy if exists "notification_rules_insert_merged" on public."notification_rules";
create policy "notification_rules_insert_merged" on public."notification_rules" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "notification_rules_update_merged" on public."notification_rules";
create policy "notification_rules_update_merged" on public."notification_rules" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "notification_rules_delete_merged" on public."notification_rules";
create policy "notification_rules_delete_merged" on public."notification_rules" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── notification_schedule ──
drop policy if exists "nsch_read" on public."notification_schedule";
drop policy if exists "nsch_write" on public."notification_schedule";
drop policy if exists "notification_schedule_select_merged_public" on public."notification_schedule";
create policy "notification_schedule_select_merged_public" on public."notification_schedule" for select to public
  using (((( SELECT auth.uid() AS uid) IS NOT NULL)) OR (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text)))));
drop policy if exists "notification_schedule_insert_merged_public" on public."notification_schedule";
create policy "notification_schedule_insert_merged_public" on public."notification_schedule" for insert to public
  with check ((((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text)))));
drop policy if exists "notification_schedule_update_merged_public" on public."notification_schedule";
create policy "notification_schedule_update_merged_public" on public."notification_schedule" for update to public
  using ((((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text)))))
  with check ((((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text)))));
drop policy if exists "notification_schedule_delete_merged_public" on public."notification_schedule";
create policy "notification_schedule_delete_merged_public" on public."notification_schedule" for delete to public
  using ((((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text)))));

-- ── notification_self_manage ──
drop policy if exists "nsm_admin_write" on public."notification_self_manage";
drop policy if exists "nsm_read" on public."notification_self_manage";
drop policy if exists "notification_self_manage_select_merged_public" on public."notification_self_manage";
create policy "notification_self_manage_select_merged_public" on public."notification_self_manage" for select to public
  using (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)) OR (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role))));
drop policy if exists "notification_self_manage_insert_merged_public" on public."notification_self_manage";
create policy "notification_self_manage_insert_merged_public" on public."notification_self_manage" for insert to public
  with check (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)));
drop policy if exists "notification_self_manage_update_merged_public" on public."notification_self_manage";
create policy "notification_self_manage_update_merged_public" on public."notification_self_manage" for update to public
  using (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)))
  with check (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)));
drop policy if exists "notification_self_manage_delete_merged_public" on public."notification_self_manage";
create policy "notification_self_manage_delete_merged_public" on public."notification_self_manage" for delete to public
  using (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)));

-- ── permission_policies ──
drop policy if exists "pp_admin_write" on public."permission_policies";
drop policy if exists "pp_read" on public."permission_policies";
drop policy if exists "permission_policies_select_merged" on public."permission_policies";
create policy "permission_policies_select_merged" on public."permission_policies" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (true));
drop policy if exists "permission_policies_insert_merged" on public."permission_policies";
create policy "permission_policies_insert_merged" on public."permission_policies" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "permission_policies_update_merged" on public."permission_policies";
create policy "permission_policies_update_merged" on public."permission_policies" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "permission_policies_delete_merged" on public."permission_policies";
create policy "permission_policies_delete_merged" on public."permission_policies" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── procurement_tracker_state ──
drop policy if exists "pts_select_all" on public."procurement_tracker_state";
drop policy if exists "pts_write_writers" on public."procurement_tracker_state";
drop policy if exists "procurement_tracker_state_select_merged" on public."procurement_tracker_state";
create policy "procurement_tracker_state_select_merged" on public."procurement_tracker_state" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role)))))));
drop policy if exists "procurement_tracker_state_insert_merged" on public."procurement_tracker_state";
create policy "procurement_tracker_state_insert_merged" on public."procurement_tracker_state" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role)))))));
drop policy if exists "procurement_tracker_state_update_merged" on public."procurement_tracker_state";
create policy "procurement_tracker_state_update_merged" on public."procurement_tracker_state" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role)))))));
drop policy if exists "procurement_tracker_state_delete_merged" on public."procurement_tracker_state";
create policy "procurement_tracker_state_delete_merged" on public."procurement_tracker_state" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role)))))));

-- ── procurement_user_project_visibility ──
drop policy if exists "pupv_select_own_or_admin" on public."procurement_user_project_visibility";
drop policy if exists "pupv_write_admin" on public."procurement_user_project_visibility";
drop policy if exists "procurement_user_project_visibility_select_merged" on public."procurement_user_project_visibility";
create policy "procurement_user_project_visibility_select_merged" on public."procurement_user_project_visibility" for select to authenticated
  using ((((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role)))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))));
drop policy if exists "procurement_user_project_visibility_insert_merged" on public."procurement_user_project_visibility";
create policy "procurement_user_project_visibility_insert_merged" on public."procurement_user_project_visibility" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))));
drop policy if exists "procurement_user_project_visibility_update_merged" on public."procurement_user_project_visibility";
create policy "procurement_user_project_visibility_update_merged" on public."procurement_user_project_visibility" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))));
drop policy if exists "procurement_user_project_visibility_delete_merged" on public."procurement_user_project_visibility";
create policy "procurement_user_project_visibility_delete_merged" on public."procurement_user_project_visibility" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))));

-- ── project_aliases ──
drop policy if exists "project_aliases_admin_write" on public."project_aliases";
drop policy if exists "project_aliases_read" on public."project_aliases";
drop policy if exists "project_aliases_select_merged" on public."project_aliases";
create policy "project_aliases_select_merged" on public."project_aliases" for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL)));
drop policy if exists "project_aliases_insert_merged" on public."project_aliases";
create policy "project_aliases_insert_merged" on public."project_aliases" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "project_aliases_update_merged" on public."project_aliases";
create policy "project_aliases_update_merged" on public."project_aliases" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));
drop policy if exists "project_aliases_delete_merged" on public."project_aliases";
create policy "project_aliases_delete_merged" on public."project_aliases" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner))))));

-- ── project_assignments ──
drop policy if exists "pa_admin_write" on public."project_assignments";
drop policy if exists "pa_read" on public."project_assignments";
drop policy if exists "project_assignments_select_merged" on public."project_assignments";
create policy "project_assignments_select_merged" on public."project_assignments" for select to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))) OR (((user_id = ( SELECT auth.uid() AS uid)) OR fn_cc_is_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "project_assignments_insert_merged" on public."project_assignments";
create policy "project_assignments_insert_merged" on public."project_assignments" for insert to authenticated
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "project_assignments_update_merged" on public."project_assignments";
create policy "project_assignments_update_merged" on public."project_assignments" for update to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))))
  with check (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "project_assignments_delete_merged" on public."project_assignments";
create policy "project_assignments_delete_merged" on public."project_assignments" for delete to authenticated
  using (((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)))));

-- ── project_floors ──
drop policy if exists "project_floors_select_all" on public."project_floors";
drop policy if exists "project_floors_write_editor" on public."project_floors";
drop policy if exists "project_floors_select_merged" on public."project_floors";
create policy "project_floors_select_merged" on public."project_floors" for select to authenticated
  using ((true) OR ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true))))));
drop policy if exists "project_floors_insert_merged" on public."project_floors";
create policy "project_floors_insert_merged" on public."project_floors" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true))))));
drop policy if exists "project_floors_update_merged" on public."project_floors";
create policy "project_floors_update_merged" on public."project_floors" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true))))));
drop policy if exists "project_floors_delete_merged" on public."project_floors";
create policy "project_floors_delete_merged" on public."project_floors" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true))))));

-- ── role_permissions ──
drop policy if exists "admin manages role_permissions" on public."role_permissions";
drop policy if exists "anyone authed reads role_permissions" on public."role_permissions";
drop policy if exists "role_permissions_select_merged" on public."role_permissions";
create policy "role_permissions_select_merged" on public."role_permissions" for select to authenticated
  using (((current_user_role() = 'admin'::user_role)) OR (true));
drop policy if exists "role_permissions_insert_merged" on public."role_permissions";
create policy "role_permissions_insert_merged" on public."role_permissions" for insert to authenticated
  with check (((current_user_role() = 'admin'::user_role)));
drop policy if exists "role_permissions_update_merged" on public."role_permissions";
create policy "role_permissions_update_merged" on public."role_permissions" for update to authenticated
  using (((current_user_role() = 'admin'::user_role)))
  with check (((current_user_role() = 'admin'::user_role)));
drop policy if exists "role_permissions_delete_merged" on public."role_permissions";
create policy "role_permissions_delete_merged" on public."role_permissions" for delete to authenticated
  using (((current_user_role() = 'admin'::user_role)));

-- ── sched_drawing_revisions ──
drop policy if exists "sched_drawing_rev_select" on public."sched_drawing_revisions";
drop policy if exists "sched_drawing_rev_write" on public."sched_drawing_revisions";
drop policy if exists "sched_drawing_revisions_select_merged" on public."sched_drawing_revisions";
create policy "sched_drawing_revisions_select_merged" on public."sched_drawing_revisions" for select to authenticated
  using ((true) OR (sched_can_write()));
drop policy if exists "sched_drawing_revisions_insert_merged" on public."sched_drawing_revisions";
create policy "sched_drawing_revisions_insert_merged" on public."sched_drawing_revisions" for insert to authenticated
  with check ((sched_can_write()));
drop policy if exists "sched_drawing_revisions_update_merged" on public."sched_drawing_revisions";
create policy "sched_drawing_revisions_update_merged" on public."sched_drawing_revisions" for update to authenticated
  using ((sched_can_write()))
  with check ((sched_can_write()));
drop policy if exists "sched_drawing_revisions_delete_merged" on public."sched_drawing_revisions";
create policy "sched_drawing_revisions_delete_merged" on public."sched_drawing_revisions" for delete to authenticated
  using ((sched_can_write()));

-- ── sched_drawings ──
drop policy if exists "sched_drawings_select" on public."sched_drawings";
drop policy if exists "sched_drawings_write" on public."sched_drawings";
drop policy if exists "sched_drawings_select_merged" on public."sched_drawings";
create policy "sched_drawings_select_merged" on public."sched_drawings" for select to authenticated
  using ((true) OR (sched_can_write()));
drop policy if exists "sched_drawings_insert_merged" on public."sched_drawings";
create policy "sched_drawings_insert_merged" on public."sched_drawings" for insert to authenticated
  with check ((sched_can_write()));
drop policy if exists "sched_drawings_update_merged" on public."sched_drawings";
create policy "sched_drawings_update_merged" on public."sched_drawings" for update to authenticated
  using ((sched_can_write()))
  with check ((sched_can_write()));
drop policy if exists "sched_drawings_delete_merged" on public."sched_drawings";
create policy "sched_drawings_delete_merged" on public."sched_drawings" for delete to authenticated
  using ((sched_can_write()));

-- ── sched_progress ──
drop policy if exists "sched_progress_select" on public."sched_progress";
drop policy if exists "sched_progress_write" on public."sched_progress";
drop policy if exists "sched_progress_select_merged" on public."sched_progress";
create policy "sched_progress_select_merged" on public."sched_progress" for select to authenticated
  using ((true) OR (sched_can_write()));
drop policy if exists "sched_progress_insert_merged" on public."sched_progress";
create policy "sched_progress_insert_merged" on public."sched_progress" for insert to authenticated
  with check ((sched_can_write()));
drop policy if exists "sched_progress_update_merged" on public."sched_progress";
create policy "sched_progress_update_merged" on public."sched_progress" for update to authenticated
  using ((sched_can_write()))
  with check ((sched_can_write()));
drop policy if exists "sched_progress_delete_merged" on public."sched_progress";
create policy "sched_progress_delete_merged" on public."sched_progress" for delete to authenticated
  using ((sched_can_write()));

-- ── sched_promises ──
drop policy if exists "sched_promises_select" on public."sched_promises";
drop policy if exists "sched_promises_write" on public."sched_promises";
drop policy if exists "sched_promises_select_merged_public" on public."sched_promises";
create policy "sched_promises_select_merged_public" on public."sched_promises" for select to public
  using ((true) OR (sched_can_write()));
drop policy if exists "sched_promises_insert_merged_public" on public."sched_promises";
create policy "sched_promises_insert_merged_public" on public."sched_promises" for insert to public
  with check ((sched_can_write()));
drop policy if exists "sched_promises_update_merged_public" on public."sched_promises";
create policy "sched_promises_update_merged_public" on public."sched_promises" for update to public
  using ((sched_can_write()))
  with check ((sched_can_write()));
drop policy if exists "sched_promises_delete_merged_public" on public."sched_promises";
create policy "sched_promises_delete_merged_public" on public."sched_promises" for delete to public
  using ((sched_can_write()));

-- ── user_module_blocks ──
drop policy if exists "user_module_blocks_read" on public."user_module_blocks";
drop policy if exists "user_module_blocks_write" on public."user_module_blocks";
drop policy if exists "user_module_blocks_select_merged" on public."user_module_blocks";
create policy "user_module_blocks_select_merged" on public."user_module_blocks" for select to authenticated
  using ((((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_blocks_insert_merged" on public."user_module_blocks";
create policy "user_module_blocks_insert_merged" on public."user_module_blocks" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_blocks_update_merged" on public."user_module_blocks";
create policy "user_module_blocks_update_merged" on public."user_module_blocks" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_blocks_delete_merged" on public."user_module_blocks";
create policy "user_module_blocks_delete_merged" on public."user_module_blocks" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));

-- ── user_module_roles ──
drop policy if exists "user_module_roles_read" on public."user_module_roles";
drop policy if exists "user_module_roles_write" on public."user_module_roles";
drop policy if exists "user_module_roles_select_merged" on public."user_module_roles";
create policy "user_module_roles_select_merged" on public."user_module_roles" for select to authenticated
  using ((((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))) OR ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_roles_insert_merged" on public."user_module_roles";
create policy "user_module_roles_insert_merged" on public."user_module_roles" for insert to authenticated
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_roles_update_merged" on public."user_module_roles";
create policy "user_module_roles_update_merged" on public."user_module_roles" for update to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
drop policy if exists "user_module_roles_delete_merged" on public."user_module_roles";
create policy "user_module_roles_delete_merged" on public."user_module_roles" for delete to authenticated
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));

-- ── user_permission_overrides ──
drop policy if exists "upo_admin_write" on public."user_permission_overrides";
drop policy if exists "upo_read" on public."user_permission_overrides";
drop policy if exists "user_permission_overrides_select_merged" on public."user_permission_overrides";
create policy "user_permission_overrides_select_merged" on public."user_permission_overrides" for select to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))) OR (((user_id = ( SELECT auth.uid() AS uid)) OR fn_cc_is_admin(( SELECT auth.uid() AS uid)))));
drop policy if exists "user_permission_overrides_insert_merged" on public."user_permission_overrides";
create policy "user_permission_overrides_insert_merged" on public."user_permission_overrides" for insert to authenticated
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "user_permission_overrides_update_merged" on public."user_permission_overrides";
create policy "user_permission_overrides_update_merged" on public."user_permission_overrides" for update to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));
drop policy if exists "user_permission_overrides_delete_merged" on public."user_permission_overrides";
create policy "user_permission_overrides_delete_merged" on public."user_permission_overrides" for delete to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid))));

-- ── wh_count_lines ──
drop policy if exists "wh_count_lines_delete" on public."wh_count_lines";
drop policy if exists "wh_count_lines_read" on public."wh_count_lines";
drop policy if exists "wh_count_lines_write" on public."wh_count_lines";
drop policy if exists "wh_count_lines_select_merged_public" on public."wh_count_lines";
create policy "wh_count_lines_select_merged_public" on public."wh_count_lines" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_count_lines_insert_merged_public" on public."wh_count_lines";
create policy "wh_count_lines_insert_merged_public" on public."wh_count_lines" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_count_lines_update_merged_public" on public."wh_count_lines";
create policy "wh_count_lines_update_merged_public" on public."wh_count_lines" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_count_lines_delete_merged_public" on public."wh_count_lines";
create policy "wh_count_lines_delete_merged_public" on public."wh_count_lines" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_counts ──
drop policy if exists "wh_counts_delete" on public."wh_counts";
drop policy if exists "wh_counts_read" on public."wh_counts";
drop policy if exists "wh_counts_write" on public."wh_counts";
drop policy if exists "wh_counts_select_merged_public" on public."wh_counts";
create policy "wh_counts_select_merged_public" on public."wh_counts" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_counts_insert_merged_public" on public."wh_counts";
create policy "wh_counts_insert_merged_public" on public."wh_counts" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_counts_update_merged_public" on public."wh_counts";
create policy "wh_counts_update_merged_public" on public."wh_counts" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_counts_delete_merged_public" on public."wh_counts";
create policy "wh_counts_delete_merged_public" on public."wh_counts" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_gate_in ──
drop policy if exists "wh_gate_in_delete" on public."wh_gate_in";
drop policy if exists "wh_gate_in_read" on public."wh_gate_in";
drop policy if exists "wh_gate_in_write" on public."wh_gate_in";
drop policy if exists "wh_gate_in_select_merged_public" on public."wh_gate_in";
create policy "wh_gate_in_select_merged_public" on public."wh_gate_in" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_insert_merged_public" on public."wh_gate_in";
create policy "wh_gate_in_insert_merged_public" on public."wh_gate_in" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_update_merged_public" on public."wh_gate_in";
create policy "wh_gate_in_update_merged_public" on public."wh_gate_in" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_delete_merged_public" on public."wh_gate_in";
create policy "wh_gate_in_delete_merged_public" on public."wh_gate_in" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_gate_in_lines ──
drop policy if exists "wh_gate_in_lines_delete" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_read" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_write" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_select_merged_public" on public."wh_gate_in_lines";
create policy "wh_gate_in_lines_select_merged_public" on public."wh_gate_in_lines" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_lines_insert_merged_public" on public."wh_gate_in_lines";
create policy "wh_gate_in_lines_insert_merged_public" on public."wh_gate_in_lines" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_lines_update_merged_public" on public."wh_gate_in_lines";
create policy "wh_gate_in_lines_update_merged_public" on public."wh_gate_in_lines" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_in_lines_delete_merged_public" on public."wh_gate_in_lines";
create policy "wh_gate_in_lines_delete_merged_public" on public."wh_gate_in_lines" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_gate_out ──
drop policy if exists "wh_gate_out_delete" on public."wh_gate_out";
drop policy if exists "wh_gate_out_read" on public."wh_gate_out";
drop policy if exists "wh_gate_out_write" on public."wh_gate_out";
drop policy if exists "wh_gate_out_select_merged_public" on public."wh_gate_out";
create policy "wh_gate_out_select_merged_public" on public."wh_gate_out" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_insert_merged_public" on public."wh_gate_out";
create policy "wh_gate_out_insert_merged_public" on public."wh_gate_out" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_update_merged_public" on public."wh_gate_out";
create policy "wh_gate_out_update_merged_public" on public."wh_gate_out" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_delete_merged_public" on public."wh_gate_out";
create policy "wh_gate_out_delete_merged_public" on public."wh_gate_out" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_gate_out_lines ──
drop policy if exists "wh_gate_out_lines_delete" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_read" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_write" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_select_merged_public" on public."wh_gate_out_lines";
create policy "wh_gate_out_lines_select_merged_public" on public."wh_gate_out_lines" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_lines_insert_merged_public" on public."wh_gate_out_lines";
create policy "wh_gate_out_lines_insert_merged_public" on public."wh_gate_out_lines" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_lines_update_merged_public" on public."wh_gate_out_lines";
create policy "wh_gate_out_lines_update_merged_public" on public."wh_gate_out_lines" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_gate_out_lines_delete_merged_public" on public."wh_gate_out_lines";
create policy "wh_gate_out_lines_delete_merged_public" on public."wh_gate_out_lines" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_items ──
drop policy if exists "wh_items_delete" on public."wh_items";
drop policy if exists "wh_items_read" on public."wh_items";
drop policy if exists "wh_items_write" on public."wh_items";
drop policy if exists "wh_items_select_merged_public" on public."wh_items";
create policy "wh_items_select_merged_public" on public."wh_items" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_items_insert_merged_public" on public."wh_items";
create policy "wh_items_insert_merged_public" on public."wh_items" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_items_update_merged_public" on public."wh_items";
create policy "wh_items_update_merged_public" on public."wh_items" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_items_delete_merged_public" on public."wh_items";
create policy "wh_items_delete_merged_public" on public."wh_items" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_lists ──
drop policy if exists "wh_lists_delete" on public."wh_lists";
drop policy if exists "wh_lists_read" on public."wh_lists";
drop policy if exists "wh_lists_write" on public."wh_lists";
drop policy if exists "wh_lists_select_merged_public" on public."wh_lists";
create policy "wh_lists_select_merged_public" on public."wh_lists" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_lists_insert_merged_public" on public."wh_lists";
create policy "wh_lists_insert_merged_public" on public."wh_lists" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_lists_update_merged_public" on public."wh_lists";
create policy "wh_lists_update_merged_public" on public."wh_lists" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_lists_delete_merged_public" on public."wh_lists";
create policy "wh_lists_delete_merged_public" on public."wh_lists" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_locations ──
drop policy if exists "wh_locations_delete" on public."wh_locations";
drop policy if exists "wh_locations_read" on public."wh_locations";
drop policy if exists "wh_locations_write" on public."wh_locations";
drop policy if exists "wh_locations_select_merged_public" on public."wh_locations";
create policy "wh_locations_select_merged_public" on public."wh_locations" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_locations_insert_merged_public" on public."wh_locations";
create policy "wh_locations_insert_merged_public" on public."wh_locations" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_locations_update_merged_public" on public."wh_locations";
create policy "wh_locations_update_merged_public" on public."wh_locations" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_locations_delete_merged_public" on public."wh_locations";
create policy "wh_locations_delete_merged_public" on public."wh_locations" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_movements ──
drop policy if exists "wh_movements_delete" on public."wh_movements";
drop policy if exists "wh_movements_read" on public."wh_movements";
drop policy if exists "wh_movements_write" on public."wh_movements";
drop policy if exists "wh_movements_select_merged_public" on public."wh_movements";
create policy "wh_movements_select_merged_public" on public."wh_movements" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_movements_insert_merged_public" on public."wh_movements";
create policy "wh_movements_insert_merged_public" on public."wh_movements" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_movements_update_merged_public" on public."wh_movements";
create policy "wh_movements_update_merged_public" on public."wh_movements" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_movements_delete_merged_public" on public."wh_movements";
create policy "wh_movements_delete_merged_public" on public."wh_movements" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_number_series ──
drop policy if exists "wh_number_series_delete" on public."wh_number_series";
drop policy if exists "wh_number_series_read" on public."wh_number_series";
drop policy if exists "wh_number_series_write" on public."wh_number_series";
drop policy if exists "wh_number_series_select_merged_public" on public."wh_number_series";
create policy "wh_number_series_select_merged_public" on public."wh_number_series" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_number_series_insert_merged_public" on public."wh_number_series";
create policy "wh_number_series_insert_merged_public" on public."wh_number_series" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_number_series_update_merged_public" on public."wh_number_series";
create policy "wh_number_series_update_merged_public" on public."wh_number_series" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_number_series_delete_merged_public" on public."wh_number_series";
create policy "wh_number_series_delete_merged_public" on public."wh_number_series" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_po ──
drop policy if exists "wh_po_delete" on public."wh_po";
drop policy if exists "wh_po_read" on public."wh_po";
drop policy if exists "wh_po_write" on public."wh_po";
drop policy if exists "wh_po_select_merged_public" on public."wh_po";
create policy "wh_po_select_merged_public" on public."wh_po" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_po_insert_merged_public" on public."wh_po";
create policy "wh_po_insert_merged_public" on public."wh_po" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_po_update_merged_public" on public."wh_po";
create policy "wh_po_update_merged_public" on public."wh_po" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_po_delete_merged_public" on public."wh_po";
create policy "wh_po_delete_merged_public" on public."wh_po" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_po_lines ──
drop policy if exists "wh_po_lines_delete" on public."wh_po_lines";
drop policy if exists "wh_po_lines_read" on public."wh_po_lines";
drop policy if exists "wh_po_lines_write" on public."wh_po_lines";
drop policy if exists "wh_po_lines_select_merged_public" on public."wh_po_lines";
create policy "wh_po_lines_select_merged_public" on public."wh_po_lines" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_po_lines_insert_merged_public" on public."wh_po_lines";
create policy "wh_po_lines_insert_merged_public" on public."wh_po_lines" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_po_lines_update_merged_public" on public."wh_po_lines";
create policy "wh_po_lines_update_merged_public" on public."wh_po_lines" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_po_lines_delete_merged_public" on public."wh_po_lines";
create policy "wh_po_lines_delete_merged_public" on public."wh_po_lines" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_request_lines ──
drop policy if exists "wh_request_lines_delete" on public."wh_request_lines";
drop policy if exists "wh_request_lines_read" on public."wh_request_lines";
drop policy if exists "wh_request_lines_write" on public."wh_request_lines";
drop policy if exists "wh_request_lines_select_merged_public" on public."wh_request_lines";
create policy "wh_request_lines_select_merged_public" on public."wh_request_lines" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_request_lines_insert_merged_public" on public."wh_request_lines";
create policy "wh_request_lines_insert_merged_public" on public."wh_request_lines" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_request_lines_update_merged_public" on public."wh_request_lines";
create policy "wh_request_lines_update_merged_public" on public."wh_request_lines" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_request_lines_delete_merged_public" on public."wh_request_lines";
create policy "wh_request_lines_delete_merged_public" on public."wh_request_lines" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_requests ──
drop policy if exists "wh_requests_delete" on public."wh_requests";
drop policy if exists "wh_requests_read" on public."wh_requests";
drop policy if exists "wh_requests_write" on public."wh_requests";
drop policy if exists "wh_requests_select_merged_public" on public."wh_requests";
create policy "wh_requests_select_merged_public" on public."wh_requests" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_requests_insert_merged_public" on public."wh_requests";
create policy "wh_requests_insert_merged_public" on public."wh_requests" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_requests_update_merged_public" on public."wh_requests";
create policy "wh_requests_update_merged_public" on public."wh_requests" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_requests_delete_merged_public" on public."wh_requests";
create policy "wh_requests_delete_merged_public" on public."wh_requests" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

-- ── wh_stock ──
drop policy if exists "wh_stock_delete" on public."wh_stock";
drop policy if exists "wh_stock_read" on public."wh_stock";
drop policy if exists "wh_stock_write" on public."wh_stock";
drop policy if exists "wh_stock_select_merged_public" on public."wh_stock";
create policy "wh_stock_select_merged_public" on public."wh_stock" for select to public
  using ((fn_wh_can('view'::text)) OR (fn_wh_can('edit'::text)));
drop policy if exists "wh_stock_insert_merged_public" on public."wh_stock";
create policy "wh_stock_insert_merged_public" on public."wh_stock" for insert to public
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_stock_update_merged_public" on public."wh_stock";
create policy "wh_stock_update_merged_public" on public."wh_stock" for update to public
  using ((fn_wh_can('edit'::text)))
  with check ((fn_wh_can('edit'::text)));
drop policy if exists "wh_stock_delete_merged_public" on public."wh_stock";
create policy "wh_stock_delete_merged_public" on public."wh_stock" for delete to public
  using ((fn_wh_can('admin'::text)) OR (fn_wh_can('edit'::text)));

