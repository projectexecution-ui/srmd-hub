-- ============================================================
-- Inventory go-live fixes — access, keeper-can-issue, returnable-at-request
-- ============================================================
-- From the engineer + storekeeper journey audits:
--  #1 store_manager role never got an inventory role_permissions row (added
--     after the seed), and other operational roles were toggled off → nobody
--     but admin could use the module. Re-seed sensible operational access.
--  #2 A warehouse's keeper (inv_warehouses.store_manager_id) could not issue
--     unless their ROLE was store_manager — both the store_issue RPC and the
--     generic approval-matrix trigger reject them. Authorize the keeper of the
--     request's warehouse to issue, whatever their base role.
--  #3 Returns were impossible in 'off' mode because is_returnable is only set
--     at the (skipped) Atm Head step. Let the engineer mark a line returnable
--     at request time; create_request now stores it.
-- ============================================================

-- ── #1 Access: turn Inventory on for the operational roles (matches the
--     original foundation intent; store_manager added). Admin can fine-tune at
--     /admin/permissions. ────────────────────────────────────────────────────
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('store_manager','inventory', true,  true,  false),
  ('engineer',     'inventory', true,  true,  false),
  ('head',         'inventory', true,  true,  false),
  ('uploader',     'inventory', true,  true,  false),
  ('viewer',       'inventory', true,  false, false),
  ('founder',      'inventory', true,  false, false)
on conflict (role, module_slug) do update
  set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- ── #2a Approval-matrix trigger: also allow the warehouse's keeper to issue
--     their own store's requests. Tightly guarded to inventory issue only —
--     cannot affect other modules. ─────────────────────────────────────────
create or replace function public.enforce_approval_via_matrix()
 returns trigger language plpgsql security definer as $function$
declare
  v_module      text := tg_argv[0];
  v_doc_type    text := tg_argv[1];
  v_status_col  text := tg_argv[2];
  v_amount_col  text;
  v_amount      numeric;
  v_from        text;
  v_to          text;
  v_has_rule    boolean;
begin
  if auth.uid() is null then return new; end if;
  v_from := (to_jsonb(old) ->> v_status_col);
  v_to   := (to_jsonb(new) ->> v_status_col);
  if v_from is null or v_to is null or v_from = v_to then return new; end if;

  select exists (
    select 1 from public.approval_rules ar
    where ar.is_active and ar.module_slug = v_module and ar.doc_type = v_doc_type
      and ar.from_stage = v_from and ar.to_stage = v_to
  ) into v_has_rule;
  if not v_has_rule then return new; end if;

  if tg_nargs >= 4 then
    v_amount_col := tg_argv[3];
    v_amount := nullif(abs(
      coalesce(((to_jsonb(new) ->> v_amount_col))::numeric, 0)
      - coalesce(((to_jsonb(old) ->> v_amount_col))::numeric, 0)), 0);
  end if;

  if public.can_approve(v_module, v_doc_type, v_from, v_to, v_amount) then
    return new;
  end if;

  -- Inventory carve-out: the keeper of this request's warehouse may issue it.
  if v_module = 'inventory' and v_doc_type = 'inv_request' and v_to = 'ISSUED'
     and exists (
       select 1 from public.inv_warehouses w
       where w.id = (to_jsonb(new) ->> 'warehouse_id')::uuid
         and w.store_manager_id = auth.uid()
     ) then
    return new;
  end if;

  raise exception
    'Not authorised: you cannot move % from % to % (configured by an admin in Approvals)',
    v_doc_type, v_from, v_to;
end $function$;

-- ── #2b store_issue: same keeper allowance in the RPC's own gate. (Keeps the
--     partial-issue + availability-guard behaviour.) ──────────────────────────
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
    select ri.id, ri.item_id, ri.approved_qty, ri.issued_qty into v_item
    from public.inv_request_items ri
    where ri.id = (v_item_data->>'request_item_id')::uuid;

    v_issue_qty := (v_item_data->>'issued_qty')::numeric;
    if v_issue_qty is null or v_issue_qty < 0 then raise exception 'Enter a valid issue quantity'; end if;
    if v_issue_qty = 0 then continue; end if;
    if coalesce(v_item.issued_qty, 0) + v_issue_qty > coalesce(v_item.approved_qty, 0) then
      raise exception 'Cannot issue more than approved (item % — % already issued of %)',
        v_item.item_id, coalesce(v_item.issued_qty,0), coalesce(v_item.approved_qty,0);
    end if;

    select (physical_qty - damaged_qty) into v_avail from public.inv_stock
      where item_id = v_item.item_id and warehouse_id = v_warehouse for update;
    if v_avail is null then raise exception 'This item is not stocked in this store yet — receive it first'; end if;
    if v_avail < v_issue_qty then raise exception 'Only % in stock — cannot issue %', v_avail, v_issue_qty; end if;

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

-- ── #3 create_request: accept is_returnable per line so returns work even when
--     there's no Atm Head step ('off' mode). ─────────────────────────────────
create or replace function public.inv_rpc_create_request(
  p_project    uuid,
  p_warehouse  uuid,
  p_urgency    text  default 'normal',
  p_purpose    text  default null,
  p_required_by date default null,
  p_lines      jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_actor uuid := auth.uid(); v_can_edit boolean; v_mode text; v_keeper uuid; v_self boolean;
  v_request_id uuid; v_init public.inv_request_status; v_line jsonb; v_item_id uuid; v_qty numeric;
  v_avail numeric; v_all_in_stock boolean := true; v_line_count int := 0;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles p
    where p.id = v_actor and rp.role = p.role and rp.module_slug = 'inventory' and rp.can_edit = true) into v_can_edit;
  if not v_can_edit then raise exception 'You do not have permission to raise inventory requests'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;

  select value into v_mode from public.app_settings where key = 'inv_approval_mode';
  v_mode := coalesce(nullif(trim(v_mode), ''), 'always');
  if v_mode not in ('off','always') then v_mode := 'always'; end if;

  select store_manager_id into v_keeper from public.inv_warehouses where id = p_warehouse;
  v_self := (v_keeper is not null and v_keeper = v_actor);

  if v_mode = 'always' then v_init := 'PENDING_HOP'; else v_init := 'APPROVED'; end if;

  if v_mode = 'off' and v_self then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_item_id := (v_line->>'item_id')::uuid; v_qty := (v_line->>'requested_qty')::numeric;
      if v_item_id is null or v_qty is null or v_qty <= 0 then continue; end if;
      select (physical_qty - reserved_qty - damaged_qty) into v_avail
      from public.inv_stock where item_id = v_item_id and warehouse_id = p_warehouse;
      if v_avail is null or v_avail < v_qty then v_all_in_stock := false; end if;
    end loop;
    if v_all_in_stock then v_init := 'ISSUED'; end if;
  end if;

  insert into public.inv_requests(engineer_id, project_id, warehouse_id, status, urgency, purpose, required_by_date)
  values (v_actor, p_project, p_warehouse, v_init,
    coalesce(nullif(p_urgency,''),'normal')::public.inv_urgency,
    nullif(trim(coalesce(p_purpose,'')), ''), p_required_by)
  returning id into v_request_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid; v_qty := (v_line->>'requested_qty')::numeric;
    if v_item_id is null or v_qty is null or v_qty <= 0 then continue; end if;
    v_line_count := v_line_count + 1;

    insert into public.inv_request_items(request_id, item_id, requested_qty, approved_qty, issued_qty, remarks, is_returnable)
    values (v_request_id, v_item_id, v_qty, v_qty,
      case when v_init = 'ISSUED' then v_qty else 0 end,
      nullif(trim(coalesce(v_line->>'remarks','')), ''),
      coalesce((v_line->>'is_returnable')::boolean, false));

    if v_init = 'ISSUED' then
      update public.inv_stock set physical_qty = physical_qty - v_qty, last_updated = now()
        where item_id = v_item_id and warehouse_id = p_warehouse;
      insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
      values (v_item_id, p_warehouse, 'issue', v_qty, 'inv_requests', v_request_id, v_actor, 'Self-service issue at request');
    end if;
  end loop;

  if v_line_count = 0 then raise exception 'Add at least one item with a positive quantity'; end if;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
  values (v_request_id, 'DRAFT', v_init, v_actor, 'Raised by engineer',
          jsonb_build_object('approval_mode', v_mode, 'self_service', v_self));

  if v_init = 'ISSUED' then
    update public.inv_requests set store_actor_id = v_actor, store_action_at = now(), updated_at = now()
     where id = v_request_id;
  end if;

  return jsonb_build_object('status','ok','request_id', v_request_id, 'new_status', v_init, 'self_service', v_self);
end $$;
