-- ============================================================
-- Inventory go-live wave 1 — cancel, keeper-can-issue, bulk receipt
-- ============================================================

-- 1) Cancel / withdraw a request the engineer raised by mistake. Allowed before
--    it's issued (PENDING_HOP / APPROVED / EMERGENCY_ISSUED). No stock was
--    deducted at those stages (the smooth flow doesn't reserve), so there's
--    nothing to release — just mark it cancelled + log.
create or replace function public.inv_rpc_cancel_request(p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_eng uuid; v_status public.inv_request_status; v_role text;
begin
  select engineer_id, status into v_eng, v_status from public.inv_requests where id = p_request_id for update;
  if v_eng is null then raise exception 'Request not found'; end if;
  select role::text into v_role from public.profiles where id = v_actor;
  if v_actor <> v_eng and coalesce(v_role,'') <> 'admin' then
    raise exception 'Only the engineer who raised it (or an admin) can cancel it';
  end if;
  if v_status not in ('PENDING_HOP','APPROVED','EMERGENCY_ISSUED') then
    raise exception 'This request can no longer be cancelled (it is already %)', v_status;
  end if;
  update public.inv_requests set status = 'CANCELLED_BY_ENGINEER', updated_at = now() where id = p_request_id;
  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks)
  values (p_request_id, v_status, 'CANCELLED_BY_ENGINEER', v_actor, nullif(btrim(coalesce(p_reason,'')), ''));
  return jsonb_build_object('status','ok');
end $$;
grant execute on function public.inv_rpc_cancel_request(uuid,text) to authenticated;

-- NOTE: a "let the warehouse keeper issue regardless of role" clause was tried
-- here and dropped — the generic enforce_approval_via_matrix trigger re-checks
-- can_approve() on the status change, so a keeper whose role isn't store_manager
-- is blocked anyway. The correct model: a DEDICATED storekeeper holds the
-- Storekeeper (store_manager) role. (Small-site engineer-as-keeper still works
-- because self-service issues at request time and bypasses this path.)
-- store_issue is defined in 20260805_inventory_issue_guard.sql (guard-only).

-- 2) Bulk stock receipt — record a whole delivery (many lines) in one atomic
--    call instead of one item at a time.
create or replace function public.inv_rpc_stock_receipt_bulk(
  p_warehouse_id uuid, p_lines jsonb, p_remarks text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_line jsonb; v_item uuid; v_qty numeric; v_n int := 0;
begin
  if not exists (
    select 1 from public.role_permissions rp, public.profiles p
    where p.id = v_actor and rp.role = p.role and rp.module_slug = 'inventory' and rp.can_edit = true
  ) then
    raise exception 'You do not have permission to receive stock';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line->>'item_id')::uuid;
    v_qty  := (v_line->>'qty')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;

    insert into public.inv_stock(item_id, warehouse_id, physical_qty)
      values (v_item, p_warehouse_id, v_qty)
    on conflict (item_id, warehouse_id)
      do update set physical_qty = public.inv_stock.physical_qty + v_qty, last_updated = now();

    insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, actor_id, remarks)
      values (v_item, p_warehouse_id, 'receipt', v_qty, v_actor, p_remarks);
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Add at least one item with a positive quantity'; end if;
  return jsonb_build_object('status','ok','lines', v_n);
end $$;
grant execute on function public.inv_rpc_stock_receipt_bulk(uuid,jsonb,text) to authenticated;
