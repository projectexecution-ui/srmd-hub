-- ============================================================
-- Inventory — format quantities in the low-stock digest
-- ============================================================
-- Standard-formatting rule: the daily low-stock email/bell now shows grouped
-- quantities (inv_fmt_qty) instead of raw rounded numbers.
-- ============================================================

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
    select string_agg(x.item_code || ' (' || public.inv_fmt_qty(x.available_qty) || ')', ', ')
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
