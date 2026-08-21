-- my_approval_inbox: scope Cost Control sheets to the ACTUAL approver, not just
-- the role.
--
-- Bug: the cost-control branch only checked `my_rules` (an active approval rule
-- for the caller's role at the sheet's stage). It never consulted
-- cc_project_approvers, so EVERY head saw EVERY ph_approved sheet in EVERY
-- project — e.g. Atm Akshay saw SRAH sheets whose named head is Amit Gala.
-- The cost-control/approvals PAGE already scopes correctly via isWaitingOnMe
-- (lib/cost-control/my-approvals.ts); this makes the dashboard "Needs you now"
-- card + the generic /approvals inbox + the bell count agree with it.
--
-- Rule (mirrors isWaitingOnMe): a CC sheet at stage S (covering role R:
-- submitted→project_head, ph_approved→head, atm_approved/partially_approved→
-- founder) is in my inbox when I am an admin, OR I am the NAMED approver for
-- (project, R), OR I head the sheet's discipline, OR nobody is named for
-- (project, R) and my role covers the stage (the my_rules gate already ensures
-- that last part). Only narrows the inbox — never grants new visibility.

create or replace function public.my_approval_inbox()
 returns table(module_slug text, doc_type text, doc_table text, doc_id uuid, doc_no text, doc_url text, from_stage text, next_stage text, project_id uuid, project_code text, project_name text, doc_date date, created_at timestamp with time zone, amount numeric, urgency text, work_label text, raised_by text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select role::text as default_role from public.profiles where id = auth.uid()
  ),
  my_rules as (
    select ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage
    from public.approval_rules ar
    where ar.is_active
      and not ar.is_blocking
      and (
        (select default_role from me) = 'admin'
        or public.effective_user_role(auth.uid(), ar.module_slug)::text
             in (ar.approver_role, coalesce(ar.override_role, ''))
      )
  ),
  disabled as (
    select slug from public.module_visibility where not enabled
  ),
  inbox (module_slug, doc_type, doc_table, doc_id, doc_no, doc_url, from_stage, next_stage,
         project_id, project_code, project_name, doc_date, created_at, amount, urgency,
         work_label, raised_by) as (
    select
      'inventory'::text, 'inv_request'::text, 'inv_requests'::text,
      r.id, coalesce(r.request_no, '#' || substring(r.id::text, 1, 8)),
      '/inventory/requests/' || r.id::text, r.status::text,
      (select to_stage from my_rules m where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text limit 1),
      r.project_id, p.code, p.name, r.required_by_date, r.created_at, null::numeric, r.urgency::text,
      null::text, null::text
    from public.inv_requests r
    left join public.projects p on p.id = r.project_id
    where exists (select 1 from my_rules m where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text)

    union all
    select
      'indents','indent','indents',
      i.id, coalesce(i.indent_no, '#' || substring(i.id::text, 1, 8)),
      '/indents/' || i.id::text, i.stage::text,
      (select to_stage from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text limit 1),
      i.project_id, p.code, p.name, i.indent_date, i.created_at, null::numeric, null::text,
      i.sub_project, null::text
    from public.indents i
    left join public.projects p on p.id = i.project_id
    where exists (select 1 from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text)

    union all
    select
      'jmr','jmr_entry','jmr_daily_entries',
      e.id, '#' || substring(e.id::text, 1, 8),
      '/jmr/entries/' || e.id::text, e.status::text,
      (select to_stage from my_rules m where m.module_slug='jmr' and m.doc_type='jmr_entry' and m.from_stage = e.status::text limit 1),
      e.project_id, p.code, p.name, e.entry_date, e.created_at, e.amount, null::text,
      null::text, null::text
    from public.jmr_daily_entries e
    left join public.projects p on p.id = e.project_id
    where exists (select 1 from my_rules m where m.module_slug='jmr' and m.doc_type='jmr_entry' and m.from_stage = e.status::text)

    union all
    select
      'cost-control','cc_working_sheet','cc_working_sheets',
      ws.id, coalesce(ws.ws_code, '#' || substring(ws.id::text, 1, 8)),
      '/cost-control/working-sheets/' || ws.id::text, ws.status::text,
      (select to_stage from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text limit 1),
      ws.project_id, p.code, p.name,
      coalesce(ws.submitted_at::date, ws.created_at::date), ws.created_at,
      coalesce(ws.total_amount, ws.summary_total), null::text,
      coalesce(ss.name, dis.name), coalesce(eng.full_name, eng.name)
    from public.cc_working_sheets ws
    left join public.projects p on p.id = ws.project_id
    left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
    left join public.cc_disciplines dis on dis.id = ws.discipline_id
    left join public.profiles eng on eng.id = ws.engineer_id
    where ws.status::text <> 'draft'
      and ws.archived_at is null
      and exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)
      -- Named-approver scoping (mirrors isWaitingOnMe): only the covering
      -- approver for THIS project+stage — not every user with the role.
      and (
        (select default_role from me) = 'admin'
        or exists (
          select 1 from public.cc_project_approvers cpa
          where cpa.project_id = ws.project_id
            and cpa.user_id = auth.uid()
            and cpa.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
        or exists (
          select 1 from public.cc_discipline_approvers da
          where da.discipline_id = ws.discipline_id
            and da.approver_user_id = auth.uid()
            and da.is_active
        )
        or not exists (
          select 1 from public.cc_project_approvers cpa2
          where cpa2.project_id = ws.project_id
            and cpa2.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
      )
  )
  select inbox.module_slug, inbox.doc_type, inbox.doc_table, inbox.doc_id, inbox.doc_no, inbox.doc_url,
         inbox.from_stage, inbox.next_stage, inbox.project_id, inbox.project_code, inbox.project_name,
         inbox.doc_date, inbox.created_at, inbox.amount, inbox.urgency, inbox.work_label, inbox.raised_by
  from inbox
  where inbox.module_slug not in (select slug from disabled)
  order by inbox.doc_date desc nulls last, inbox.created_at desc
$function$;
