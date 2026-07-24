-- Cost Control access is now ROLE-based, not per-sub-skill assignment
-- (Aksha's call — assigning engineers per sub-skill was too tedious).
-- Anyone whose role has can_edit on cost-control works in EVERY project; the
-- admin controls who is an editor via the role_permissions matrix
-- (/admin/permissions). The legacy project_assignments and
-- cc_subskill_assignments branches are kept so any explicit assignment still
-- grants access (harmless when unused). Money confidentiality (the [IB]
-- Internal Estimate baseline) is enforced in the app layer, not here.
-- Supersedes 20260726 (which only added the cc_subskill_assignments branch).
create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    -- Any Cost Control editor works in every project (role-based access).
    exists (
      select 1 from role_permissions rp
      join profiles pro on pro.role::text = rp.role::text
      where pro.id = p_user and rp.module_slug = 'cost-control' and rp.can_edit = true
    )
    or fn_cc_is_admin(p_user)
    or exists (
      select 1 from role_permissions rp
      join profiles pro on pro.role::text = rp.role::text
      where pro.id = p_user and rp.module_slug = 'cost-control' and rp.can_admin = true
    )
    or public.effective_user_role(p_user, 'cost-control')::text = 'billing'
    -- Legacy explicit assignments still count.
    or exists (
      select 1 from project_assignments
      where user_id = p_user and project_id = p_project
    )
    or exists (
      select 1 from cc_subskill_assignments a
      where a.engineer_id = p_user and a.project_id = p_project
    );
$function$;
