-- ============================================================
-- Inventory module — atomic RPC functions
-- ============================================================
-- Ported from the standalone spec's 002_rpc_functions.sql:
--   - All `users` references → public.profiles
--   - All bare table names → public.inv_* equivalents
--   - Function names prefixed `inv_rpc_` to avoid clashes
--
-- These are the ONLY way stock should change. Direct UPDATE on inv_stock
-- bypasses the audit log (inv_stock_movements) and the request state
-- machine — don't do it from app code.
-- ============================================================

-- ============= 1. BACKOFFICE APPROVES → RESERVE STOCK =============
create or replace function public.inv_rpc_backoffice_approve(
  p_request_id uuid,
  p_approved_items jsonb,   -- [{"request_item_id":"...","approved_qty":50}, ...]
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
  if v_role not in ('backoffice','backoffice_backup','admin') then
    raise exception 'Only backoffice can approve at this stage';
  end if;

  select status, warehouse_id into v_current_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_current_status != 'PENDING_BACKOFFICE' then
    raise exception 'Request not in PENDING_BACKOFFICE state (current: %)', v_current_status;
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

-- ============= 2. BACKOFFICE REJECTS =============
create or replace function public.inv_rpc_backoffice_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_role public.user_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('backoffice','backoffice_backup','admin') then
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

-- ============= 3. HOP APPROVES =============
create or replace function public.inv_rpc_hop_approve(
  p_request_id uuid, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_role public.user_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('hop','admin') then
    raise exception 'Only HoP can approve at this stage';
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

-- ============= 4. HOP REJECTS → RELEASE RESERVATION =============
create or replace function public.inv_rpc_hop_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_warehouse uuid; v_item record;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('hop','admin') then raise exception 'Unauthorized'; end if;

  select warehouse_id into v_warehouse from public.inv_requests
  where id = p_request_id and status = 'PENDING_HOP' for update;

  if v_warehouse is null then
    raise exception 'Request not in PENDING_HOP state';
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

-- ============= 5. STORE ISSUES → DEDUCT STOCK =============
create or replace function public.inv_rpc_store_issue(
  p_request_id uuid, p_issued_items jsonb, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_issue_qty numeric; v_item_data jsonb;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('store_manager','admin') then
    raise exception 'Only Store Manager can issue';
  end if;

  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status not in ('APPROVED','EMERGENCY_ISSUED') then
    raise exception 'Request not approved for issue (current: %)', v_status;
  end if;

  for v_item_data in select * from jsonb_array_elements(p_issued_items) loop
    select ri.id, ri.item_id, ri.approved_qty, ri.issued_qty into v_item
    from public.inv_request_items ri
    where ri.id = (v_item_data->>'request_item_id')::uuid;

    v_issue_qty := (v_item_data->>'issued_qty')::numeric;

    if v_issue_qty > v_item.approved_qty then
      raise exception 'Cannot issue more than approved (item %)', v_item.item_id;
    end if;

    update public.inv_stock set
      physical_qty = physical_qty - v_issue_qty,
      reserved_qty = greatest(reserved_qty - v_item.approved_qty, 0),
      last_updated = now()
    where item_id = v_item.item_id and warehouse_id = v_warehouse;

    update public.inv_request_items set issued_qty = v_issue_qty where id = v_item.id;

    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'issue', v_issue_qty, 'inv_requests', p_request_id, v_actor, p_remarks);
  end loop;

  update public.inv_requests set
    status = 'ISSUED',
    store_actor_id = v_actor,
    store_action_at = now(),
    store_remarks = p_remarks,
    updated_at = now()
  where id = p_request_id;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, v_status, 'ISSUED', v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;

-- ============= 6. HOP EMERGENCY OVERRIDE =============
create or replace function public.inv_rpc_hop_emergency_authorize(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_available numeric;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role != 'hop' then raise exception 'Only HoP can authorize emergency bypass'; end if;

  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status != 'PENDING_BACKOFFICE' then
    raise exception 'Emergency override only allowed on PENDING_BACKOFFICE requests';
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

  return jsonb_build_object('status','ok','message','Emergency authorized — ready for Store to issue');
end $$;

-- ============= 7. STOCK RECEIPT =============
create or replace function public.inv_rpc_stock_receipt(
  p_warehouse_id uuid, p_item_id uuid, p_qty numeric, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_role public.user_role;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('store_manager','admin') then
    raise exception 'Only Store Manager can record receipt';
  end if;
  if p_qty <= 0 then raise exception 'Receipt qty must be positive'; end if;

  insert into public.inv_stock(item_id, warehouse_id, physical_qty)
  values (p_item_id, p_warehouse_id, p_qty)
  on conflict (item_id, warehouse_id) do update
    set physical_qty = public.inv_stock.physical_qty + p_qty,
        last_updated = now();

  insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
  values (p_item_id, p_warehouse_id, 'receipt', p_qty, v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;

-- ============= 8. RETURN MATERIAL =============
create or replace function public.inv_rpc_return_material(
  p_request_item_id uuid, p_qty numeric, p_condition public.inv_return_condition, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_item record; v_warehouse uuid;
begin
  select role into v_role from public.profiles where id = v_actor;
  if v_role not in ('store_manager','engineer','admin') then
    raise exception 'Unauthorized';
  end if;

  select ri.*, r.warehouse_id as wh into v_item
  from public.inv_request_items ri
  join public.inv_requests r on r.id = ri.request_id
  where ri.id = p_request_item_id;

  if p_qty > (v_item.issued_qty - v_item.returned_good_qty - v_item.returned_damaged_qty) then
    raise exception 'Return qty exceeds outstanding issued qty';
  end if;

  v_warehouse := v_item.wh;

  if p_condition = 'good' then
    update public.inv_stock set physical_qty = physical_qty + p_qty, last_updated = now()
     where item_id = v_item.item_id and warehouse_id = v_warehouse;

    update public.inv_request_items set returned_good_qty = returned_good_qty + p_qty
     where id = p_request_item_id;

    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'return_good', p_qty, 'inv_request_items', p_request_item_id, v_actor, p_remarks);
  else
    update public.inv_stock set damaged_qty = damaged_qty + p_qty, physical_qty = physical_qty + p_qty
     where item_id = v_item.item_id and warehouse_id = v_warehouse;

    update public.inv_request_items set returned_damaged_qty = returned_damaged_qty + p_qty
     where id = p_request_item_id;

    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'return_damaged', p_qty, 'inv_request_items', p_request_item_id, v_actor, p_remarks);
  end if;

  insert into public.inv_returns(request_id, request_item_id, qty, condition, returned_by, received_by, remarks)
  values (v_item.request_id, p_request_item_id, p_qty, p_condition, v_actor, v_actor, p_remarks);

  return jsonb_build_object('status','ok');
end $$;
