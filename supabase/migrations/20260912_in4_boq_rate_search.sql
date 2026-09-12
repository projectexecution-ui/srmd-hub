-- Past BOQ rates on /masters/rates, from the mirror.
--
-- Every table this needs was already mirrored — the work-order BOQ items, the
-- work orders with their dates, the contractors, the projects — so the screen
-- was crossing to us-east-1 for data that had been sitting in Mumbai all along.
--
-- The grouping is not case-folded here, unlike the BOQ Master screens: this
-- lists individual order lines rather than counting distinct items, so two
-- spellings are simply two lines, exactly as IN4 listed them.
create or replace function public.in4_boq_rate_search(p_q text, p_limit int default 400)
returns table (
  wo_id int, wo_no text, wo_dt date, contractor text, project text,
  subname text, description text, uom text, qty numeric, rate numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  with needle as (
    select '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as q
  )
  select i.wo_id, w.display_no, w.creation_dt, pa.name, pr.name,
         i.boq_subname, i.description, i.uom, i.quantity, i.rate
    from in4_wo_boq_items i
    left join in4_work_orders w  on w.wo_id = i.wo_id
    left join in4_parties pa     on pa.kind = 'contractor' and pa.id = w.contractor_id
    left join in4_subprojects sp on sp.id = w.subproject_id
    left join in4_projects pr    on pr.id = sp.project_id
    cross join needle n
   where i.rate > 0
     and (coalesce(i.boq_subname, '') ilike n.q
       or coalesce(i.description, '') ilike n.q
       or coalesce(i.boq_name, '')    ilike n.q)
   order by w.creation_dt desc nulls last, i.item_id desc
   limit p_limit
$fn$;

grant execute on function public.in4_boq_rate_search(text, int) to authenticated;
