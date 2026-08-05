-- ============================================================
-- Inventory — store-issue availability guard (data-integrity fix)
-- ============================================================
-- Bug found in scenario testing: issuing an item that has NO stock row in the
-- warehouse (or less physical than issued) silently "succeeded" — the UPDATE
-- matched zero rows, so nothing was deducted, but issued_qty + an issue
-- movement were still written. Result: phantom stock booked as issued, and the
-- physical_qty >= 0 constraint never fires because there's no row to violate.
--
-- Fix: before deducting, look up the on-hand qty and refuse with a clear message
-- if the item isn't stocked here or there isn't enough. Also skip 0-qty lines
-- (partial issue) and reject invalid quantities. Everything else is unchanged.
-- Additive/stricter only — safe against the currently-deployed UI (same call
-- shape); it just turns a silent corruption into a friendly error.
-- ============================================================

create or replace function public.inv_rpc_store_issue(
  p_request_id uuid, p_issued_items jsonb, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_issue_qty numeric; v_item_data jsonb; v_avail numeric;
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
    if v_issue_qty is null or v_issue_qty < 0 then
      raise exception 'Enter a valid issue quantity';
    end if;
    if v_issue_qty = 0 then continue; end if;  -- this line isn't being issued now

    if v_issue_qty > coalesce(v_item.approved_qty, 0) then
      raise exception 'Cannot issue more than approved (item %)', v_item.item_id;
    end if;

    -- Availability guard — the crux of the fix.
    select (physical_qty - damaged_qty) into v_avail from public.inv_stock
      where item_id = v_item.item_id and warehouse_id = v_warehouse for update;
    if v_avail is null then
      raise exception 'This item is not stocked in this store yet — receive it first';
    end if;
    if v_avail < v_issue_qty then
      raise exception 'Only % in stock — cannot issue %', v_avail, v_issue_qty;
    end if;

    update public.inv_stock set
      physical_qty = physical_qty - v_issue_qty,
      reserved_qty = greatest(reserved_qty - coalesce(v_item.approved_qty, 0), 0),
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
