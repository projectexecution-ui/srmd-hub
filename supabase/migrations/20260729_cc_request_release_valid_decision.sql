-- FIX: cc_request_release inserted decision='release_requested', which is not
-- in the shared approval_events_decision_check
-- (approved|rejected|returned|submitted|cancelled|noted) — so the engineer's
-- "request balance release" on a partly-released sheet failed every time with a
-- CHECK violation. Use the valid decision 'submitted' (the sheet does go back to
-- status 'submitted' and re-enters the approval chain); the balance-request
-- wording stays in the comment, and ApprovalTimeline already recognises the
-- request via to_stage='submitted'. The shared cross-module constraint is left
-- untouched.
create or replace function public.cc_request_release(p_ws uuid, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws record;
  v_balance numeric;
begin
  select id, engineer_id, status, total_amount, approved_for_erp_amt
    into v_ws
    from public.cc_working_sheets
   where id = p_ws
   for update;

  if v_ws.id is null then
    raise exception 'Working Sheet not found';
  end if;
  if v_ws.engineer_id is distinct from auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'Only the sheet owner can request the balance release';
  end if;
  if v_ws.status <> 'partially_approved' then
    raise exception 'Only a partly released sheet can request a balance release';
  end if;

  v_balance := greatest(coalesce(v_ws.total_amount, 0) - coalesce(v_ws.approved_for_erp_amt, 0), 0);
  if v_balance <= 0 then
    raise exception 'Nothing left to release on this sheet';
  end if;

  update public.cc_working_sheets
     set status = 'submitted', submitted_at = now()
   where id = p_ws and status = 'partially_approved';

  insert into public.approval_events
    (module_slug, doc_type, doc_table, doc_id, from_stage, to_stage, actor_id, decision, comment, attachments)
  values
    ('cost-control', 'cc_working_sheet', 'cc_working_sheets', p_ws,
     'partially_approved', 'submitted', auth.uid(), 'submitted',
     'Requested release of balance ₹' || to_char(round(v_balance), 'FM99,99,99,99,999')
       || case when nullif(trim(coalesce(p_note, '')), '') is not null then ' — ' || trim(p_note) else '' end,
     '[]'::jsonb);
end $function$;
