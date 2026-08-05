-- ============================================================
-- Inventory — notifications on every hop (the adoption fix)
-- ============================================================
-- Today nothing tells anyone anything, so the chain dies in an inbox nobody
-- opens. This wires inventory into the hub's existing notify_user pipeline
-- (bell + email + web-push, per each user's own preferences) via ONE trigger on
-- the status-log: every request transition writes a log row, so a single
-- function fans the right message to the right person for each new status.
--
--   → PENDING_HOP  : tell the project's Atm Head (inv_project_setup.hop_id;
--                    falls back to admins) — a request needs approval
--   → APPROVED /
--     EMERGENCY_ISSUED : tell the store's keeper (inv_warehouses.store_manager_id;
--                    falls back to admins) — material is ready to hand over
--   → ISSUED       : tell the requesting engineer — collect & confirm
--   → REJECTED_*   : tell the requesting engineer — with the reason
--
-- The actor of a transition is never notified about their own action. New
-- notification types default to instant + allowed (notification_mode /
-- notification_allowed fall through to permissive), so they deliver on every
-- channel with no rule seeding. Purely additive — no RPC or app change.
-- ============================================================

create or replace function public.inv_notify_on_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_req      record;
  v_actor    uuid := coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_keeper   uuid;
  v_hop      uuid;
  v_reqno    text;
  v_proj     text;
  v_url      text;
  v_recip    uuid;
begin
  select r.request_no, r.engineer_id, r.project_id, r.warehouse_id, p.code as proj_code
    into v_req
  from public.inv_requests r
  left join public.projects p on p.id = r.project_id
  where r.id = new.request_id;
  if not found then return new; end if;

  v_url   := '/inventory/requests/' || new.request_id::text;
  v_reqno := coalesce(v_req.request_no, 'A material request');
  v_proj  := coalesce(v_req.proj_code, 'a project');

  -- ── Needs approval → the project's Atm Head (fallback: admins) ──
  if new.to_status = 'PENDING_HOP' then
    select hop_id into v_hop from public.inv_project_setup where project_id = v_req.project_id;
    if v_hop is not null and v_hop <> v_actor then
      perform public.notify_user(
        v_hop, 'inv_request_pending', 'Material request needs your OK',
        v_reqno || ' for ' || v_proj || ' is waiting for your approval.',
        v_url, 'inventory', 'inv_requests', new.request_id);
    else
      for v_recip in
        select id from public.profiles where role = 'admin' and is_active = true and id <> v_actor
      loop
        perform public.notify_user(
          v_recip, 'inv_request_pending', 'Material request needs approval',
          v_reqno || ' for ' || v_proj || ' is waiting for approval.',
          v_url, 'inventory', 'inv_requests', new.request_id);
      end loop;
    end if;

  -- ── Ready to issue → the store's keeper (fallback: admins) ──
  elsif new.to_status in ('APPROVED', 'EMERGENCY_ISSUED') then
    select store_manager_id into v_keeper from public.inv_warehouses where id = v_req.warehouse_id;
    if v_keeper is not null and v_keeper <> v_actor then
      perform public.notify_user(
        v_keeper, 'inv_request_to_issue', 'New material to hand over',
        v_reqno || ' for ' || v_proj || ' is ready to issue.',
        v_url, 'inventory', 'inv_requests', new.request_id);
    else
      for v_recip in
        select id from public.profiles where role = 'admin' and is_active = true and id <> v_actor
      loop
        perform public.notify_user(
          v_recip, 'inv_request_to_issue', 'New material to hand over',
          v_reqno || ' for ' || v_proj || ' is ready to issue.',
          v_url, 'inventory', 'inv_requests', new.request_id);
      end loop;
    end if;

  -- ── Issued → the requesting engineer (collect & confirm) ──
  elsif new.to_status = 'ISSUED' then
    if v_req.engineer_id is not null and v_req.engineer_id <> v_actor then
      perform public.notify_user(
        v_req.engineer_id, 'inv_request_issued', 'Your material is ready',
        v_reqno || ' for ' || v_proj || ' has been issued — please collect and confirm receipt.',
        v_url, 'inventory', 'inv_requests', new.request_id);
    end if;

  -- ── Rejected → the requesting engineer (with reason) ──
  elsif new.to_status in ('REJECTED_HOP', 'REJECTED_BACKOFFICE') then
    if v_req.engineer_id is not null and v_req.engineer_id <> v_actor then
      perform public.notify_user(
        v_req.engineer_id, 'inv_request_rejected', 'Material request declined',
        v_reqno || ' for ' || v_proj || ' was not approved.'
          || coalesce(' Reason: ' || nullif(btrim(new.remarks), ''), ''),
        v_url, 'inventory', 'inv_requests', new.request_id);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_inv_notify_on_status on public.inv_request_status_log;
create trigger trg_inv_notify_on_status
  after insert on public.inv_request_status_log
  for each row execute function public.inv_notify_on_status();
