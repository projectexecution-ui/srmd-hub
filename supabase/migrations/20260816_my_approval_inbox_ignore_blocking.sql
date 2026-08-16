-- my_approval_inbox() must ignore guard-rail rules.
--
-- Only the `my_rules` CTE changes: `and not ar.is_blocking`. That one clause
-- drops `returned` sheets (all four of whose rules are guard rails) while
-- leaving `submitted` in the Project Head's inbox, because submitted still has
-- a genuine submitted -> ph_approved rule.
--
-- Also adds `ws.archived_at is null` to the cost-control branch — an archived
-- sheet is dead and was never excluded here.
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
      -- a guard rail is not a to-do: it exists to refuse a transition
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
      -- an archived sheet is dead; it was never excluded here
      and ws.archived_at is null
      and exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)
  )
  select inbox.module_slug, inbox.doc_type, inbox.doc_table, inbox.doc_id, inbox.doc_no, inbox.doc_url,
         inbox.from_stage, inbox.next_stage, inbox.project_id, inbox.project_code, inbox.project_name,
         inbox.doc_date, inbox.created_at, inbox.amount, inbox.urgency, inbox.work_label, inbox.raised_by
  from inbox
  where inbox.module_slug not in (select slug from disabled)
  order by inbox.doc_date desc nulls last, inbox.created_at desc
$function$;
