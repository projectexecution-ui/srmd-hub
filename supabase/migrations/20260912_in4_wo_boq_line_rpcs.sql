-- The work-order side of the line-rates panel. Both read the WO BOQ mirror,
-- which has been in place since BOQ Master moved across.

/** The BOQ lines of one work order. */
create or replace function public.in4_wo_boq_lines(p_wo_id int)
returns table (project_id int, item_id int, subname text, uom text, rate numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select sp.project_id, i.item_id, i.boq_subname, i.uom, i.rate
    from in4_wo_boq_items i
    left join in4_work_orders w  on w.wo_id = i.wo_id
    left join in4_subprojects sp on sp.id = w.subproject_id
   where i.wo_id = p_wo_id
   order by i.item_id
$fn$;

/** Lines on OTHER approved work orders whose sub-name contains any of these
 *  names — what the same work has been priced at before. Status 2 is IN4's
 *  "Approved", the same filter the live query used. */
create or replace function public.in4_wo_boq_reference_lines(p_names text[], p_exclude_wo int)
returns table (
  subname text, uom text, wo_id int, wo_no text, wo_dt date,
  party text, project_id int, project text, qty numeric, rate numeric, amt numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.boq_subname, i.uom, i.wo_id, w.display_no, w.creation_dt,
         pa.name, sp.project_id, pr.name, i.quantity, i.rate, i.amt
    from in4_wo_boq_items i
    join in4_work_orders w       on w.wo_id = i.wo_id and w.status = 2
    left join in4_parties pa     on pa.kind = 'contractor' and pa.id = w.contractor_id
    left join in4_subprojects sp on sp.id = w.subproject_id
    left join in4_projects pr    on pr.id = sp.project_id
   where i.rate > 0
     and i.wo_id <> p_exclude_wo
     and exists (select 1 from unnest(p_names) t where coalesce(i.boq_subname, '') ilike in4_like(t))
   order by w.creation_dt desc nulls last, i.item_id desc
$fn$;

grant execute on function public.in4_wo_boq_lines(int) to authenticated;
grant execute on function public.in4_wo_boq_reference_lines(text[], int) to authenticated;
