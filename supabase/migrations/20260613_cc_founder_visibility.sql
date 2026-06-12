-- ============================================================
-- Cost Control: extend fn_cc_user_in_project to include any
-- role that has can_admin = true for the cost-control module.
-- ============================================================
-- Background: founders (and any other role with can_admin = true
-- in role_permissions) should see all project data just like
-- admins do. Previously fn_cc_user_in_project only granted
-- bypass access to profiles.role = 'admin'. This excluded
-- founders who have can_admin = true in role_permissions.
-- ============================================================

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
