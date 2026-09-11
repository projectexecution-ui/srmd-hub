-- BOQ Master, off live IN4 and onto the mirror.
--
-- IN4 is an RDS in us-east-1; this app runs in Mumbai. Every BOQ screen made two
-- round trips across the Atlantic — the aggregate and a second window query for
-- "the last work order this item was on" — measured at roughly half a second
-- each of pure network, with the query itself taking no measurable time. The
-- mirror in4_wo_boq_items holds BI.DIM_ENGG_WORK_ORDER_BOQ row for row (9,896
-- either side), so the same answers are a local query away, and the two queries
-- collapse into one because the last order can be picked in the same pass.
--
-- One deliberate difference. SQL Server's collation is case-insensitive, so
-- "civil work", "Civil work" and "Civil Work" were always ONE item in IN4.
-- Postgres would count them as three. The grouping keys are lower()ed to keep
-- IN4's answer; the label shown is the spelling on the most recent work order,
-- so the screen reads the way the latest WO was typed.

-- Category tiles: how many BOQ names, distinct items and work orders sit under
-- each work category. Mirrors the COUNT(DISTINCT ...) IN4 did, CONCAT included —
-- CONCAT treats NULL as '', hence the coalesce.
create or replace function public.in4_boq_overview()
returns table (cat int, names bigint, items bigint, wos bigint)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.category_id,
         count(distinct lower(i.boq_name)),
         count(distinct lower(coalesce(i.boq_name, '') || '|' ||
                              coalesce(i.boq_subname, '') || '|' ||
                              coalesce(i.description, ''))),
         count(distinct i.wo_id)
    from in4_wo_boq_items i
   group by i.category_id
$fn$;

-- Every BOQ item, with its rate range, how many work orders used it, and the
-- last work order it appeared on. Two callers:
--   p_category_id set               → one category's items, in name order
--   p_q set with p_limit            → a search across categories, newest first
-- The ordering below serves both: with no limit the date key is a constant and
-- name/sub-name/description decide; with a limit the newest come first. The
-- trailing keys are there to make the order total — the category screen is read
-- a page at a time, and ties would shuffle rows between pages.
create or replace function public.in4_boq_items(
  p_category_id int default null,
  p_q text default null,
  p_limit int default null)
returns table (
  cat int, name text, subname text, description text, uom text, subcategory_id int,
  wos bigint, min_rate numeric, max_rate numeric, last_used date,
  last_wo_id int, last_ref text, last_date date, last_party text,
  last_rate numeric, last_qty numeric, last_project text, last_subproject_id int)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  with words as (
    -- Each word must appear, in the same column — IN4 built "LIKE '%a%' AND
    -- LIKE '%b%'" per column. A word's own % _ \ are escaped so a search for
    -- "50%" does not turn into a wildcard.
    select array(
      select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')
        from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) w
       where w <> ''
    ) as w
  ),
  hit as (
    select i.*,
           lower(coalesce(i.boq_name, ''))    as k_name,
           lower(coalesce(i.boq_subname, '')) as k_sub,
           lower(coalesce(i.description, '')) as k_desc,
           lower(coalesce(i.uom, ''))         as k_uom
      from in4_wo_boq_items i, words
     where (p_category_id is null or i.category_id = p_category_id)
       and (cardinality(words.w) = 0
            or (select bool_and(coalesce(i.boq_subname, '') ilike '%' || t || '%') from unnest(words.w) t)
            or (select bool_and(coalesce(i.description, '') ilike '%' || t || '%') from unnest(words.w) t)
            or (select bool_and(coalesce(i.boq_name, '')    ilike '%' || t || '%') from unnest(words.w) t))
  ),
  -- One spelling per name, so case variants land in one group on the screen.
  label as (
    select h.k_name, (array_agg(h.boq_name order by h.item_id desc))[1] as name
      from hit h group by h.k_name
  ),
  agg as (
    select h.category_id, h.k_name, h.k_sub, h.k_desc, h.k_uom, h.subcategory_id,
           (array_agg(h.boq_subname order by h.item_id desc))[1] as subname,
           (array_agg(h.description order by h.item_id desc))[1] as description,
           (array_agg(h.uom         order by h.item_id desc))[1] as uom,
           count(distinct h.wo_id) as wos,
           min(h.rate) as min_rate, max(h.rate) as max_rate,
           max(w.creation_dt) as last_used
      from hit h left join in4_work_orders w on w.wo_id = h.wo_id
     group by h.category_id, h.k_name, h.k_sub, h.k_desc, h.k_uom, h.subcategory_id
  ),
  latest as (
    select distinct on (h.category_id, h.k_name, h.k_sub, h.k_desc, h.k_uom, h.subcategory_id)
           h.category_id, h.k_name, h.k_sub, h.k_desc, h.k_uom, h.subcategory_id,
           h.wo_id, w.display_no, w.creation_dt, h.rate, h.quantity,
           pa.name as contractor, pr.name as project, w.subproject_id
      from hit h
      left join in4_work_orders w  on w.wo_id = h.wo_id
      left join in4_parties pa     on pa.kind = 'contractor' and pa.id = w.contractor_id
      left join in4_subprojects sp on sp.id = w.subproject_id
      left join in4_projects pr    on pr.id = sp.project_id
     order by h.category_id, h.k_name, h.k_sub, h.k_desc, h.k_uom, h.subcategory_id,
              w.creation_dt desc nulls last, h.item_id desc
  )
  select a.category_id, l.name, a.subname, a.description, a.uom, a.subcategory_id,
         a.wos, a.min_rate, a.max_rate, a.last_used,
         t.wo_id, t.display_no, t.creation_dt, t.contractor, t.rate, t.quantity,
         t.project, t.subproject_id
    from agg a
    join label l on l.k_name = a.k_name
    left join latest t
      on t.category_id is not distinct from a.category_id
     and t.k_name = a.k_name and t.k_sub = a.k_sub
     and t.k_desc = a.k_desc and t.k_uom = a.k_uom
     and t.subcategory_id is not distinct from a.subcategory_id
   order by case when p_limit is null then null else a.last_used end desc nulls last,
            l.name, a.subname, a.description, a.k_uom, a.subcategory_id
   limit p_limit
$fn$;

grant execute on function public.in4_boq_overview() to authenticated;
grant execute on function public.in4_boq_items(int, text, int) to authenticated;
