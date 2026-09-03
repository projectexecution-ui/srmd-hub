-- The reminder was telling the Trustee he had budgets waiting for approval when
-- he had none.
--
-- Chirag opened CT Hub to "You're all caught up" while Telegram and email said
-- 2 vouchers were pending. Both were right about the facts; the notification was
-- wrong about the words. The two SRAH sheets had been sitting at the ATM HEAD
-- stage for 15 days, so the 3-day escalation copied him in to unblock them —
-- correct behaviour, and my_approval_inbox() rightly returns 0 for him because
-- they were never his to approve. But the title was hard-coded to
-- "N budgets waiting for approval", and a title is all you get in a Telegram
-- push or an email subject. He had been sent that same wrong line every
-- morning: 1, 2 and 3 September, on all four channels.
--
-- Now the title, the header, each line and the closing instruction all say whose
-- desk the thing is on:
--   all his        -> "2 budgets waiting for your approval"
--   all escalated  -> "2 budgets stuck with their approver"
--   a mix          -> "2 waiting on you · 3 stuck with others"
-- and an escalated line reads "15d with the Atm Head" instead of a bare
-- "(stuck)", so the reader knows who to chase.
--
-- Verified against live data (both probes rolled back):
--   Chirag (founder, nothing of his own) ->
--     "2 budgets stuck with their approver … 15d with the Atm Head …
--      None of them are yours to approve — open CT Hub if you want to chase them."
--   Amit Gala (Atm Head, 2 of his + 3 escalations) ->
--     "2 waiting on you · 3 stuck with others", each line attributed.

-- The closing instruction has to match too: "approve or return" is an order the
-- reader cannot carry out when every item is on someone else's desk.
create or replace function public.cc_approval_reminders_footer(p_mine int, p_theirs int, p_total numeric)
returns text language sql immutable set search_path = public as $fn$
  select 'Total ' || public.fn_inr(p_total) || '. '
    || case
         when p_mine = 0 then 'None of them are yours to approve — open CT Hub if you want to chase them.'
         when p_theirs = 0 then 'Open CT Hub to approve or return.'
         else 'Open CT Hub to approve or return the ' || p_mine || ' that need you.'
       end;
$fn$;

create or replace function public.cc_approval_reminders(p_only_user uuid default null)
returns integer
language plpgsql security definer set search_path = public as $fn$
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
    aged as ( select * from pend where days >= 1 ),
    direct as (
      select appr.user_id, a.ws_id, a.project_code, a.label, a.amount, a.days,
             a.status, false as escalated
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
    esc as (
      select eu.user_id, a.ws_id, a.project_code, a.label, a.amount, a.days,
             a.status, true as escalated
      from aged a
      -- the role one step above whoever is sitting on it
      cross join lateral (
        select case a.status
                 when 'submitted'   then 'head'
                 when 'ph_approved' then 'founder'
               end as esc_role
      ) er
      cross join lateral (
        select u.id as user_id
        from public.profiles u
        where u.is_active
          and (
            -- an admin still sees everything that is jammed, org-wide
            u.role = 'admin'
            or (
              er.esc_role is not null
              and public.effective_user_role(u.id, 'cost-control')::text = er.esc_role
              -- ...but a head is only copied on HIS OWN projects. Without this
              -- clause every head was mailed about every stuck sheet.
              and ( exists (select 1 from public.cc_project_approvers pa
                             where pa.project_id = a.project_id
                               and pa.role = er.esc_role and pa.user_id = u.id)
                    or not exists (select 1 from public.cc_project_approvers pa2
                                    where pa2.project_id = a.project_id
                                      and pa2.role = er.esc_role) )
            )
          )
      ) eu
      where a.days >= 3
    ),
    allr as ( select * from direct union all select * from esc ),
    dedup as (
      select distinct on (user_id, ws_id)
        user_id, ws_id, project_code, label, amount, days, status, escalated
      from allr
      order by user_id, ws_id, escalated asc
    )
    select
      user_id,
      count(*) as cnt,
      count(*) filter (where not escalated) as mine,
      count(*) filter (where escalated)     as theirs,
      sum(amount) as total,
      string_agg(
        '- ' || project_code || ' — ' || label || ' · ' || public.fn_inr(amount)
        || ' · ' || days || 'd'
        || case when escalated
                then ' with ' || case status
                                   when 'submitted'   then 'the Project Head'
                                   when 'ph_approved' then 'the Atm Head'
                                   else 'the Trustee'
                                 end
                else ' waiting on you'
           end,
        chr(10) order by days desc, amount desc
      ) as lines,
      jsonb_agg(jsonb_build_object(
        'label', label, 'project', project_code, 'amount', amount,
        'days', days, 'escalated', escalated, 'stage', status
      ) order by days desc) as items
    from dedup
    where (p_only_user is null or user_id = p_only_user)
    group by user_id
  loop
    if r.mine = 0 then
      v_title  := r.theirs || ' budget' || case when r.theirs = 1 then '' else 's' end
                  || ' stuck with their approver';
      v_header := 'None of these need your approval — they are stuck 3+ days with '
                  || 'someone else and copied to you to unblock:';
    elsif r.theirs = 0 then
      v_title  := r.mine || ' budget' || case when r.mine = 1 then '' else 's' end
                  || ' waiting for your approval';
      v_header := 'Waiting for your approval — please approve or return each:';
    else
      v_title  := r.mine || ' waiting on you · ' || r.theirs || ' stuck with others';
      v_header := r.mine || ' need your approval. The other ' || r.theirs
                  || ' are stuck with someone else and copied to you to unblock:';
    end if;

    v_body := v_header || chr(10) || chr(10) || r.lines
      || chr(10) || chr(10) || public.cc_approval_reminders_footer(r.mine::int, r.theirs::int, r.total);
    perform public.notify_user(
      r.user_id, 'cc_approval_reminders', v_title, v_body,
      '/cost-control/working-sheets', 'cost-control', 'cc_working_sheets', null,
      jsonb_build_object('count', r.cnt, 'mine', r.mine, 'theirs', r.theirs,
                         'total', r.total, 'items', r.items)
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end
$fn$;
