-- IN4 entry for the Coordinator (Parimal's role), not just the Billing role.
--
-- Problem: the "enter in IN4" step was wired only to the `billing` role:
--   1. cc_notify_atm_on_approval() sent the "Approved by Trustee — enter in IN4"
--      alert to the project's ATM HEADS (who don't key IN4), not the person who
--      actually enters it.
--   2. cc_mark_in4_entered() rejected anyone who wasn't `billing`/admin.
-- SRASSK's IN4-entry person is the Coordinator (Parimal). Making him `billing`
-- would strip his Coordinator setup rights (one effective role per module), so
-- instead we let the Coordinator role ALSO do IN4 entry — it is pure tracking
-- (no money moves; Budget/ERP still comes only from the BPH pull).
--
-- Additive: replaces two functions only. No schema/table/enum change.

-- 1) Route the release → "enter in IN4" alert to the IN4-entry people
--    (effective cost-control role billing OR coordinator), falling back to
--    admins if nobody is designated, so the nudge is never lost. (Function name
--    kept for stability; it is no longer Atm-Head-specific.)
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
  -- Deep-link to the IN4 entry queue, where the Mark-Entered action lives.
  v_url    := '/cost-control/billing';
  v_title  := 'Approved by Trustee — enter in IN4';
  v_body   := coalesce(v_sub, v_ws.ws_code)
              || ' for ' || coalesce(v_pcode, '')
              || case when v_pname is not null then ' · ' || v_pname else '' end
              || ' was ' || v_verb || ' by the Trustee. Please enter it in IN4 and mark it done here.';
  v_data := jsonb_build_object(
    'amount', v_amount,
    'per_sft', case when v_sft is not null and v_sft > 0 then round(v_amount / v_sft) else null end,
    'project', coalesce(v_pcode, '') || case when v_pname is not null then ' · ' || v_pname else '' end,
    'work', coalesce(v_sub, v_ws.ws_code),
    'stage_label', 'IN4 entry',
    'decision', new.to_stage
  );

  for v_recipient in
    -- The IN4-entry people: whoever holds the cost-control 'billing' or
    -- 'coordinator' effective role.
    select p.id
      from public.profiles p
     where p.is_active = true
       and public.effective_user_role(p.id, 'cost-control')::text in ('billing', 'coordinator')
    union
    -- Fallback: if nobody is designated, tell the admins so it is never lost.
    select p.id
      from public.profiles p
     where p.is_active = true
       and p.role::text = 'admin'
       and not exists (
         select 1 from public.profiles q
         where q.is_active = true
           and public.effective_user_role(q.id, 'cost-control')::text in ('billing', 'coordinator')
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

-- 2) Let the Coordinator (in addition to Billing / admin) mark IN4 entry.
create or replace function public.cc_mark_in4_entered(p_ws_id uuid, p_ref text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ws public.cc_working_sheets%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_role := coalesce(public.effective_user_role(auth.uid(), 'cost-control')::text, '');
  if not (v_role in ('billing', 'coordinator') or public.fn_cc_is_admin(auth.uid())) then
    raise exception 'Only the IN4-entry team (Billing / Coordinator) or an admin can mark IN4 entry';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then raise exception 'Working Sheet not found'; end if;
  if v_ws.status::text not in ('approved', 'partially_approved') then
    raise exception 'Only released sheets can be marked as entered in IN4';
  end if;
  if coalesce(v_ws.approved_for_erp_amt, 0) <= 0 then
    raise exception 'Nothing has been released on this sheet yet';
  end if;
  if v_ws.in4_entered_at is not null then
    raise exception 'This sheet is already marked as entered in IN4';
  end if;

  update public.cc_working_sheets
     set in4_entered_at = now(), in4_entered_by = auth.uid(),
         in4_ref = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_ws_id;

  begin
    declare
      v_proj text; v_sub text; v_msg text; v_r uuid; v_ref text; v_data jsonb;
    begin
      select code into v_proj from public.projects where id = v_ws.project_id;
      select name into v_sub  from public.cc_sub_skills where id = v_ws.sub_skill_id;
      v_ref := nullif(btrim(coalesce(p_ref, '')), '');
      v_msg := coalesce(v_proj, '') || ' · ' || coalesce(v_sub, v_ws.ws_code)
             || ' — the released budget (₹' || to_char(round(coalesce(v_ws.approved_for_erp_amt, 0)), 'FM999,999,999') || ')'
             || ' is now entered in IN4' || coalesce(' (ref ' || v_ref || ')', '') || '. The Work Order can now proceed.';
      v_data := jsonb_build_object(
        'project', coalesce(v_proj, ''),
        'work', coalesce(v_sub, v_ws.ws_code),
        'amount', round(coalesce(v_ws.approved_for_erp_amt, 0)),
        'ref', v_ref
      );
      for v_r in
        select unnest(array_remove(array[v_ws.engineer_id], null))
        union
        select public.cc_ph_atm_recipients(v_ws.project_id)
      loop
        perform public.notify_user(v_r, 'in4_entered', 'Entered in IN4 — ' || coalesce(v_proj, 'budget'),
          v_msg, '/cost-control/working-sheets/' || p_ws_id::text, 'cost-control', 'cc_working_sheets', p_ws_id, v_data);
      end loop;
    end;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true);
end
$function$;
