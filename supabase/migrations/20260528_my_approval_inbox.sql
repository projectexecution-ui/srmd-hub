-- ============================================================
-- my_approval_inbox(): personal "waiting on me" feed across every
-- module. Returns only docs whose CURRENT stage has an active
-- approval_rule outbound transition the user's effective role can act
-- on. Admin sees everything, ordinary roles only see actionable items.
--
-- Ordered by doc_date desc (created_at as tiebreaker).
-- ============================================================

create or replace function public.my_approval_inbox()
returns table (
  module_slug   text,
  doc_type      text,
  doc_table     text,
  doc_id        uuid,
  doc_no        text,
  doc_url       text,
  from_stage    text,
  next_stage    text,
  project_id    uuid,
  project_code  text,
  project_name  text,
  doc_date      date,
  created_at    timestamptz,
  amount        numeric,
  urgency       text
)
language sql stable security definer
set search_path = public
as $$
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
  )

  -- Inventory requests
  select
    'inventory'::text, 'inv_request'::text, 'inv_requests'::text,
    r.id,
    coalesce(r.request_no, '#' || substring(r.id::text, 1, 8)),
    '/inventory/requests/' || r.id::text,
    r.status::text,
    (select to_stage from my_rules m
      where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text
      limit 1),
    r.project_id, p.code, p.name,
    r.required_by_date,
    r.created_at,
    null::numeric,
    r.urgency::text
  from public.inv_requests r
  left join public.projects p on p.id = r.project_id
  where exists (
    select 1 from my_rules m
    where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text
  )

  union all

  -- Indents
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

  -- JMR bills
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

  -- JMR daily entries
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

  -- Cost control working sheets
  select
    'cost-control','cc_working_sheet','cc_working_sheets',
    ws.id, '#' || substring(ws.id::text, 1, 8),
    '/cost-control/working-sheets/' || ws.id::text, ws.status::text,
    (select to_stage from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text limit 1),
    ws.project_id, p.code, p.name,
    coalesce(ws.submitted_at::date, ws.created_at::date),
    ws.created_at,
    coalesce(ws.total_amount, ws.summary_total),
    null::text
  from public.cc_working_sheets ws
  left join public.projects p on p.id = ws.project_id
  where exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)

  order by 11 desc nulls last, 12 desc
$$;
