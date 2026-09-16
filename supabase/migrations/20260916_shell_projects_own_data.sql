-- shell_for(): each sidebar project now says whether it carries Cost Control
-- data of its own (`hasOwnData`). Everything else in the function is unchanged.
--
-- Aksha, 16 Sep 2026: "check the Groupings - i am still finding few flaws".
-- The sidebar and the Budget tab treated EVERY project with children as a
-- group. Right for NGH / P2 / VV — anchors that hold nothing themselves.
-- Wrong for Admin Block, CV4, Ekant Kutir, Welcome Centre Extension, CMCW and
-- New Row House Infra, which are real projects that happen to have a
-- Common-Expenses child: Admin Block's own ₹1.43 Cr (24 budget lines) sat
-- behind a roll-up of its children (₹33.7 L), and its own Internal Estimate
-- could not be reached at all.
--
-- The landing already had the right rule (parentHasOwnData in
-- app/(app)/cost-control/page.tsx). This carries the same fact to the shell
-- so the sidebar tree and the Budget tab can apply it too:
--   own data = a budget line OR a working sheet on the project itself.
--
-- Additive: the projects array gains one boolean; no caller reads less.

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
    -- hasOwnData: a parent WITHOUT it is a pure grouping anchor (NGH, P2, VV);
    -- a parent WITH it is a project that happens to have sub-projects.
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'parentId', p.parent_project_id, 'groupLabel', p.group_label,
        'hasOwnData', (
          exists (select 1 from public.cc_budget_lines b where b.project_id = p.id)
          or exists (select 1 from public.cc_working_sheets w where w.project_id = p.id)
        )
      ) order by p.code)
      from public.projects p
      where p.archived_at is null and p.cc_status is not null
    ), '[]'::jsonb)
  )
$$;
