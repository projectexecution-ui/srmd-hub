-- ============================================================
-- Standalone "Stuck Bills" module
-- ============================================================
-- Lets limited staff access ONLY the pending-with-CT checklist
-- table (never the confidential Weekly Card / Project Scorecard).
-- Grant specific people via a per-user override on /admin/users
-- (user_module_roles), which effective_user_role() resolves.
-- ============================================================

insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values ('admin', 'stuck-bills', true, true, true)
on conflict (role, module_slug) do update
  set can_view = excluded.can_view, can_edit = excluded.can_edit, can_admin = excluded.can_admin;

-- Checklist writes honor the EFFECTIVE per-module role (so per-user grants
-- work) and accept either bills-pipeline OR stuck-bills edit permission.
drop policy if exists "bp_checklist_rw" on public.bp_bill_checklist;
create policy "bp_checklist_rw" on public.bp_bill_checklist
  for all to authenticated
  using (
    exists (
      select 1 from public.role_permissions rp
      where rp.module_slug in ('bills-pipeline', 'stuck-bills')
        and rp.can_edit = true
        and rp.role = public.effective_user_role(auth.uid(), rp.module_slug)
    )
  )
  with check (
    exists (
      select 1 from public.role_permissions rp
      where rp.module_slug in ('bills-pipeline', 'stuck-bills')
        and rp.can_edit = true
        and rp.role = public.effective_user_role(auth.uid(), rp.module_slug)
    )
  );
