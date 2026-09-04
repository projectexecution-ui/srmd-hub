-- Supabase's performance advisor lists 214 foreign keys without a covering
-- index. Most sit on tables with a few dozen rows, where an index changes
-- nothing. These are the tables with 300+ live rows on 5 Sept 2026 (from
-- pg_stat_user_tables) — the ones where a join, a filter on the FK column or a
-- cascade otherwise scans the table. Idempotent; each index is named
-- <table>_<columns>_idx. Rollback: drop index if exists <name> for each.
do $$
declare
  r record;
  idx text;
begin
  for r in
    select t.relname tbl, c.conname, c.conkey,
           (select array_agg(a.attname order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and t.relname in (
        'wh_po_lines','wh_items','cc_project_sub_skills','notification_deliveries','cc_excel_rows','wh_po','notifications',
        'cc_working_sheets','cc_budget_events','est_subcategories','inv_items','inv_stock_movements','wh_movements','wh_stock',
        'inv_stock','approval_events','cc_project_disciplines','est_rates','cc_budget_lines',
        'in4_indent_items','in4_wo_certificates','in4_supplier_certificates','in4_materials','in4_parties')
      -- no existing index whose leading column is the FK's first column
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    idx := left(r.tbl || '_' || array_to_string(r.cols, '_') || '_idx', 63);
    execute format('create index if not exists %I on public.%I (%s)', idx, r.tbl,
      (select string_agg(quote_ident(x), ', ') from unnest(r.cols) x));
    raise notice 'fk index: %', idx;
  end loop;
end $$;
