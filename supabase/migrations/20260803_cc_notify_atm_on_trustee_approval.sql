-- ============================================================
-- Notify the Atm Head when the Trustee approves/releases a Cost Control
-- working sheet, so they can follow up with the IN4 person to enter it.
--
-- The existing notify_on_approval_event() trigger only notifies the NEXT
-- stage's approvers, so the FINAL Trustee approval (to_stage 'approved' /
-- 'partially_approved') currently pings nobody. This adds a separate,
-- self-contained trigger for that case — kept apart from the big approval
-- trigger so its logic stays simple and low-risk.
--
-- Recipient = the project's Atm Head(s): named 'head' approvers in
-- cc_project_approvers, else (only if none named) all active 'head' users —
-- exactly mirrors who gets the "Atm Head sign-off" notification.
-- Event type 'cc_estimate_approved' — controllable on /admin/notifications,
-- mutable per-user; renders via the generic email template.
-- ============================================================

create or replace function public.cc_notify_atm_on_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ws public.cc_working_sheets%rowtype;
  v_pcode text; v_pname text; v_sft numeric; v_sub text;
  v_amount numeric; v_verb text; v_title text; v_body text; v_url text; v_data jsonb;
  v_recipient uuid;
begin
  -- Only Cost Control working sheets reaching a Trustee release.
  if new.module_slug <> 'cost-control' or new.doc_type <> 'cc_working_sheet' then
    return new;
  end if;
  if new.to_stage not in ('approved', 'partially_approved') then
    return new;
  end if;

  select * into v_ws from public.cc_working_sheets where id = new.doc_id;
  if not found then return new; end if;

  select code, name, nullif(built_up_sft, 0) into v_pcode, v_pname, v_sft
    from public.projects where id = v_ws.project_id;
  select name into v_sub from public.cc_sub_skills where id = v_ws.sub_skill_id;

  v_amount := round(coalesce(v_ws.approved_for_erp_amt, v_ws.total_amount, 0));
  v_verb   := case when new.to_stage = 'approved' then 'approved' else 'partially released' end;
  v_url    := '/cost-control/working-sheets/' || v_ws.id::text;
  v_title  := 'Approved by Trustee — enter in IN4';
  v_body   := coalesce(v_sub, v_ws.ws_code)
              || ' for ' || coalesce(v_pcode, '')
              || case when v_pname is not null then ' · ' || v_pname else '' end
              || ' was ' || v_verb || ' by the Trustee. Please follow up with the IN4 team to enter it in IN4.';
  v_data := jsonb_build_object(
    'amount', v_amount,
    'per_sft', case when v_sft is not null and v_sft > 0 then round(v_amount / v_sft) else null end,
    'project', coalesce(v_pcode, '') || case when v_pname is not null then ' · ' || v_pname else '' end,
    'work', coalesce(v_sub, v_ws.ws_code),
    'stage_label', 'IN4 entry',
    'decision', new.to_stage
  );

  for v_recipient in
    select user_id
      from public.cc_project_approvers
     where project_id = v_ws.project_id and role = 'head'
    union
    select p.id
      from public.profiles p
     where p.is_active = true
       and p.role::text = 'head'
       and not exists (
         select 1 from public.cc_project_approvers a
         where a.project_id = v_ws.project_id and a.role = 'head'
       )
  loop
    if v_recipient is not null
       and v_recipient <> coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      perform public.notify_user(
        v_recipient, 'cc_estimate_approved', v_title, v_body, v_url,
        'cost-control', new.doc_table, new.doc_id, v_data);
    end if;
  end loop;

  return new;
end
$function$;

drop trigger if exists trg_cc_notify_atm_on_approval on public.approval_events;
create trigger trg_cc_notify_atm_on_approval
  after insert on public.approval_events
  for each row execute function public.cc_notify_atm_on_approval();
