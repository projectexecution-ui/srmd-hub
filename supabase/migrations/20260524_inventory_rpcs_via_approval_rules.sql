-- ============================================================
-- Re-deploy inventory RPCs to authorise via public.can_approve()
-- instead of hard-coded role lists. Behaviour is unchanged on day 1
-- because the bootstrap rules in approval_rules encode the same roles.
-- Going forward the Portal Owner / Admin can edit /admin/approvals to
-- change who acts at each stage without a code deploy.
--
-- inv_rpc_stock_receipt and inv_rpc_return_material are intentionally
-- NOT migrated — they're direct stock actions, not doc transitions,
-- so they still use the existing role-list check.
-- ============================================================

create or replace function public.inv_rpc_backoffice_approve(
  p_request_id uuid,
  p_approved_items jsonb,
  p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid;
  v_current_status public.inv_request_status;
  v_item record;
  v_available numeric;
  v_item_data jsonb;
begin
  if not public.can_approve('inventory','inv_request','PENDING_BACKOFFICE','PENDING_HOP') then
    raise exception 'You are not authorised to approve at this stage';
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

create or replace function public.inv_rpc_backoffice_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid();
begin
  if not public.can_approve('inventory','inv_request','PENDING_BACKOFFICE','REJECTED_BACKOFFICE') then
    raise exception 'You are not authorised to reject at this stage';
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

create or replace function public.inv_rpc_hop_approve(
  p_request_id uuid, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid();
begin
  if not public.can_approve('inventory','inv_request','PENDING_HOP','APPROVED') then
    raise exception 'You are not authorised to approve at this stage';
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

create or replace function public.inv_rpc_hop_reject(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid; v_item record;
begin
  if not public.can_approve('inventory','inv_request','PENDING_HOP','REJECTED_HOP') then
    raise exception 'You are not authorised to reject at this stage';
  end if;

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

create or replace function public.inv_rpc_store_issue(
  p_request_id uuid, p_issued_items jsonb, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_issue_qty numeric; v_item_data jsonb;
begin
  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status not in ('APPROVED','EMERGENCY_ISSUED') then
    raise exception 'Request not approved for issue (current: %)', v_status;
  end if;

  if not public.can_approve('inventory','inv_request', v_status::text, 'ISSUED') then
    raise exception 'You are not authorised to issue at this stage';
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

create or replace function public.inv_rpc_hop_emergency_authorize(
  p_request_id uuid, p_remarks text
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_available numeric;
begin
  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status != 'PENDING_BACKOFFICE' then
    raise exception 'Emergency override only allowed on PENDING_BACKOFFICE requests';
  end if;

  if not public.can_approve('inventory','inv_request','PENDING_BACKOFFICE','EMERGENCY_ISSUED') then
    raise exception 'You are not authorised to authorise an emergency bypass';
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
