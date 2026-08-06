-- ============================================================
-- Close the "Atm Head never hears the Trustee approved" gap.
--
-- Background: 20260803 first pinged the project's Atm Heads when the Trustee
-- gave the final release. 20260804 (in4_entry_coordinator) RE-POINTED that same
-- alert to the IN4-entry person (Coordinator/Billing) — so the Atm Head stopped
-- getting anything at the moment of approval. This restores an approval alert to
-- the people who championed the budget, WITHOUT disturbing the coordinator's
-- "enter in IN4" alert or any approval logic:
--
--   * Atm Head        → INSTANT  (new trigger, type 'cc_budget_approved')
--   * Project Head +   → once-a-day DIGEST (type 'cc_budget_approved_digest',
--     the raising Engineer   driven by cc_budget_approved_digest(), fired from
--                            the existing /api/cron dispatch — no new Vercel cron)
--
-- All additive: one nullable column, one helper, two functions, one trigger.
-- No schema/table/enum change to anything shared.
-- ============================================================

-- 0) Reusable Indian-grouped rupee formatter for server-side message text, so
--    notification bodies match the app's ₹1,23,45,678 grouping (the email cards
--    format from raw `data`, but the bell/body text needs it inline).
create or replace function public.fn_inr(p numeric)
returns text
language plpgsql
immutable
as $function$
declare s text; head text; tail text; res text;
begin
  if p is null then return '₹0'; end if;
  s := to_char(round(abs(p)), 'FM999999999999999');
  if length(s) <= 3 then
    return '₹' || case when p < 0 then '-' else '' end || s;
  end if;
  tail := right(s, 3);
  head := left(s, length(s) - 3);
  res := '';
  while length(head) > 2 loop
    res := ',' || right(head, 2) || res;
    head := left(head, length(head) - 2);
  end loop;
  return '₹' || case when p < 0 then '-' else '' end || head || res || ',' || tail;
end
$function$;

-- 1) Digest bookkeeping: which final-approval events have already been rolled
--    into the PH/Engineer digest. Backfill EVERY existing row as "already
--    digested" so switching this on does not blast a backlog — only approvals
--    from here on are summarised.
alter table public.approval_events
  add column if not exists mgmt_digest_at timestamptz;

update public.approval_events
   set mgmt_digest_at = created_at
 where mgmt_digest_at is null;

-- ============================================================
-- 2) INSTANT — tell the project's Atm Head(s) the moment the Trustee approves
--    or partially releases. Kept as its own small trigger so it stays low-risk
--    and independent of the big approval trigger and the coordinator alert.
--    Recipient = project's 'head' approvers, else (only if none named) all
--    active 'head' users — mirrors who gets the "Atm Head sign-off" alert.
-- ============================================================
create or replace function public.cc_notify_head_on_approval()
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
  -- Internal-budget baseline sheets are not a live approval flow.
  if coalesce(v_ws.summary_notes, '') like '[IB%' then return new; end if;

  select code, name, nullif(built_up_sft, 0) into v_pcode, v_pname, v_sft
    from public.projects where id = v_ws.project_id;
  select name into v_sub from public.cc_sub_skills where id = v_ws.sub_skill_id;

  v_amount := round(coalesce(v_ws.approved_for_erp_amt, v_ws.total_amount, 0));
  v_verb   := case when new.to_stage = 'approved' then 'approved' else 'partially released' end;
  v_url    := '/cost-control/working-sheets/' || v_ws.id::text;
  v_title  := 'Budget ' || v_verb || ' by the Trustee';
  v_body   := coalesce(v_sub, v_ws.ws_code)
              || ' for ' || coalesce(v_pcode, '')
              || case when v_pname is not null then ' · ' || v_pname else '' end
              || ' was ' || v_verb || ' by the Trustee (' || public.fn_inr(v_amount)
              || '). It will be entered in IN4 shortly.';
  v_data := jsonb_build_object(
    'project', coalesce(v_pcode, '') || case when v_pname is not null then ' · ' || v_pname else '' end,
    'work', coalesce(v_sub, v_ws.ws_code),
    'amount', v_amount,
    'per_sft', case when v_sft is not null and v_sft > 0 then round(v_amount / v_sft) else null end,
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
        v_recipient, 'cc_budget_approved', v_title, v_body, v_url,
        'cost-control', new.doc_table, new.doc_id, v_data);
    end if;
  end loop;

  return new;
end
$function$;

drop trigger if exists trg_cc_notify_head_on_approval on public.approval_events;
create trigger trg_cc_notify_head_on_approval
  after insert on public.approval_events
  for each row execute function public.cc_notify_head_on_approval();

-- ============================================================
-- 3) DAILY DIGEST — one mail per Project Head and per raising Engineer listing
--    the budgets the Trustee approved since the last run. Exactly-once via
--    mgmt_digest_at, so wherever the cron places it, nothing is double-sent or
--    lost. p_only_user restricts to one recipient (a "send me a test"); a test
--    never consumes the pending events (it does not stamp mgmt_digest_at).
-- ============================================================
create or replace function public.cc_budget_approved_digest(p_only_user uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  r record;
  n int := 0;
  v_title text; v_body text; v_data jsonb;
begin
  -- The set of not-yet-digested final-approval events (exclude [IB] baselines).
  select array_agg(e.id) into v_ids
  from public.approval_events e
  join public.cc_working_sheets ws on ws.id = e.doc_id
  where e.module_slug = 'cost-control' and e.doc_type = 'cc_working_sheet'
    and e.to_stage in ('approved', 'partially_approved')
    and e.mgmt_digest_at is null
    and coalesce(ws.summary_notes, '') not like '[IB%';

  if v_ids is null then return 0; end if;

  for r in
    with ev as (
      select e.id ev_id, ws.project_id, ws.engineer_id, e.to_stage,
             round(coalesce(ws.approved_for_erp_amt, ws.total_amount, 0)) as amount,
             coalesce(pj.code, '')
               || case when pj.name is not null and pj.name <> pj.code then ' · ' || pj.name else '' end as project_label,
             coalesce(ss.name, ws.ws_code) as work_label
      from public.approval_events e
      join public.cc_working_sheets ws on ws.id = e.doc_id
      left join public.projects pj on pj.id = ws.project_id
      left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
      where e.id = any(v_ids)
    ),
    recips as (
      -- the engineer who raised it
      select ev.*, ev.engineer_id as recipient
        from ev where ev.engineer_id is not null
      union all
      -- the project head(s) of the project (named, else fallback to active PHs)
      select ev.*, ph.user_id as recipient
        from ev
        join lateral (
          select user_id from public.cc_project_approvers
            where project_id = ev.project_id and role = 'project_head'
          union
          select p.id from public.profiles p
            where p.is_active = true and p.role::text = 'project_head'
              and not exists (
                select 1 from public.cc_project_approvers a
                where a.project_id = ev.project_id and a.role = 'project_head'
              )
        ) ph on ph.user_id is not null
    )
    select recipient,
           count(*)::int as cnt,
           sum(amount) as total,
           jsonb_agg(jsonb_build_object(
             'label', project_label || ' · ' || work_label,
             'amount', amount,
             'decision', to_stage
           ) order by amount desc) as items
      from recips
     where (p_only_user is null or recipient = p_only_user)
     group by recipient
  loop
    if not exists (select 1 from public.profiles pr where pr.id = r.recipient and pr.is_active) then
      continue;
    end if;

    v_title := case when r.cnt = 1 then 'A budget was approved by the Trustee'
                    else r.cnt || ' budgets approved by the Trustee' end;
    v_body := r.cnt || ' budget' || case when r.cnt = 1 then '' else 's' end
              || ' approved (' || public.fn_inr(r.total) || ' total).';
    v_data := jsonb_build_object(
      'count', r.cnt,
      'total', round(r.total),
      'items', (select jsonb_agg(e) from (select e from jsonb_array_elements(r.items) e limit 12) s),
      'more', greatest(r.cnt - 12, 0)
    );

    perform public.notify_user(
      r.recipient, 'cc_budget_approved_digest', v_title, v_body,
      '/cost-control', 'cost-control', 'cc_working_sheets', null, v_data);
    n := n + 1;
  end loop;

  -- Stamp the events as digested (real run only — a test must not consume them).
  if p_only_user is null then
    update public.approval_events set mgmt_digest_at = now() where id = any(v_ids);
  end if;

  return n;
end
$function$;
