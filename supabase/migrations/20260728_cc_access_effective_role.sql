-- Cost Control access reads the EFFECTIVE cost-control role (per-module
-- override in user_module_roles, else the base profile role) instead of the
-- base profile role — so an admin can tag someone "Engineer for Cost Control"
-- (allowed to Add to the Internal Estimate) while they hold a DIFFERENT role
-- in other modules. 0 cost-control overrides exist today → effective == base
-- for everyone → no behaviour change now; this only enables per-module tagging.
--
-- New effective-role permission helpers, fn_cc_user_in_project repointed at
-- them, and the 7 base-role policy gates (storage cc-sheets, cc_excel_rows,
-- cc_ws_comments, cc_ie_revisions) switched to the helpers.

create or replace function public.fn_cc_can_view(p_user uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.module_slug = 'cost-control' and rp.can_view = true
      and rp.role = public.effective_user_role(p_user, 'cost-control')
  );
$$;

create or replace function public.fn_cc_can_edit(p_user uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.module_slug = 'cost-control' and rp.can_edit = true
      and rp.role = public.effective_user_role(p_user, 'cost-control')
  );
$$;

create or replace function public.fn_cc_can_admin(p_user uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.module_slug = 'cost-control' and rp.can_admin = true
      and rp.role = public.effective_user_role(p_user, 'cost-control')
  );
$$;

create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select
    public.fn_cc_can_edit(p_user)        -- any CC editor (effective role) → every project
    or public.fn_cc_is_admin(p_user)
    or public.fn_cc_can_admin(p_user)
    or public.effective_user_role(p_user, 'cost-control')::text = 'billing'
    or exists (select 1 from public.project_assignments where user_id = p_user and project_id = p_project)
    or exists (select 1 from public.cc_subskill_assignments a where a.engineer_id = p_user and a.project_id = p_project);
$$;

alter policy cc_sheets_read on storage.objects
using (
  (bucket_id = 'cc-sheets') and (
    public.fn_cc_is_admin(auth.uid())
    or (
      public.fn_cc_can_view(auth.uid())
      and ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  )
);

alter policy cc_sheets_write on storage.objects
using (
  (bucket_id = 'cc-sheets') and (
    public.fn_cc_is_admin(auth.uid())
    or (
      public.fn_cc_can_edit(auth.uid())
      and ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  )
)
with check (
  (bucket_id = 'cc-sheets') and (
    public.fn_cc_is_admin(auth.uid())
    or (
      public.fn_cc_can_edit(auth.uid())
      and ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  )
);

alter policy cc_excel_rows_read on public.cc_excel_rows
using (
  public.fn_cc_can_view(auth.uid())
  and (
    public.fn_cc_is_admin(auth.uid())
    or exists (select 1 from public.cc_working_sheets ws
               where ws.id = cc_excel_rows.working_sheet_id
                 and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
  )
);

alter policy cc_excel_rows_write on public.cc_excel_rows
using (
  public.fn_cc_can_edit(auth.uid())
  and (
    public.fn_cc_is_admin(auth.uid())
    or exists (select 1 from public.cc_working_sheets ws
               where ws.id = cc_excel_rows.working_sheet_id
                 and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
  )
)
with check (
  public.fn_cc_can_edit(auth.uid())
  and (
    public.fn_cc_is_admin(auth.uid())
    or exists (select 1 from public.cc_working_sheets ws
               where ws.id = cc_excel_rows.working_sheet_id
                 and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
  )
);

alter policy cc_ws_comments_read on public.cc_ws_comments
using (
  public.fn_cc_can_view(auth.uid())
  and exists (select 1 from public.cc_working_sheets ws where ws.id = cc_ws_comments.ws_id)
);

alter policy cc_ws_comments_insert on public.cc_ws_comments
with check (
  (author_id = auth.uid())
  and public.fn_cc_can_view(auth.uid())
  and exists (select 1 from public.cc_working_sheets ws where ws.id = cc_ws_comments.ws_id)
);

alter policy cc_ie_revisions_read on public.cc_ie_revisions
using ( public.fn_cc_can_view(auth.uid()) );
