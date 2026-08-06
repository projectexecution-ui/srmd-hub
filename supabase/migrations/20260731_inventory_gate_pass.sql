-- ============================================================
-- Inventory: signed gate-pass on issue (replaces engineer's app confirm)
-- ============================================================
-- After the storekeeper issues material, they photograph the gate pass the
-- receiving engineer signed at the counter. That signed copy IS the proof of
-- receipt, so it stamps engineer_acknowledged_at and closes the request —
-- retiring the engineer's separate in-app "confirm receipt" step.
-- Additive + non-breaking. Reuses inv_requests / inv_warehouses / profiles.

create extension if not exists "uuid-ossp";

-- 1. Signed gate-pass copies (one+ per request; supports partial issues).
create table if not exists public.inv_gate_passes (
  id           uuid primary key default uuid_generate_v4(),
  request_id   uuid not null references public.inv_requests(id) on delete cascade,
  path         text not null,                    -- object key in the gate-passes bucket
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists inv_gate_passes_request_idx on public.inv_gate_passes(request_id);

alter table public.inv_gate_passes enable row level security;

-- Visible to anyone who can see the parent request (the inv_requests RLS filters
-- the subquery for the caller). Writes happen only via the SECURITY DEFINER RPC.
drop policy if exists inv_gate_passes_select on public.inv_gate_passes;
create policy inv_gate_passes_select on public.inv_gate_passes
  for select to authenticated
  using (exists (select 1 from public.inv_requests r where r.id = request_id));

drop policy if exists inv_gate_passes_admin_del on public.inv_gate_passes;
create policy inv_gate_passes_admin_del on public.inv_gate_passes
  for delete to authenticated
  using (public.current_user_role() = 'admin');

-- 2. Private storage bucket for the signed copies.
insert into storage.buckets (id, name, public)
values ('inv-gate-passes', 'inv-gate-passes', false)
on conflict (id) do nothing;

update storage.buckets
  set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf']
  where id = 'inv-gate-passes';

drop policy if exists inv_gate_passes_obj_select on storage.objects;
create policy inv_gate_passes_obj_select on storage.objects
  for select to authenticated using (bucket_id = 'inv-gate-passes');

drop policy if exists inv_gate_passes_obj_insert on storage.objects;
create policy inv_gate_passes_obj_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'inv-gate-passes');

drop policy if exists inv_gate_passes_obj_update on storage.objects;
create policy inv_gate_passes_obj_update on storage.objects
  for update to authenticated using (
    bucket_id = 'inv-gate-passes' and (public.current_user_role() = 'admin' or owner = auth.uid())
  );

drop policy if exists inv_gate_passes_obj_delete on storage.objects;
create policy inv_gate_passes_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'inv-gate-passes' and (public.current_user_role() = 'admin' or owner = auth.uid())
  );

-- 3. RPC: record the signed gate pass + close the request.
-- Gated to the store KEEPER (inv_warehouses.store_manager_id) or admin. Mirrors
-- inv_rpc_engineer_acknowledge's close logic: stamps engineer_acknowledged_* and
-- moves the request to CLOSED unless returnable lines are still outstanding.
create or replace function public.inv_rpc_record_gate_pass(
  p_request_id uuid, p_path text, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role;
  v_engineer uuid;
  v_status public.inv_request_status;
  v_wh uuid;
  v_keeper uuid;
  v_returnable_count integer;
begin
  select role into v_role from public.profiles where id = v_actor;
  select engineer_id, status, warehouse_id
    into v_engineer, v_status, v_wh
    from public.inv_requests where id = p_request_id for update;
  if v_engineer is null then raise exception 'Request not found'; end if;

  select store_manager_id into v_keeper from public.inv_warehouses where id = v_wh;
  if v_role <> 'admin' and (v_keeper is null or v_keeper <> v_actor) then
    raise exception 'Only the store keeper can upload the gate pass for this request';
  end if;

  if v_status not in ('ISSUED', 'EMERGENCY_ISSUED') then
    raise exception 'Gate pass only applies to issued requests (current: %)', v_status;
  end if;
  if coalesce(btrim(p_path), '') = '' then
    raise exception 'Gate pass file is required';
  end if;

  insert into public.inv_gate_passes(request_id, path, uploaded_by)
  values (p_request_id, p_path, v_actor);

  select count(*) into v_returnable_count
  from public.inv_request_items
  where request_id = p_request_id and is_returnable = true
    and (issued_qty - returned_good_qty - returned_damaged_qty) > 0;

  update public.inv_requests set
    engineer_acknowledged_at    = coalesce(engineer_acknowledged_at, now()),
    engineer_acknowledged_by    = coalesce(engineer_acknowledged_by, v_engineer),
    engineer_acknowledgement_notes = coalesce(engineer_acknowledgement_notes, p_notes),
    status = case when v_returnable_count = 0 then 'CLOSED'::public.inv_request_status else status end,
    updated_at = now()
  where id = p_request_id;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
  values (
    p_request_id, v_status,
    case when v_returnable_count = 0 then 'CLOSED'::public.inv_request_status else v_status end,
    v_actor, coalesce(p_notes, 'Signed gate pass uploaded'),
    jsonb_build_object('event', 'gate_pass_uploaded')
  );

  return jsonb_build_object('status', 'ok', 'closed', v_returnable_count = 0, 'outstanding_returnables', v_returnable_count);
end $$;

grant execute on function public.inv_rpc_record_gate_pass(uuid, text, text) to authenticated;
