-- ============================================================
-- Fix: a returnable request must CLOSE once everything is back
-- ============================================================
-- The gate pass / acknowledge RPCs deliberately keep a request ISSUED when it
-- has returnable lines still out (tools, formwork). But nothing closed it after
-- the last item came back — inv_rpc_return_material never transitioned the
-- request, and no trigger did either. Result: fully-returned, acknowledged
-- requests sat "Issued" forever and looked open to management.
--
-- This replaces inv_rpc_return_material with identical behaviour PLUS a final
-- step: if the request has been acknowledged (gate pass recorded / receipt
-- confirmed) and no returnable line is still outstanding, move it to CLOSED and
-- log it — mirroring the close path in inv_rpc_record_gate_pass. Additive only.
create or replace function public.inv_rpc_return_material(
  p_request_item_id uuid, p_qty numeric, p_condition inv_return_condition, p_remarks text default null
)
returns jsonb
language plpgsql security definer
as $function$
declare
  v_actor uuid := auth.uid(); v_role public.user_role;
  v_item record; v_warehouse uuid;
  v_req uuid; v_ack timestamptz; v_status public.inv_request_status; v_outstanding integer;
begin
  select role into v_role from public.profiles where id = v_actor;

  select ri.*, r.warehouse_id as wh into v_item
  from public.inv_request_items ri
  join public.inv_requests r on r.id = ri.request_id
  where ri.id = p_request_item_id;
  if v_item.id is null then raise exception 'Line not found'; end if;
  v_warehouse := v_item.wh;

  -- Authorized: storekeeper/engineer/admin by role, OR whoever keeps this store.
  if not (v_role in ('store_manager','engineer','admin')
          or exists (select 1 from public.inv_warehouses w where w.id = v_warehouse and w.store_manager_id = v_actor)) then
    raise exception 'You are not authorised to log returns';
  end if;

  if not coalesce(v_item.is_returnable, false) then
    raise exception 'This item was not marked returnable — it cannot be returned';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a positive return quantity'; end if;
  if p_qty > (v_item.issued_qty - v_item.returned_good_qty - v_item.returned_damaged_qty) then
    raise exception 'Return qty exceeds outstanding issued qty';
  end if;

  if p_condition = 'good' then
    update public.inv_stock set physical_qty = physical_qty + p_qty, last_updated = now()
     where item_id = v_item.item_id and warehouse_id = v_warehouse;
    update public.inv_request_items set returned_good_qty = returned_good_qty + p_qty where id = p_request_item_id;
    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'return_good', p_qty, 'inv_request_items', p_request_item_id, v_actor, p_remarks);
  else
    update public.inv_stock set damaged_qty = damaged_qty + p_qty, physical_qty = physical_qty + p_qty
     where item_id = v_item.item_id and warehouse_id = v_warehouse;
    update public.inv_request_items set returned_damaged_qty = returned_damaged_qty + p_qty where id = p_request_item_id;
    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'return_damaged', p_qty, 'inv_request_items', p_request_item_id, v_actor, p_remarks);
  end if;

  insert into public.inv_returns(request_id, request_item_id, qty, condition, returned_by, received_by, remarks)
  values (v_item.request_id, p_request_item_id, p_qty, p_condition, v_actor, v_actor, p_remarks);

  -- Close the request once it's been acknowledged AND nothing returnable is left
  -- outstanding — the lifecycle end that was previously never reached.
  v_req := v_item.request_id;
  select engineer_acknowledged_at, status into v_ack, v_status
    from public.inv_requests where id = v_req for update;
  select count(*) into v_outstanding
  from public.inv_request_items
  where request_id = v_req and is_returnable = true
    and (issued_qty - returned_good_qty - returned_damaged_qty) > 0;

  if v_ack is not null and v_outstanding = 0 and v_status in ('ISSUED','EMERGENCY_ISSUED') then
    update public.inv_requests set status = 'CLOSED', updated_at = now() where id = v_req;
    insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
    values (v_req, v_status, 'CLOSED', v_actor, 'All returnable items returned — request closed',
            jsonb_build_object('event', 'returnables_completed'));
  end if;

  return jsonb_build_object('status','ok','closed', (v_ack is not null and v_outstanding = 0));
end $function$;

grant execute on function public.inv_rpc_return_material(uuid, numeric, inv_return_condition, text) to authenticated;
