-- ============================================================
-- Inventory — smooth flow: atomic request creation + approval dial
-- ============================================================
-- Replaces the 3 un-batched client inserts (request → items → status log,
-- which could orphan a request) with ONE atomic RPC that also drops the
-- redundant backoffice "availability check" step and applies the admin's
-- approval dial (app_settings.inv_approval_mode):
--
--   'always' (default) → PENDING_HOP  (the project's Atm Head OKs it, then the
--                                       storekeeper issues)
--   'off'              → APPROVED      (straight to the storekeeper to issue)
--   'off' + the requester IS this store's keeper + everything's in stock
--                      → ISSUED        (small-site self-service: they take it
--                                       now and it's logged)
--
-- Design notes:
--  * approved_qty is set to the requested qty up front. The old flow set it at
--    the backoffice step; with that step gone, we set it here so the existing
--    issue cap (issued_qty <= approved_qty) keeps working. The Atm Head step is
--    a status gate, not a qty edit (matches today's hop_approve, which only sets
--    is_returnable).
--  * NO stock reservation. Availability is enforced at ISSUE time by the
--    inv_stock.physical_qty >= 0 check constraint. This is deliberate: an
--    engineer must be able to REQUEST material that's out of stock (it signals a
--    procurement need) — it simply can't be issued until stock arrives. The
--    self-service auto-issue path is the only one that deducts, and it
--    pre-checks availability so it never violates the constraint.
--  * SECURITY DEFINER + an internal inventory-edit check mirrors the RLS write
--    policy, so authorization is unchanged from the client-insert path.
--
-- The existing hop_approve / hop_reject / store_issue / engineer_acknowledge
-- RPCs are unchanged and remain correct (their reserve-release is a no-op when
-- nothing was reserved). The backoffice RPCs are left in place but unreachable.
-- ============================================================

create or replace function public.inv_rpc_create_request(
  p_project    uuid,
  p_warehouse  uuid,
  p_urgency    text  default 'normal',
  p_purpose    text  default null,
  p_required_by date default null,
  p_lines      jsonb default '[]'::jsonb   -- [{"item_id":"..","requested_qty":5,"remarks":".."}]
) returns jsonb language plpgsql security definer as $$
declare
  v_actor       uuid := auth.uid();
  v_can_edit    boolean;
  v_mode        text;
  v_keeper      uuid;
  v_self        boolean;
  v_request_id  uuid;
  v_init        public.inv_request_status;
  v_line        jsonb;
  v_item_id     uuid;
  v_qty         numeric;
  v_avail       numeric;
  v_all_in_stock boolean := true;
  v_line_count  int := 0;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;

  -- Same gate as the RLS write policy on inv_requests.
  select exists (
    select 1 from public.role_permissions rp, public.profiles p
    where p.id = v_actor and rp.role = p.role
      and rp.module_slug = 'inventory' and rp.can_edit = true
  ) into v_can_edit;
  if not v_can_edit then
    raise exception 'You do not have permission to raise inventory requests';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item';
  end if;

  -- Approval dial (Inventory → Settings). Default = one Atm Head OK.
  select value into v_mode from public.app_settings where key = 'inv_approval_mode';
  v_mode := coalesce(nullif(trim(v_mode), ''), 'always');
  if v_mode not in ('off','always') then v_mode := 'always'; end if;

  -- Small-site self-service: the requester IS this store's keeper.
  select store_manager_id into v_keeper from public.inv_warehouses where id = p_warehouse;
  v_self := (v_keeper is not null and v_keeper = v_actor);

  -- Starting status from the dial.
  if v_mode = 'always' then
    v_init := 'PENDING_HOP';
  else
    v_init := 'APPROVED';
  end if;

  -- Self-service auto-issue only if the whole request is in stock right now.
  if v_mode = 'off' and v_self then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_item_id := (v_line->>'item_id')::uuid;
      v_qty     := (v_line->>'requested_qty')::numeric;
      if v_item_id is null or v_qty is null or v_qty <= 0 then continue; end if;
      select (physical_qty - reserved_qty - damaged_qty) into v_avail
      from public.inv_stock where item_id = v_item_id and warehouse_id = p_warehouse;
      if v_avail is null or v_avail < v_qty then v_all_in_stock := false; end if;
    end loop;
    if v_all_in_stock then v_init := 'ISSUED'; end if;
  end if;

  -- The request (request_no auto-set by trg_inv_set_request_no).
  insert into public.inv_requests(engineer_id, project_id, warehouse_id, status, urgency, purpose, required_by_date)
  values (
    v_actor, p_project, p_warehouse, v_init,
    coalesce(nullif(p_urgency,''),'normal')::public.inv_urgency,
    nullif(trim(coalesce(p_purpose,'')), ''),
    p_required_by
  )
  returning id into v_request_id;

  -- Lines. approved_qty = requested; issued_qty pre-filled only on self-issue.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_qty     := (v_line->>'requested_qty')::numeric;
    if v_item_id is null or v_qty is null or v_qty <= 0 then continue; end if;
    v_line_count := v_line_count + 1;

    insert into public.inv_request_items(request_id, item_id, requested_qty, approved_qty, issued_qty, remarks)
    values (
      v_request_id, v_item_id, v_qty, v_qty,
      case when v_init = 'ISSUED' then v_qty else 0 end,
      nullif(trim(coalesce(v_line->>'remarks','')), '')
    );

    if v_init = 'ISSUED' then
      update public.inv_stock
         set physical_qty = physical_qty - v_qty, last_updated = now()
       where item_id = v_item_id and warehouse_id = p_warehouse;
      insert into public.inv_stock_movements(item_id, warehouse_id, movement_type, qty, ref_table, ref_id, actor_id, remarks)
      values (v_item_id, p_warehouse, 'issue', v_qty, 'inv_requests', v_request_id, v_actor, 'Self-service issue at request');
    end if;
  end loop;

  if v_line_count = 0 then
    raise exception 'Add at least one item with a positive quantity';
  end if;

  insert into public.inv_request_status_log(request_id, from_status, to_status, actor_id, remarks, metadata)
  values (v_request_id, 'DRAFT', v_init, v_actor, 'Raised by engineer',
          jsonb_build_object('approval_mode', v_mode, 'self_service', v_self));

  if v_init = 'ISSUED' then
    update public.inv_requests
       set store_actor_id = v_actor, store_action_at = now(), updated_at = now()
     where id = v_request_id;
  end if;

  return jsonb_build_object('status','ok','request_id', v_request_id, 'new_status', v_init, 'self_service', v_self);
end $$;

grant execute on function public.inv_rpc_create_request(uuid,uuid,text,text,date,jsonb) to authenticated;
