-- Carry structured data through the notification pipeline so /api/email/send
-- can render the premium per-type email templates. Fully additive: any
-- notification with data=null renders the plain generic card (all other
-- modules unchanged).

alter table public.notifications add column if not exists data jsonb;

-- ── notify_user: accept + store an optional data payload ─────────────────
drop function if exists public.notify_user(uuid, text, text, text, text, text, text, uuid);
create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text,
  p_body text default null, p_url text default null,
  p_module_slug text default null, p_doc_table text default null, p_doc_id uuid default null,
  p_data jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to public
as $$
declare v_id uuid; v_pref record;
begin
  insert into public.notifications(user_id, module_slug, doc_table, doc_id, type, title, body, url, data)
  values (p_user_id, p_module_slug, p_doc_table, p_doc_id, p_type, p_title, p_body, p_url, p_data)
  returning id into v_id;

  select coalesce(in_app,true) as in_app, coalesce(email,true) as email,
         coalesce(telegram,false) as telegram, coalesce(web_push,false) as web_push
    into v_pref
  from public.notification_preferences where user_id = p_user_id;
  if not found then
    v_pref.in_app := true; v_pref.email := true; v_pref.telegram := false; v_pref.web_push := false;
  end if;

  if v_pref.in_app and public.notification_allowed(p_user_id, p_type, 'in_app') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'in_app','sent');
  end if;
  if v_pref.email and public.notification_allowed(p_user_id, p_type, 'email') then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'email');
  end if;
  if v_pref.telegram then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram');
  end if;
  if v_pref.web_push and public.notification_allowed(p_user_id, p_type, 'web_push') then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'web_push');
  end if;

  return v_id;
end $$;

-- ── dispatch: forward type + data to the email route ─────────────────────
create or replace function public.dispatch_email_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  v_url text; v_secret text; v_to text; v_subject text; v_body text; v_link text;
  v_type text; v_data jsonb;
begin
  if new.channel <> 'email' or new.status <> 'pending' then
    return new;
  end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  select n.title, n.body, n.url, n.type, n.data, coalesce(np.email_address, p.email)
    into v_subject, v_body, v_link, v_type, v_data, v_to
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = new.notification_id;

  if v_to is null or v_to = '' or v_to like 'anon-%' then
    update public.notification_deliveries set status = 'skipped' where id = new.id;
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'to', v_to,
                   'subject', coalesce(v_subject, 'CT HUB notification'),
                   'text', coalesce(v_body, ''),
                   'url', v_link,
                   'type', v_type,
                   'data', v_data,
                   'deliveryId', new.id
                 ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret)
    );
    update public.notification_deliveries set status = 'sent', sent_at = now() where id = new.id;
  exception when others then
    update public.notification_deliveries set status = 'failed', error = left(SQLERRM, 300) where id = new.id;
  end;

  return new;
end $function$;

-- ── approval notifier: enrich Cost Control approvals with rich data ──────
create or replace function public.notify_on_approval_event()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_actor text; v_recipient uuid; v_summary text; v_url text; v_title text;
  v_data jsonb := null;
  v_ws public.cc_working_sheets%rowtype;
  v_pcode text; v_pname text; v_sft numeric; v_sub text; v_eng text; v_est numeric;
  v_idx int; v_stage text;
begin
  select coalesce(name, full_name, email) into v_actor from public.profiles where id = new.actor_id;
  v_summary := coalesce(v_actor, 'Someone') || ' ' || new.decision || ' a ' || new.doc_type
            || ' (' || new.from_stage || ' → ' || new.to_stage || ')';
  v_url := '/approvals';
  v_title := 'Action needed: ' || new.doc_type;

  if new.module_slug = 'cost-control' and new.doc_type = 'cc_working_sheet' then
    select * into v_ws from public.cc_working_sheets where id = new.doc_id;
    if found then
      select code, name, nullif(built_up_sft, 0) into v_pcode, v_pname, v_sft from public.projects where id = v_ws.project_id;
      select name into v_sub from public.cc_sub_skills where id = v_ws.sub_skill_id;
      select coalesce(full_name, name) into v_eng from public.profiles where id = v_ws.engineer_id;
      select total_amount into v_est from public.cc_working_sheets
        where project_id = v_ws.project_id and sub_skill_id = v_ws.sub_skill_id
          and summary_notes like '[IB%' and status::text <> 'cancelled'
        order by created_at desc limit 1;

      if new.to_stage = 'submitted' then v_idx := 2; v_stage := 'Project Head sign-off';
      elsif new.to_stage = 'ph_approved' then v_idx := 3; v_stage := 'Atm Head sign-off';
      elsif new.to_stage in ('atm_approved', 'partially_approved') then v_idx := 4; v_stage := 'Trustee release';
      else v_idx := 2; v_stage := 'sign-off';
      end if;

      v_title := 'A budget needs your ' || v_stage;
      v_url := '/cost-control/working-sheets/' || v_ws.id::text;
      v_data := jsonb_build_object(
        'amount', round(coalesce(v_ws.total_amount, 0)),
        'per_sft', case when v_sft is not null and v_sft > 0 then round(coalesce(v_ws.total_amount, 0) / v_sft) else null end,
        'stage_label', v_stage,
        'stage_index', v_idx,
        'project', coalesce(v_pcode, '') || case when v_pname is not null then ' · ' || v_pname else '' end,
        'work', coalesce(v_sub, v_ws.ws_code),
        'raised_by', v_eng,
        'waiting_days', case when v_ws.submitted_at is not null then greatest(extract(day from now() - v_ws.submitted_at)::int, 0) else 0 end,
        'estimate', case when v_est is not null then round(v_est) else null end
      );
    end if;
  end if;

  for v_recipient in
    select distinct p.id
    from public.profiles p, public.approval_rules ar
    where p.is_active = true
      and ar.is_active = true
      and ar.module_slug = new.module_slug
      and ar.doc_type    = new.doc_type
      and ar.from_stage  = new.to_stage
      and (public.effective_user_role(p.id, ar.module_slug)::text = ar.approver_role
        or public.effective_user_role(p.id, ar.module_slug)::text = ar.override_role)
      and p.id <> coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform public.notify_user(v_recipient, 'approval_pending', v_title, v_summary, v_url,
                               new.module_slug, new.doc_table, new.doc_id, v_data);
  end loop;

  return new;
end $function$;

-- ── IN4 entered: attach rich data ────────────────────────────────────────
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
  if not (v_role = 'billing' or public.fn_cc_is_admin(auth.uid())) then
    raise exception 'Only the Billing team (or an admin) can mark IN4 entry';
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

-- ── IN4 follow-up digest: attach rich data ───────────────────────────────
create or replace function public.cc_in4_followup_digests()
returns integer
language plpgsql
security definer
set search_path to public
as $$
declare r record; n int := 0; v_data jsonb;
begin
  for r in
    select recip.user_id as user_id,
           count(*)      as cnt,
           sum(coalesce(ws.approved_for_erp_amt, 0)) as total,
           jsonb_agg(jsonb_build_object(
             'label', coalesce(pj.code, '') || ' · ' || coalesce(ss.name, ws.ws_code),
             'amount', round(coalesce(ws.approved_for_erp_amt, 0)),
             'days', greatest(extract(day from now() - coalesce(ws.approved_for_erp_at, ws.approved_at))::int, 0)
           ) order by coalesce(ws.approved_for_erp_at, ws.approved_at)) as items,
           string_agg(
             '• ' || coalesce(pj.code, '') || ' · ' || coalesce(ss.name, ws.ws_code)
                  || ' — ₹' || to_char(round(coalesce(ws.approved_for_erp_amt, 0)), 'FM999,999,999')
                  || ' (' || greatest(extract(day from now() - coalesce(ws.approved_for_erp_at, ws.approved_at))::int, 0) || 'd waiting)',
             E'\n' order by coalesce(ws.approved_for_erp_at, ws.approved_at)) as body
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
    v_data := jsonb_build_object(
      'count', r.cnt,
      'total_stuck', r.total,
      'items', (select jsonb_agg(e) from (select e from jsonb_array_elements(r.items) e limit 6) s),
      'more', greatest(r.cnt - 6, 0)
    );
    perform public.notify_user(
      r.user_id, 'in4_pending',
      r.cnt || ' budget' || case when r.cnt = 1 then '' else 's' end || ' waiting to be entered in IN4',
      'These released budgets are not yet entered in IN4, so their Work Orders are blocked:' || E'\n\n'
        || r.body || E'\n\nPlease push these through IN4 and mark them in CT Hub.',
      '/cost-control', 'cost-control', 'cc_working_sheets', null, v_data
    );
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.cc_in4_followup_digests() to service_role;
