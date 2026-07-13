-- ============================================================
-- Bills Pipeline — storage bucket + RLS + role_permissions seed
-- ============================================================

-- Private bucket for weekly command card PNGs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bills-pipeline', 'bills-pipeline', false, 10485760, array['image/png'])
on conflict (id) do nothing;

-- Authenticated users can read (needed for createSignedUrl from session client)
drop policy if exists "bp_objects_select" on storage.objects;
create policy "bp_objects_select" on storage.objects
  for select to authenticated using (bucket_id = 'bills-pipeline');

-- Admin only for now — expand via /admin/permissions when ready to share
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values
  ('admin', 'bills-pipeline', true, true, true)
on conflict (role, module_slug) do update
  set can_view = excluded.can_view,
      can_edit  = excluded.can_edit,
      can_admin = excluded.can_admin;
