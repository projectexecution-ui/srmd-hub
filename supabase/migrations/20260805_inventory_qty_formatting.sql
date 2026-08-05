-- ============================================================
-- Inventory — human quantity formatting in error messages
-- ============================================================
-- "Only 2910.000 in stock — cannot issue 11111" → "Only 2,910 … cannot issue
-- 11,111". A small formatter (grouping + trimmed decimals) used in every
-- quantity message; the over-approved message now shows the item CODE, not its
-- raw UUID.
-- ============================================================

create or replace function public.inv_fmt_qty(n numeric)
returns text language sql immutable as $$
  select rtrim(to_char(coalesce(n, 0), 'FM999,999,999,990.999'), '.')
$$;

create or replace function public.inv_rpc_store_issue(
  p_request_id uuid, p_issued_items jsonb, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid();
  v_warehouse uuid; v_status public.inv_request_status;
  v_item record; v_issue_qty numeric; v_item_data jsonb; v_avail numeric; v_fully boolean;
begin
  select status, warehouse_id into v_status, v_warehouse
  from public.inv_requests where id = p_request_id for update;

  if v_status not in ('APPROVED','EMERGENCY_ISSUED') then
    raise exception 'Request not approved for issue (current: %)', v_status;
  end if;

  if not (public.can_approve('inventory','inv_request', v_status::text, 'ISSUED')
          or exists (select 1 from public.inv_warehouses w
                     where w.id = v_warehouse and w.store_manager_id = v_actor)) then
    raise exception 'You are not authorised to issue at this stage';
  end if;

  for v_item_data in select * from jsonb_array_elements(p_issued_items) loop
    select ri.id, ri.item_id, ri.approved_qty, ri.issued_qty, it.code as item_code, it.name as item_name
    into v_item
    from public.inv_request_items ri
    join public.inv_items it on it.id = ri.item_id
    where ri.id = (v_item_data->>'request_item_id')::uuid;

    v_issue_qty := (v_item_data->>'issued_qty')::numeric;
    if v_issue_qty is null or v_issue_qty < 0 then raise exception 'Enter a valid issue quantity'; end if;
    if v_issue_qty = 0 then continue; end if;
    if coalesce(v_item.issued_qty, 0) + v_issue_qty > coalesce(v_item.approved_qty, 0) then
      raise exception 'Cannot issue more than approved for % — % already issued of %',
        v_item.item_name, public.inv_fmt_qty(v_item.issued_qty), public.inv_fmt_qty(v_item.approved_qty);
    end if;

    select (physical_qty - damaged_qty) into v_avail from public.inv_stock
      where item_id = v_item.item_id and warehouse_id = v_warehouse for update;
    if v_avail is null then
      raise exception '% is not stocked in this store yet — receive it first', v_item.item_name;
    end if;
    if v_avail < v_issue_qty then
      raise exception 'Only % in stock — cannot issue %', public.inv_fmt_qty(v_avail), public.inv_fmt_qty(v_issue_qty);
    end if;

    update public.inv_stock set
      physical_qty = physical_qty - v_issue_qty,
      reserved_qty = greatest(reserved_qty - v_issue_qty, 0),
      last_updated = now()
    where item_id = v_item.item_id and warehouse_id = v_warehouse;
    update public.inv_request_items set issued_qty = coalesce(issued_qty,0) + v_issue_qty where id = v_item.id;
    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
    values (v_item.item_id, v_warehouse, 'issue', v_issue_qty, 'inv_requests', p_request_id, v_actor, p_remarks);
  end loop;

  select not exists (
    select 1 from public.inv_request_items ri
    where ri.request_id = p_request_id and coalesce(ri.issued_qty,0) < coalesce(ri.approved_qty,0)
  ) into v_fully;

  if v_fully then
    update public.inv_requests set status = 'ISSUED', store_actor_id = v_actor, store_action_at = now(),
      store_remarks = p_remarks, updated_at = now() where id = p_request_id;
    insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
    values (p_request_id, v_status, 'ISSUED', v_actor, p_remarks);
  else
    update public.inv_requests set store_actor_id = v_actor, store_action_at = now(),
      store_remarks = p_remarks, updated_at = now() where id = p_request_id;
  end if;

  return jsonb_build_object('status','ok','fully_issued', v_fully);
end $$;

create or replace function public.inv_rpc_stock_transfer(
  p_from_warehouse uuid, p_to_warehouse uuid, p_item_id uuid, p_qty numeric, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_avail numeric;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles p
                 where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit=true) then
    raise exception 'You do not have permission to transfer stock';
  end if;
  if p_from_warehouse = p_to_warehouse then raise exception 'Pick two different stores'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a positive quantity'; end if;

  select (physical_qty - damaged_qty) into v_avail from public.inv_stock
    where item_id = p_item_id and warehouse_id = p_from_warehouse for update;
  if v_avail is null or v_avail < p_qty then
    raise exception 'Only % available in the source store — cannot transfer %', public.inv_fmt_qty(coalesce(v_avail,0)), public.inv_fmt_qty(p_qty);
  end if;

  update public.inv_stock set physical_qty = physical_qty - p_qty, last_updated = now()
    where item_id = p_item_id and warehouse_id = p_from_warehouse;
  insert into public.inv_stock(item_id, warehouse_id, physical_qty) values (p_item_id, p_to_warehouse, p_qty)
    on conflict (item_id, warehouse_id) do update set physical_qty = public.inv_stock.physical_qty + p_qty, last_updated = now();

  insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
    values (p_item_id, p_from_warehouse, 'transfer_out', p_qty, v_actor, p_remarks),
           (p_item_id, p_to_warehouse,   'transfer_in',  p_qty, v_actor, p_remarks);
  return jsonb_build_object('status','ok');
end $$;

create or replace function public.inv_rpc_stock_damage(
  p_warehouse_id uuid, p_item_id uuid, p_qty numeric, p_reason text
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_phys numeric;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles p
                 where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit=true) then
    raise exception 'You do not have permission to write off stock';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a positive quantity'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'A reason is required for a damage write-off'; end if;

  select physical_qty into v_phys from public.inv_stock
    where item_id = p_item_id and warehouse_id = p_warehouse_id for update;
  if v_phys is null or v_phys < p_qty then
    raise exception 'Only % on hand — cannot write off %', public.inv_fmt_qty(coalesce(v_phys,0)), public.inv_fmt_qty(p_qty);
  end if;

  update public.inv_stock set physical_qty = physical_qty - p_qty, damaged_qty = damaged_qty + p_qty, last_updated = now()
    where item_id = p_item_id and warehouse_id = p_warehouse_id;
  insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
    values (p_item_id, p_warehouse_id, 'damage', p_qty, v_actor, p_reason);
  return jsonb_build_object('status','ok');
end $$;
