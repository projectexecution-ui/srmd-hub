-- ============================================================
-- Inventory module — match Aksha's actual workflow
-- ============================================================
-- Changes from the original spec to fit the real team:
--   - Backoffice OR Storekeeper can mark a request "available to use"
--     (collapses two stages into one — single approval at this step).
--   - Atm Head (uses the existing `head` role) gives the final approval
--     and flags items as "needs return" per line.
--   - After issue, the requesting engineer confirms receipt — this is
--     the close trigger.
-- ============================================================

-- 1. Per-line returnable flag set during Atm Head approval.
alter table public.inv_request_items
  add column if not exists is_returnable boolean not null default false;

-- 2. Engineer receipt acknowledgement on the request itself.
alter table public.inv_requests
  add column if not exists engineer_acknowledged_at      timestamptz,
  add column if not exists engineer_acknowledged_by      uuid references public.profiles(id) on delete set null,
  add column if not exists engineer_acknowledgement_notes text;

-- 3. Backoffice approve: allow store_manager (storekeeper) too.
create or replace function public.inv_rpc_backoffice_approve(
  p_request_id uuid,
  p_approved_items jsonb,
  p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role;
  v_warehouse uuid;
  v_current_status public.inv_request_status;
  v_item record;
  v_available numeric;
  v_item_data jsonb;
begin
  select role into v_role from public.profiles where id = v_actor;
  -- Backoffice OR Storekeeper can do the availability check.
  if v_role not in ('backoffice','backoffice_backup','store_manager','admin') then
    raise exception 'Only backoffice or storekeeper can mark as available';
  end if;

  select status, warehouse_id into v_current_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_current_status != 'PENDING_BACKOFFICE' then
    raise exception 'Request not in pending-check state (current: %)', v_current_status;
  end if;

  for v_item_data in select * from jsonb_array_elements(p_approved_items) loop
    select ri.id, ri.item_id, (v_item_data->>'approved_qty')::numeric as approved_qty
    into v_item
    from public.inv_request_items ri
    where ri.id = (v_item_data->>'request_item_id')::uuid
      and ri.request_id = p_request_id;

    if v_item.id is null then
      raise exception 'Request item not found: %', v_item_data->>'request_item_id';
    end if;

    select (physical_qty - reserved_qty - damaged_qty) into v_available
    from public.inv_stock
    where item_id = v_item.item_id and warehouse_id = v_warehouse for update;

    if v_available is null or v_available < v_item.approved_qty then
      raise exception 'Insufficient stock for item % (available: %, needed: %)',
        v_item.item_id, coalesce(v_available, 0), v_item.approved_qty;
    end if;

    update public.inv_stock
       set reserved_qty = reserved_qty + v_item.approved_qty, last_updated = now()
     where item_id = v_item.item_id and warehouse_id = v_warehouse;

    update public.inv_request_items set approved_qty = v_item.approved_qty
     where id = v_item.id;
  end loop;

  update public.inv_requests set
    status = 'PENDING_HOP',
    backoffice_actor_id = v_actor,
    backoffice_action_at = now(),
    backoffice_remarks = p_remarks,
    updated_at = now()
  where id = p_request_id;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, 'PENDING_BACKOFFICE', 'PENDING_HOP', v_actor, p_remarks);

  return jsonb_build_object('status','ok','new_status','PENDING_HOP');
end $$;

-- 4. Backoffice reject — same expansion.
create or replace function public.inv_rpc_backoffice_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_role public.user_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('backoffice','backoffice_backup','store_manager','admin') then
    raise exception 'Unauthorized';
  end if;

  update public.inv_requests set
    status = 'REJECTED_BACKOFFICE',
    backoffice_actor_id = v_actor,
    backoffice_action_at = now(),
    backoffice_remarks = p_remarks,
    updated_at = now()
  where id = p_request_id and status = 'PENDING_BACKOFFICE';

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, 'PENDING_BACKOFFICE', 'REJECTED_BACKOFFICE', v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;

-- 5. Atm Head approve: accept head (canonical) + hop (legacy) + admin.
--    Also takes a per-line returnable map and writes inv_request_items.is_returnable.
create or replace function public.inv_rpc_hop_approve(
  p_request_id uuid,
  p_remarks text default null,
  p_returnable_items jsonb default '[]'::jsonb  -- [{"request_item_id":"...","is_returnable":true}]
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role;
  v_item_data jsonb;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('head','hop','admin') then
    raise exception 'Only Atm Head can approve at this stage';
  end if;

  -- Persist returnable flags per line BEFORE flipping status so the
  -- audit log row reflects the final state.
  if jsonb_array_length(coalesce(p_returnable_items, '[]'::jsonb)) > 0 then
    for v_item_data in select * from jsonb_array_elements(p_returnable_items) loop
      update public.inv_request_items
         set is_returnable = coalesce((v_item_data->>'is_returnable')::boolean, false)
       where id = (v_item_data->>'request_item_id')::uuid
         and request_id = p_request_id;
    end loop;
  end if;

  update public.inv_requests set
    status = 'APPROVED',
    hop_actor_id = v_actor,
    hop_action_at = now(),
    hop_remarks = p_remarks,
    updated_at = now()
  where id = p_request_id and status = 'PENDING_HOP';

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, 'PENDING_HOP', 'APPROVED', v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;

-- 6. Atm Head reject: same role expansion.
create or replace function public.inv_rpc_hop_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_warehouse uuid; v_item record;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('head','hop','admin') then raise exception 'Unauthorized'; end if;

  select warehouse_id into v_warehouse from public.inv_requests
  where id = p_request_id and status = 'PENDING_HOP' for update;

  if v_warehouse is null then
    raise exception 'Request not in pending-approval state';
  end if;

  for v_item in
    select item_id, approved_qty from public.inv_request_items
    where request_id = p_request_id and approved_qty > 0
  loop
    update public.inv_stock
       set reserved_qty = greatest(reserved_qty - v_item.approved_qty, 0),
           last_updated = now()
     where item_id = v_item.item_id and warehouse_id = v_warehouse;
  end loop;

  update public.inv_requests set
    status = 'REJECTED_HOP',
    hop_actor_id = v_actor,
    hop_action_at = now(),
    hop_remarks = p_remarks,
    updated_at = now()
  where id = p_request_id;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, 'PENDING_HOP', 'REJECTED_HOP', v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;

-- 7. Emergency authorize: same role expansion.
create or replace function public.inv_rpc_hop_emergency_authorize(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_available numeric;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('head','hop','admin') then raise exception 'Only Atm Head can authorize emergency bypass'; end if;

  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status != 'PENDING_BACKOFFICE' then
    raise exception 'Emergency override only allowed on pending-check requests';
  end if;

  for v_item in
    select id, item_id, requested_qty from public.inv_request_items where request_id = p_request_id
  loop
    select (physical_qty - reserved_qty - damaged_qty) into v_available
    from public.inv_stock where item_id = v_item.item_id and warehouse_id = v_warehouse for update;

    if v_available < v_item.requested_qty then
      raise exception 'Insufficient stock even for emergency (item %)', v_item.item_id;
    end if;

    update public.inv_stock set reserved_qty = reserved_qty + v_item.requested_qty
     where item_id = v_item.item_id and warehouse_id = v_warehouse;

    update public.inv_request_items set approved_qty = requested_qty where id = v_item.id;
  end loop;

  update public.inv_requests set
    status = 'EMERGENCY_ISSUED',
    is_emergency = true,
    emergency_authorized_by = v_actor,
    hop_actor_id = v_actor,
    hop_action_at = now(),
    hop_remarks = 'EMERGENCY BYPASS: ' || p_remarks,
    updated_at = now()
  where id = p_request_id;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
  values (p_request_id, v_status, 'EMERGENCY_ISSUED', v_actor, p_remarks, jsonb_build_object('bypass', true));

  return jsonb_build_object('status','ok','message','Emergency authorised — ready for Store to issue');
end $$;

-- 8. NEW: engineer receipt acknowledgement.
create or replace function public.inv_rpc_engineer_acknowledge(
  p_request_id uuid, p_notes text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_engineer uuid;
  v_status public.inv_request_status;
  v_role public.user_role;
  v_returnable_count integer;
begin
  select role into v_role from public.profiles where id = v_actor;
  select engineer_id, status into v_engineer, v_status from public.inv_requests where id = p_request_id for update;

  -- Must be the requesting engineer (or an admin override) and must be ISSUED.
  if v_engineer is null then raise exception 'Request not found'; end if;
  if v_actor != v_engineer and v_role != 'admin' then
    raise exception 'Only the requesting engineer can acknowledge receipt';
  end if;
  if v_status not in ('ISSUED','EMERGENCY_ISSUED') then
    raise exception 'Receipt acknowledgement only valid for issued requests (current: %)', v_status;
  end if;

  -- If any line is flagged as returnable + still has outstanding qty,
  -- we keep status at ISSUED (receipt acknowledged, but return loop open).
  -- Otherwise we close the request.
  select count(*) into v_returnable_count
  from public.inv_request_items
  where request_id = p_request_id
    and is_returnable = true
    and (issued_qty - returned_good_qty - returned_damaged_qty) > 0;

  update public.inv_requests set
    engineer_acknowledged_at = now(),
    engineer_acknowledged_by = v_actor,
    engineer_acknowledgement_notes = p_notes,
    status = case when v_returnable_count = 0 then 'CLOSED'::public.inv_request_status else status end,
    updated_at = now()
  where id = p_request_id;

  if v_returnable_count = 0 then
    insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
    values (p_request_id, v_status, 'CLOSED', v_actor, coalesce(p_notes, 'Receipt acknowledged'));
  else
    -- No status change — just record the receipt event in the audit log.
    insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
    values (p_request_id, v_status, v_status, v_actor, coalesce(p_notes, 'Receipt acknowledged'), jsonb_build_object('event','receipt_acknowledged'));
  end if;

  return jsonb_build_object('status','ok', 'closed', v_returnable_count = 0, 'outstanding_returnables', v_returnable_count);
end $$;
