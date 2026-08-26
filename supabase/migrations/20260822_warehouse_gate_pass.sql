-- The signed gate pass that closes a handover.
--
-- Aksha: "Physical signed Gate Pass pic to upload is mandatory to attach to
-- close the issue raised by Engineer." The pass is signed at the barrier AFTER
-- the material changes hands, so the entry saves without it and the request is
-- not finished until the photograph is attached. That is also what V1 tracked.
--
-- Applied to production 2026-08-22. QA scenarios S68-S71.
alter table wh_gate_out
  add column if not exists gate_pass_urls text[] not null default '{}',
  add column if not exists gate_pass_at   timestamptz,
  add column if not exists gate_pass_by   uuid references profiles(id);

comment on column wh_gate_out.gate_pass_urls is
  'Storage paths of the signed gate pass, in page order. Empty means the '
  'handover happened but nobody has attached the signed pass yet - the request '
  'it belongs to is therefore not closed.';

-- Attached, or not: never half-attached with nobody named against it.
alter table wh_gate_out
  drop constraint if exists wh_gate_out_gate_pass_sane;
alter table wh_gate_out
  add constraint wh_gate_out_gate_pass_sane check (
    (cardinality(gate_pass_urls) = 0 and gate_pass_at is null and gate_pass_by is null)
    or (cardinality(gate_pass_urls) > 0 and gate_pass_at is not null and gate_pass_by is not null)
  );

-- The keeper's follow-up queue: issued against a request, pass still missing.
create index if not exists wh_gate_out_pass_pending_idx
  on wh_gate_out (request_id)
  where cardinality(gate_pass_urls) = 0 and deleted_at is null;

-- Its own bucket, governed the same way wh-bills is.
--
-- Deliberately NOT the V1 'inv-gate-passes' bucket: its policies check only the
-- bucket name, so any signed-in user can read or write it. A new feature does
-- not inherit that. These mirror wh-bills and defer to the module's own
-- permission function.
insert into storage.buckets (id, name, public)
values ('wh-gate-passes', 'wh-gate-passes', false)
on conflict (id) do nothing;

drop policy if exists wh_gate_pass_obj_select on storage.objects;
create policy wh_gate_pass_obj_select on storage.objects for select
  using (bucket_id = 'wh-gate-passes' and fn_wh_can('view'));

drop policy if exists wh_gate_pass_obj_insert on storage.objects;
create policy wh_gate_pass_obj_insert on storage.objects for insert
  with check (bucket_id = 'wh-gate-passes' and fn_wh_can('edit'));

drop policy if exists wh_gate_pass_obj_update on storage.objects;
create policy wh_gate_pass_obj_update on storage.objects for update
  using (bucket_id = 'wh-gate-passes' and (fn_wh_can('admin') or owner = auth.uid()));

drop policy if exists wh_gate_pass_obj_delete on storage.objects;
create policy wh_gate_pass_obj_delete on storage.objects for delete
  using (bucket_id = 'wh-gate-passes' and (fn_wh_can('admin') or owner = auth.uid()));
