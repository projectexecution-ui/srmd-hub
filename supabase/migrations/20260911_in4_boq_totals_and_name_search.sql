-- The last two BOQ reads that still crossed the ocean.
--
-- The Masters home page counts BOQ names and items, and the search across all
-- six masters looks up BOQ names — both were still asking IN4 directly after
-- the BOQ screens themselves moved to the mirror. Same data, same normalisation
-- (lower() to match SQL Server's case-insensitive collation; the extractor
-- already collapsed runs of whitespace on the way in).
--
-- These are deliberately NOT the per-category sums the BOQ screen shows. A BOQ
-- name can appear under more than one work category, so summing the category
-- tiles gives 1,415 names where the whole-table count gives 1,374. IN4's own
-- two queries differed the same way; the counts are kept apart rather than
-- quietly reconciled.
create or replace function public.in4_boq_totals()
returns table (names bigint, items bigint)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select count(distinct lower(i.boq_name)),
         count(distinct lower(coalesce(i.boq_name, '') || '|' ||
                              coalesce(i.boq_subname, '') || '|' ||
                              coalesce(i.description, '')))
    from in4_wo_boq_items i
$fn$;

-- BOQ names containing the text, most-used first, for the all-masters search.
-- The word's own % _ \ are escaped so a search for "50%" stays a search.
create or replace function public.in4_boq_name_search(p_q text, p_limit int default 16)
returns table (boq_name text, cat int, n bigint)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select (array_agg(i.boq_name order by i.item_id desc))[1],
         i.category_id,
         count(distinct i.wo_id)
    from in4_wo_boq_items i
   where coalesce(i.boq_name, '') ilike
         '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   group by lower(coalesce(i.boq_name, '')), i.category_id
   order by count(distinct i.wo_id) desc, 1
   limit p_limit
$fn$;

grant execute on function public.in4_boq_totals() to authenticated;
grant execute on function public.in4_boq_name_search(text, int) to authenticated;
