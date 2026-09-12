-- Two fields the contact card needs and the work-order mirror lacked: the
-- retention held against the order, and IN4's readable name for its status
-- ("Approved", "Terminated") rather than the bare number the mirror kept.
alter table public.in4_work_orders
  add column if not exists wo_retention_amt numeric,
  add column if not exists status_name      text;

-- IN4's own COMMON_STATUS_LOOKUP names for the eight statuses work orders
-- actually carry, so the column reads correctly from the moment it exists
-- rather than after the next sync. The extractor keeps it current from then on.
update public.in4_work_orders set status_name = v.name
from (values (2, 'Approved'), (66, 'Terminated'), (6, 'Cancelled'), (13, 'Draft'),
             (1, 'Submitted'), (60, 'ReSubmit'), (9, 'Verified'), (113, 'Verify')) as v(id, name)
where in4_work_orders.status = v.id and in4_work_orders.status_name is null;

-- A contractor's work orders, for their contact card.
create or replace function public.in4_party_wo_orders(p_contractor_id int)
returns table (
  wo_id int, wo_no text, wo_dt date, project text, category text,
  status text, gross numeric, paid numeric, retention numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select w.wo_id, w.display_no, w.creation_dt, pr.name, k.name,
         w.status_name, w.wo_gross_value, w.wo_paid_amt, w.wo_retention_amt
    from in4_work_orders w
    left join in4_subprojects sp on sp.id = w.subproject_id
    left join in4_projects pr    on pr.id = sp.project_id
    left join in4_skills k       on k.id = w.category_id
   where w.contractor_id = p_contractor_id
   order by w.creation_dt desc nulls last, w.wo_id desc
$fn$;

grant execute on function public.in4_party_wo_orders(int) to authenticated;
