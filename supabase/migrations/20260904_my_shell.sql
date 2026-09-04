-- shell_for(user): everything the app shell needs to draw itself, in ONE call.
--
-- The (app) layout ran six round-trips on EVERY navigation — profile,
-- my_permissions(), module_visibility, module_labels, sidebar groups, portal
-- owner — before a page could start. They are all small, all keyed to the
-- current user, and all change rarely, so they belong in one function called
-- once and cached for a minute per user (lib/shell.ts).
--
-- Takes the user id as a parameter (rather than auth.uid()) so the cached
-- read can run with the service role, where there is no session. Only the
-- service role may call it — the parameter would otherwise let any signed-in
-- user read another's permission set.

create or replace function public.shell_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user),
    'permissions', coalesce((
      select jsonb_object_agg(rp.module_slug, jsonb_build_object('view', rp.can_view, 'edit', rp.can_edit, 'admin', rp.can_admin))
      from public.role_permissions rp
      where rp.role::text = public.effective_user_role(p_user, rp.module_slug)::text
        and not exists (
          select 1 from public.user_module_blocks b
          where b.user_id = p_user and b.module_slug = rp.module_slug
        )
    ), '{}'::jsonb),
    'disabled', coalesce((select jsonb_agg(slug) from public.module_visibility where enabled = false), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_object_agg(slug, jsonb_build_object('label', label, 'description', description))
      from public.module_labels
    ), '{}'::jsonb),
    'sidebar_groups', (select value from public.app_settings where key = 'sidebar_groups'),
    -- The live project portfolio for the sidebar tree (Internal Estimate projects only).
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'parentId', p.parent_project_id, 'groupLabel', p.group_label) order by p.code)
      from public.projects p
      where p.archived_at is null and p.cc_status is not null
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.shell_for(uuid) from public;
revoke all on function public.shell_for(uuid) from authenticated;
revoke all on function public.shell_for(uuid) from anon;
grant execute on function public.shell_for(uuid) to service_role;
