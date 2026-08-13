-- Daily "budget waiting for your approval" reminder (Cost Control).
--
-- Every morning, remind the CURRENT approver of each cost-control working sheet
-- still pending their sign-off, but only once it has aged past the day it
-- entered that stage ("not approved same day -> next-day reminder"). If a sheet
-- is stuck 3+ days it is ALSO copied to the next level up + management, so it
-- can't rot. Read-only over the approval model — this never changes approval
-- logic; it resolves the current-stage approver exactly the way the live
-- notify_on_approval_event trigger + projectApproverAllows do:
--   role  = active approval_rules whose from_stage = the sheet's status
--   who   = named cc_project_approvers for that role, else role-wide fallback
-- Excludes [IB] baselines, archived and cancelled sheets. Delivered via
-- notify_user (bell + email + Telegram card) — type 'cc_approval_reminders'.

create or replace function public.cc_approval_reminders(p_only_user uuid default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_sent int := 0;
  v_title text; v_body text; v_header text;
begin
  for r in
    with pend as (
      select
        ws.id as ws_id, ws.project_id, ws.status::text as status,
        pr.code as project_code,
        coalesce(ss.name, d.name, 'Budget') as label,
        coalesce(ws.total_amount, ws.summary_total, 0)::numeric as amount,
        ( (now() at time zone 'Asia/Kolkata')::date
          - (coalesce(
               (select max(e.created_at) from public.approval_events e
                  where e.doc_table = 'cc_working_sheets' and e.doc_id = ws.id
                    and e.to_stage = ws.status::text),
               ws.submitted_at, ws.created_at
             ) at time zone 'Asia/Kolkata')::date
        ) as days
      from public.cc_working_sheets ws
      join public.projects pr on pr.id = ws.project_id
      left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
      left join public.cc_disciplines d on d.id = ws.discipline_id
      where ws.archived_at is null
        and coalesce(ws.summary_notes, '') not like '[IB%'
        and ws.status::text in ('submitted', 'ph_approved', 'atm_approved', 'partially_approved')
    ),
    aged as ( select * from pend where days >= 1 ),         -- entered its stage before today
    direct as (                                             -- the current-stage approver(s)
      select appr.user_id, a.ws_id, a.project_code, a.label, a.amount, a.days, false as escalated
      from aged a
      cross join lateral (
        select u.id as user_id
        from public.profiles u
        join public.approval_rules ar
          on ar.is_active and ar.module_slug = 'cost-control' and ar.doc_type = 'cc_working_sheet'
             and ar.from_stage = a.status and ar.to_stage <> 'returned'
        where u.is_active
          and public.effective_user_role(u.id, 'cost-control')::text
                in (ar.approver_role, coalesce(ar.override_role, ''))
          and ( exists (select 1 from public.cc_project_approvers pa
                         where pa.project_id = a.project_id and pa.role = ar.approver_role and pa.user_id = u.id)
                or not exists (select 1 from public.cc_project_approvers pa2
                                where pa2.project_id = a.project_id and pa2.role = ar.approver_role) )
      ) appr
    ),
    esc as (                                                -- stuck 3+ days -> next level + management
      select eu.user_id, a.ws_id, a.project_code, a.label, a.amount, a.days, true as escalated
      from aged a
      cross join lateral (
        select u.id as user_id
        from public.profiles u
        where u.is_active
          and ( u.role = 'admin'
                or public.effective_user_role(u.id, 'cost-control')::text =
                     case a.status when 'submitted' then 'head' when 'ph_approved' then 'founder' else null end )
      ) eu
      where a.days >= 3
    ),
    allr as ( select * from direct union all select * from esc ),
    dedup as (                                              -- one line per (user, sheet); direct beats escalated
      select distinct on (user_id, ws_id)
        user_id, ws_id, project_code, label, amount, days, escalated
      from allr
      order by user_id, ws_id, escalated asc
    )
    select
      user_id,
      count(*) as cnt,
      sum(amount) as total,
      bool_and(escalated) as all_esc,
      string_agg(
        '- ' || project_code || ' — ' || label || ' · ' || public.fn_inr(amount)
        || ' · waiting ' || days || 'd' || case when days >= 3 then ' (stuck)' else '' end,
        chr(10) order by days desc, amount desc
      ) as lines,
      jsonb_agg(jsonb_build_object(
        'label', label, 'project', project_code, 'amount', amount, 'days', days, 'escalated', escalated
      ) order by days desc) as items
    from dedup
    where (p_only_user is null or user_id = p_only_user)
    group by user_id
  loop
    v_header := case when r.all_esc
      then 'Stuck 3+ days with their approver — copied to you to unblock:'
      else 'Waiting for your approval — please approve or return each:' end;
    v_title := r.cnt || ' budget' || case when r.cnt = 1 then '' else 's' end || ' waiting for approval';
    v_body := v_header || chr(10) || chr(10) || r.lines
      || chr(10) || chr(10) || 'Total ' || public.fn_inr(r.total) || '. Open CT Hub to approve or return.';
    perform public.notify_user(
      r.user_id, 'cc_approval_reminders', v_title, v_body,
      '/cost-control/working-sheets', 'cost-control', 'cc_working_sheets', null,
      jsonb_build_object('count', r.cnt, 'total', r.total, 'items', r.items)
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end
$function$;

-- Send-triggering RPC: service-role only (the cron uses the service client; the
-- admin test route checks admin then also calls via the service client). Keep
-- it off the public API so no signed-in user can fire a mass reminder.
revoke all on function public.cc_approval_reminders(uuid) from public, anon, authenticated;
grant  execute on function public.cc_approval_reminders(uuid) to service_role;
