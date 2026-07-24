-- FIX (reported by Ambrish): an engineer assigned per sub-skill could not
-- create a Budget Request — "Upload failed: new row violates row-level
-- security policy".
--
-- Root cause: the cc-sheets storage upload AND the cc_working_sheets /
-- cc_excel_rows inserts all gate on fn_cc_user_in_project(), which only
-- recognised the project_assignments table. Engineers are assigned through
-- cc_subskill_assignments (the SAME model the WS detail page uses for page
-- access), so a sub-skill-only engineer had 0 project_assignments rows and
-- failed every cost-control RLS write check. Admins / management passed via
-- the is_admin / can_admin branches, which is why only engineers hit it.
--
-- Fix: add a cc_subskill_assignments branch so "in project" matches how the
-- app actually assigns engineers. Additive — only broadens access for
-- engineers already assigned to a sub-skill in that project.
create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from project_assignments
    where user_id = p_user and project_id = p_project
  )
  or exists (
    -- Engineers get project access by being assigned a sub-skill in it.
    select 1 from cc_subskill_assignments a
    where a.engineer_id = p_user and a.project_id = p_project
  )
  or fn_cc_is_admin(p_user)
  or exists (
    select 1 from role_permissions rp
    join profiles pro on pro.role::text = rp.role::text
    where pro.id = p_user
      and rp.module_slug = 'cost-control'
      and rp.can_admin = true
  )
  or public.effective_user_role(p_user, 'cost-control')::text = 'billing';
$function$;
