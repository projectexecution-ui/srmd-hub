-- ============================================================
-- Inventory — reorder levels + low-stock digest
-- ============================================================
-- min_threshold existed on inv_stock but nothing could set it, so is_low_stock
-- never fired meaningfully. This adds a setter + a digest that notifies each
-- store's keeper (fallback admins) of what's running low.
-- ============================================================

create or replace function public.inv_rpc_set_reorder(p_warehouse_id uuid, p_item_id uuid, p_min numeric)
returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid();
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles p
                 where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit=true) then
    raise exception 'You do not have permission to set reorder levels';
  end if;
  if p_min is null or p_min < 0 then raise exception 'Enter 0 or more'; end if;
  insert into public.inv_stock(item_id, warehouse_id, physical_qty, min_threshold)
    values (p_item_id, p_warehouse_id, 0, p_min)
  on conflict (item_id, warehouse_id) do update set min_threshold = p_min, last_updated = now();
  return jsonb_build_object('status','ok');
end $$;
grant execute on function public.inv_rpc_set_reorder(uuid,uuid,numeric) to authenticated;

-- Daily low-stock nudge (called by the cron dispatcher). One notification per
-- warehouse-with-low-items to its keeper, or to admins if no keeper is set.
create or replace function public.inv_low_stock_digest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wh record; v_recip uuid; v_count int := 0; v_body text;
begin
  for v_wh in
    select w.id, w.code, w.name, w.store_manager_id
    from public.inv_warehouses w
    where w.is_active = true
      and exists (select 1 from public.inv_stock_available sa
                  where sa.warehouse_id = w.id and sa.is_low_stock = true)
  loop
    select string_agg(x.item_code || ' (' || round(x.available_qty)::text || ')', ', ')
      into v_body
      from (select item_code, available_qty from public.inv_stock_available
            where warehouse_id = v_wh.id and is_low_stock = true
            order by available_qty asc limit 8) x;

    if v_wh.store_manager_id is not null then
      perform public.notify_user(v_wh.store_manager_id, 'inv_low_stock',
        'Low stock at ' || v_wh.code,
        'Running low: ' || coalesce(v_body, 'some items') || '. Time to reorder.',
        '/inventory/stock?warehouse=' || v_wh.id::text, 'inventory', 'inv_warehouses', v_wh.id);
      v_count := v_count + 1;
    else
      for v_recip in select id from public.profiles where role = 'admin' and is_active = true loop
        perform public.notify_user(v_recip, 'inv_low_stock',
          'Low stock at ' || v_wh.code,
          'Running low: ' || coalesce(v_body, 'some items') || '. Time to reorder.',
          '/inventory/stock?warehouse=' || v_wh.id::text, 'inventory', 'inv_warehouses', v_wh.id);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('status','ok','notified', v_count);
end $$;
grant execute on function public.inv_low_stock_digest() to authenticated, service_role;
