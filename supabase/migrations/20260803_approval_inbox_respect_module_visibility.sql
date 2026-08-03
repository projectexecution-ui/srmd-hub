-- The My Approvals / "Needs you now" inbox (my_approval_inbox) listed items from
-- every module regardless of the module on/off switch, so a switched-off module
-- (e.g. JMR) still cluttered the inbox. Wrap the existing union and drop any item
-- whose module is disabled in module_visibility. JMR-bills is governed by the
-- 'jmr' switch. Only the recipient-selection is affected; the item queries are
-- unchanged.
create or replace function public.my_approval_inbox()
 returns table(module_slug text, doc_type text, doc_table text, doc_id uuid, doc_no text, doc_url text, from_stage text, next_stage text, project_id uuid, project_code text, project_name text, doc_date date, created_at timestamp with time zone, amount numeric, urgency text)
 language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select role::text as default_role from public.profiles where id = auth.uid()
  ),
  my_rules as (
    select ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage
    from public.approval_rules ar
    where ar.is_active
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
         project_id, project_code, project_name, doc_date, created_at, amount, urgency) as (
    select
      'inventory'::text, 'inv_request'::text, 'inv_requests'::text,
      r.id,
      coalesce(r.request_no, '#' || substring(r.id::text, 1, 8)),
      '/inventory/requests/' || r.id::text,
      r.status::text,
      (select to_stage from my_rules m
        where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text limit 1),
      r.project_id, p.code, p.name,
      r.required_by_date, r.created_at, null::numeric, r.urgency::text
    from public.inv_requests r
    left join public.projects p on p.id = r.project_id
    where exists (select 1 from my_rules m where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text)

    union all
    select
      'indents','indent','indents',
      i.id, coalesce(i.indent_no, '#' || substring(i.id::text, 1, 8)),
      '/indents/' || i.id::text, i.stage::text,
      (select to_stage from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text limit 1),
      i.project_id, p.code, p.name, i.indent_date, i.created_at, null::numeric, null::text
    from public.indents i
    left join public.projects p on p.id = i.project_id
    where exists (select 1 from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text)

    union all
    select
      'jmr-bills','jmr_bill','jmr_bills',
      b.id, coalesce(b.bill_number, '#' || substring(b.id::text, 1, 8)),
      '/jmr/bills/' || b.id::text, b.status::text,
      (select to_stage from my_rules m where m.module_slug='jmr-bills' and m.doc_type='jmr_bill' and m.from_stage = b.status::text limit 1),
      b.project_id, p.code, p.name, b.bill_date, b.created_at, b.total_amount, null::text
    from public.jmr_bills b
    left join public.projects p on p.id = b.project_id
    where exists (select 1 from my_rules m where m.module_slug='jmr-bills' and m.doc_type='jmr_bill' and m.from_stage = b.status::text)

    union all
    select
      'jmr','jmr_entry','jmr_daily_entries',
      e.id, '#' || substring(e.id::text, 1, 8),
      '/jmr/entries/' || e.id::text, e.status::text,
      (select to_stage from my_rules m where m.module_slug='jmr' and m.doc_type='jmr_entry' and m.from_stage = e.status::text limit 1),
      e.project_id, p.code, p.name, e.entry_date, e.created_at, e.amount, null::text
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
      coalesce(ws.submitted_at::date, ws.created_at::date),
      ws.created_at,
      coalesce(ws.total_amount, ws.summary_total),
      null::text
    from public.cc_working_sheets ws
    left join public.projects p on p.id = ws.project_id
    where ws.status::text <> 'draft'
      and exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)
  )
  select inbox.module_slug, inbox.doc_type, inbox.doc_table, inbox.doc_id, inbox.doc_no, inbox.doc_url,
         inbox.from_stage, inbox.next_stage, inbox.project_id, inbox.project_code, inbox.project_name,
         inbox.doc_date, inbox.created_at, inbox.amount, inbox.urgency
  from inbox
  where case when inbox.module_slug = 'jmr-bills' then 'jmr' else inbox.module_slug end
        not in (select slug from disabled)
  order by inbox.doc_date desc nulls last, inbox.created_at desc
$function$;
