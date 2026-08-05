-- ============================================================
-- Inventory — return guard: only returnable lines can be returned
-- ============================================================
-- Scenario testing found inv_rpc_return_material would accept a return against a
-- line that was never flagged is_returnable (e.g. consumed cement), inflating
-- stock. The UI only shows the return panel for returnable lines, but the RPC
-- didn't enforce it. Add the check. Otherwise unchanged.
-- ============================================================

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

  if v_item.id is null then raise exception 'Line not found'; end if;
  if not coalesce(v_item.is_returnable, false) then
    raise exception 'This item was not marked returnable — it cannot be returned';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a positive return quantity'; end if;
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
