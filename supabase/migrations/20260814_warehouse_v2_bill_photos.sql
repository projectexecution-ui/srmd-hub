-- ===========================================================================
-- WAREHOUSE V2 — the bill that came with the truck.
--
-- wh_gate_in.photo_urls has existed since the first migration and nothing ever
-- filled it. A bill runs to two or three pages, so this stores a LIST of paths
-- per entry rather than one image, in page order.
--
-- Private bucket: a supplier's invoice carries his rates. Reading it goes
-- through a short-lived signed URL, the same way the inventory gate passes work.
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('wh-bills', 'wh-bills', false)
on conflict (id) do nothing;

update storage.buckets
  set file_size_limit = 10485760,          -- 10MB a page, after the browser downscales
      allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
  where id = 'wh-bills';

-- Anyone who can see the module can read a bill; the entry itself is already
-- gated by fn_wh_can('view').
drop policy if exists wh_bills_obj_select on storage.objects;
create policy wh_bills_obj_select on storage.objects
  for select to authenticated using (bucket_id = 'wh-bills' and public.fn_wh_can('view'));

-- Whoever can record an entry can attach its bill.
drop policy if exists wh_bills_obj_insert on storage.objects;
create policy wh_bills_obj_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'wh-bills' and public.fn_wh_can('edit'));

-- Replacing or removing a page is the uploader's own to do, or an admin's —
-- a bill somebody else photographed is evidence, not your file to overwrite.
drop policy if exists wh_bills_obj_update on storage.objects;
create policy wh_bills_obj_update on storage.objects
  for update to authenticated using (
    bucket_id = 'wh-bills' and (public.fn_wh_can('admin') or owner = auth.uid())
  );

drop policy if exists wh_bills_obj_delete on storage.objects;
create policy wh_bills_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'wh-bills' and (public.fn_wh_can('admin') or owner = auth.uid())
  );

comment on column wh_gate_in.photo_urls is
  'Storage paths in the private wh-bills bucket, in page order — a bill is often 2 or 3 pages.';
