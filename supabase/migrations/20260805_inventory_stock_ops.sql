-- ============================================================
-- Inventory — stock operations: adjustment, transfer, damage
-- ============================================================
-- The movement enum already had adjustment / transfer_in / transfer_out /
-- damage but no RPCs or UI. These add them (SECURITY DEFINER, gated on
-- inventory edit), each logging the right movement so stock stays auditable.
-- ============================================================

-- Physical-count correction: set on-hand to the counted number, log the delta.
create or replace function public.inv_rpc_stock_adjust(
  p_warehouse_id uuid, p_item_id uuid, p_new_physical numeric, p_reason text
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_old numeric; v_delta numeric;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles p
                 where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit=true) then
    raise exception 'You do not have permission to adjust stock';
  end if;
  if p_new_physical is null or p_new_physical < 0 then raise exception 'Enter a valid quantity (0 or more)'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'A reason is required for a stock adjustment'; end if;

  select physical_qty into v_old from public.inv_stock
    where item_id = p_item_id and warehouse_id = p_warehouse_id for update;
  if v_old is null then
    insert into public.inv_stock(item_id, warehouse_id, physical_qty) values (p_item_id, p_warehouse_id, p_new_physical);
    v_old := 0;
  else
    update public.inv_stock set physical_qty = p_new_physical, last_updated = now()
      where item_id = p_item_id and warehouse_id = p_warehouse_id;
  end if;
  v_delta := p_new_physical - v_old;

  insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
    values (p_item_id, p_warehouse_id, 'adjustment', v_delta, v_actor, p_reason);
  return jsonb_build_object('status','ok','old',v_old,'new',p_new_physical,'delta',v_delta);
end $$;
grant execute on function public.inv_rpc_stock_adjust(uuid,uuid,numeric,text) to authenticated;

-- Move stock between two stores.
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
    raise exception 'Only % available in the source store — cannot transfer %', coalesce(v_avail,0), p_qty;
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
grant execute on function public.inv_rpc_stock_transfer(uuid,uuid,uuid,numeric,text) to authenticated;

-- Write off in-store breakage/spoilage: move qty from physical to damaged.
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
    raise exception 'Only % on hand — cannot write off %', coalesce(v_phys,0), p_qty;
  end if;

  update public.inv_stock set physical_qty = physical_qty - p_qty, damaged_qty = damaged_qty + p_qty, last_updated = now()
    where item_id = p_item_id and warehouse_id = p_warehouse_id;
  insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
    values (p_item_id, p_warehouse_id, 'damage', p_qty, v_actor, p_reason);
  return jsonb_build_object('status','ok');
end $$;
grant execute on function public.inv_rpc_stock_damage(uuid,uuid,numeric,text) to authenticated;
