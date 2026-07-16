-- IN4-entry notifications (native Gmail queue via notify_user):
--   1. When Billing marks a sheet entered in IN4 → notify the requesting
--      engineer + that project's Project Head + Atm Head (NOT the Trustee).
--   2. A repeating cumulative digest to each Project Head / Atm Head listing
--      every released sheet still not entered in IN4 after 3+ days (Work Orders
--      are blocked until entry). One summary email per person, not one per sheet.

-- ── Recipient helper ────────────────────────────────────────────────────
-- Project Head + Atm Head (roles project_head, head) for a project: the named
-- per-project approvers if any, else the active role-holders as fallback.
-- Never the Trustee (founder).
create or replace function public.cc_ph_atm_recipients(p_project uuid)
returns setof uuid
language sql
stable
security definer
set search_path to public
as $$
  select user_id
  from public.cc_project_approvers
  where project_id = p_project and role in ('project_head', 'head')
  union
  select p.id
  from public.profiles p
  where p.is_active = true
    and p.role::text in ('project_head', 'head')
    and not exists (
      select 1 from public.cc_project_approvers a
      where a.project_id = p_project and a.role = p.role::text
    )
$$;

-- ── Mark IN4 entered (recreated with the notification block) ─────────────
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
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  v_role := coalesce(public.effective_user_role(auth.uid(), 'cost-control')::text, '');
  if not (v_role = 'billing' or public.fn_cc_is_admin(auth.uid())) then
    raise exception 'Only the Billing team (or an admin) can mark IN4 entry';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then
    raise exception 'Working Sheet not found';
  end if;
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
     set in4_entered_at = now(),
         in4_entered_by = auth.uid(),
         in4_ref        = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_ws_id;

  -- Notify requester + Project Head + Atm Head (not the Trustee). Best-effort:
  -- a notification hiccup must never fail the IN4 marking.
  begin
    declare
      v_proj text;
      v_sub  text;
      v_msg  text;
      v_r    uuid;
    begin
      select code into v_proj from public.projects where id = v_ws.project_id;
      select name into v_sub  from public.cc_sub_skills where id = v_ws.sub_skill_id;
      v_msg := coalesce(v_proj, '') || ' · ' || coalesce(v_sub, v_ws.ws_code)
             || ' — the released budget (₹' || to_char(round(coalesce(v_ws.approved_for_erp_amt, 0)), 'FM999,999,999') || ')'
             || ' is now entered in IN4'
             || coalesce(' (ref ' || nullif(btrim(coalesce(p_ref, '')), '') || ')', '')
             || '. The Work Order can now proceed.';
      for v_r in
        select unnest(array_remove(array[v_ws.engineer_id], null))
        union
        select public.cc_ph_atm_recipients(v_ws.project_id)
      loop
        perform public.notify_user(
          v_r, 'in4_entered',
          'Entered in IN4 — ' || coalesce(v_proj, 'budget'),
          v_msg,
          '/cost-control/working-sheets/' || p_ws_id::text,
          'cost-control', 'cc_working_sheets', p_ws_id
        );
      end loop;
    end;
  exception when others then
    -- swallow — marking already succeeded
    null;
  end;

  return jsonb_build_object('ok', true);
end
$function$;

-- ── 3-day follow-up digest ──────────────────────────────────────────────
-- One cumulative summary per Project Head / Atm Head of every released sheet
-- still not in IN4 after 3+ days. Returns the number of digest emails queued.
create or replace function public.cc_in4_followup_digests()
returns integer
language plpgsql
security definer
set search_path to public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select recip.user_id as user_id,
           count(*)      as cnt,
           string_agg(
             '• ' || coalesce(pj.code, '') || ' · ' || coalesce(ss.name, ws.ws_code)
                  || ' — ₹' || to_char(round(coalesce(ws.approved_for_erp_amt, 0)), 'FM999,999,999')
                  || ' (' || greatest(extract(day from now() - coalesce(ws.approved_for_erp_at, ws.approved_at))::int, 0) || 'd waiting)',
             E'\n' order by coalesce(ws.approved_for_erp_at, ws.approved_at)
           ) as body
    from public.cc_working_sheets ws
    cross join lateral public.cc_ph_atm_recipients(ws.project_id) as recip(user_id)
    left join public.projects pj on pj.id = ws.project_id
    left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
    where ws.status::text in ('approved', 'partially_approved')
      and coalesce(ws.approved_for_erp_amt, 0) > 0
      and ws.in4_entered_at is null
      and coalesce(ws.approved_for_erp_at, ws.approved_at) <= now() - interval '3 days'
    group by recip.user_id
  loop
    perform public.notify_user(
      r.user_id, 'in4_pending',
      r.cnt || ' budget' || case when r.cnt = 1 then '' else 's' end || ' waiting to be entered in IN4',
      'These released budgets are not yet entered in IN4, so their Work Orders are blocked:' || E'\n\n'
        || r.body || E'\n\nPlease push these through IN4 and mark them in CT Hub.',
      '/cost-control', 'cost-control', 'cc_working_sheets', null
    );
    n := n + 1;
  end loop;
  return n;
end
$$;

grant execute on function public.cc_ph_atm_recipients(uuid) to authenticated;
grant execute on function public.cc_in4_followup_digests() to service_role;
