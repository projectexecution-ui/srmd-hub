-- The last purchase order behind each material — the final live IN4 read in
-- the Masters screens.
--
-- Item Master shows, against every material, the most recent approved PO it
-- appeared on: number, date, supplier, rate and quantity. That was a
-- ROW_NUMBER() query to us-east-1 on every load of the screen.
--
-- This mirrors the ANSWER, not the PO ledger. IN4 holds 1,450 purchase orders
-- and 5,069 lines; the screen wants one row per material and never the rest,
-- so copying the whole ledger would mean carrying 5,069 rows to read 2,446. If
-- a PO ledger is ever wanted for its own sake it should be its own feed with
-- its own shape, not this table widened.
--
-- Supplier and project are held as ids, not names: in4_parties and in4_projects
-- already carry those names and are refreshed by the same sync, so duplicating
-- them here would only create a second copy that can drift. Checked before
-- choosing this: all 155 suppliers and 22 projects the rows point at are
-- present in those two mirrors, so nothing resolves to a blank.
create table if not exists public.in4_last_po_by_material (
  material_id   integer primary key,
  po_id         integer not null,
  po_no         text,
  po_dt         date,
  supplier_id   integer,
  rate          numeric,
  qty           numeric,
  project_id    integer,
  subproject_id integer,
  synced_at     timestamptz not null default now()
);

alter table public.in4_last_po_by_material enable row level security;
drop policy if exists in4_last_po_by_material_read on public.in4_last_po_by_material;
create policy in4_last_po_by_material_read on public.in4_last_po_by_material
  for select to authenticated using ((select auth.uid()) is not null);

-- One row per material with the names already resolved, so the screen makes a
-- single call instead of stitching three lists together. 2,446 rows, which is
-- past PostgREST's 1,000-row default — the caller pages it.
create or replace function public.in4_last_po_per_material()
returns table (
  material_id int, po_id int, po_no text, po_dt date,
  supplier text, rate numeric, qty numeric, project text, subproject_id int)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select l.material_id, l.po_id, l.po_no, l.po_dt,
         sup.name, l.rate, l.qty, pr.name, l.subproject_id
    from in4_last_po_by_material l
    left join in4_parties sup on sup.kind = 'supplier' and sup.id = l.supplier_id
    left join in4_projects pr  on pr.id = l.project_id
   order by l.material_id
$fn$;

grant execute on function public.in4_last_po_per_material() to authenticated;
