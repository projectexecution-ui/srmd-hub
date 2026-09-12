-- The reads the purchase screens make, against the mirror instead of IN4.
--
-- Each one keeps the shape of the query it replaces, so the screens above them
-- are unchanged apart from where the rows come from. Two differences are
-- deliberate and are marked where they occur.

-- A LIKE pattern with the searcher's own % _ \ escaped, so a search for "50%"
-- stays a search for "50%".
create or replace function public.in4_like(p_q text)
returns text language sql immutable as $fn$
  select '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'
$fn$;

-- ── /masters/rates — what a material has cost ────────────────────────────────

create or replace function public.in4_material_rate_search(p_q text, p_limit int default 1500)
returns table (
  material_id int, material text, uom text, po_id int, po_no text, po_dt date,
  supplier_id int, supplier text, project text, qty numeric, rate numeric, value numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.material_id, m.name, m.uom, i.po_id, o.po_no, o.po_dt,
         i.supplier_id, sup.name, pr.name, i.base_po_qty, i.net_rate, i.material_value
    from in4_po_items i
    join in4_materials m          on m.id = i.material_id
    join in4_purchase_orders o    on o.po_id = i.po_id
    left join in4_parties sup     on sup.kind = 'supplier' and sup.id = i.supplier_id
    left join in4_projects pr     on pr.id = i.project_id
   where i.net_rate > 0
     and (m.name ilike in4_like(p_q) or coalesce(m.code, '') ilike in4_like(p_q))
   order by m.name, o.po_dt desc nulls last, i.item_id
   limit p_limit
$fn$;

create or replace function public.in4_material_rate_overview(p_limit int default 300)
returns table (
  material_id int, material text, uom text, lines bigint, suppliers bigint,
  min_rate numeric, max_rate numeric, spend numeric, last_dt date)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.material_id, m.name, m.uom, count(*), count(distinct i.supplier_id),
         min(i.net_rate), max(i.net_rate), sum(i.material_value), max(o.po_dt)
    from in4_po_items i
    join in4_materials m       on m.id = i.material_id
    join in4_purchase_orders o on o.po_id = i.po_id
   where i.net_rate > 0
   group by i.material_id, m.name, m.uom
   order by sum(i.material_value) desc
   limit p_limit
$fn$;

-- ── The line-rates panel and the approver's price hints ──────────────────────

/** The lines of one purchase order, by id or by its number. */
create or replace function public.in4_po_lines(p_po_id int default null, p_ref text default null)
returns table (project_id int, item_id int, material_id int, material text, uom text, rate numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.project_id, i.item_id, i.material_id, m.name, m.uom, i.net_rate
    from in4_po_items i
    join in4_purchase_orders o on o.po_id = i.po_id
    left join in4_materials m  on m.id = i.material_id
   where (p_po_id is not null and i.po_id = p_po_id)
      or (p_po_id is null and p_ref is not null and o.po_no = p_ref)
   order by i.item_id
$fn$;

/** Every prior order line for these materials. p_approved_only mirrors the one
 *  place the two callers differ: the line-rates panel counts only approved
 *  orders (STATUS_ID = 2), the approver's price hints count all of them. */
create or replace function public.in4_material_po_history(
  p_material_ids int[], p_exclude_po int default null, p_approved_only boolean default true)
returns table (
  material_id int, po_id int, po_no text, po_dt date, supplier text,
  project text, project_id int, qty numeric, rate numeric, value numeric, grn_qty numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select i.material_id, i.po_id, o.po_no, o.po_dt, sup.name,
         pr.name, i.project_id, i.base_po_qty, i.net_rate, i.material_value, i.grn_qty
    from in4_po_items i
    join in4_purchase_orders o on o.po_id = i.po_id
    left join in4_parties sup  on sup.kind = 'supplier' and sup.id = i.supplier_id
    left join in4_projects pr  on pr.id = i.project_id
   where i.material_id = any(p_material_ids)
     and i.net_rate > 0
     and (not p_approved_only or o.status_id = 2)
     and (p_exclude_po is null or i.po_id <> p_exclude_po)
   order by o.po_dt desc nulls last, i.po_id desc
$fn$;

/** Materials whose name contains any of these words — the "did you mean" pool
 *  for an item nobody has bought before. */
create or replace function public.in4_material_name_search(
  p_tokens text[], p_exclude_ids int[] default '{}', p_limit int default 80)
returns table (id int, name text, uom text)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select m.id, m.name, m.uom
    from in4_materials m
   where exists (select 1 from unnest(p_tokens) t where m.name ilike in4_like(t))
     and not (m.id = any(coalesce(p_exclude_ids, '{}')))
   order by m.name
   limit p_limit
$fn$;

/** The most recent approved rate for each of these materials. */
create or replace function public.in4_material_last_rate(p_material_ids int[])
returns table (material_id int, rate numeric, po_dt date, supplier text)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select distinct on (i.material_id) i.material_id, i.net_rate, o.po_dt, sup.name
    from in4_po_items i
    join in4_purchase_orders o on o.po_id = i.po_id and o.status_id = 2
    left join in4_parties sup  on sup.kind = 'supplier' and sup.id = i.supplier_id
   where i.material_id = any(p_material_ids) and i.net_rate > 0
   order by i.material_id, o.po_dt desc nulls last, i.po_id desc
$fn$;

-- ── A contact's card ─────────────────────────────────────────────────────────

create or replace function public.in4_party_po_orders(p_supplier_id int)
returns table (
  po_id int, po_no text, po_dt date, project text, category text,
  status text, grn_status text, gross numeric, paid numeric, first_grn date)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select o.po_id, o.po_no, o.po_dt, pr.name, o.po_category,
         o.status, o.grn_status, o.po_value, o.paid_amt,
         (select min(g.grn_dt) from in4_grn_items g where g.po_id = o.po_id)
    from in4_purchase_orders o
    left join in4_projects pr on pr.id = o.project_id
   where o.supplier_id = p_supplier_id
   order by o.po_dt desc nulls last, o.po_id desc
$fn$;

/** Where this supplier's average rate sits against the cheapest anyone has
 *  charged, for materials more than one supplier has quoted. */
create or replace function public.in4_party_price_gaps(p_supplier_id int, p_limit int default 25)
returns table (material text, my_rate numeric, min_rate numeric, suppliers bigint)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  with mine as (
    select i.material_id, sum(i.net_rate * i.base_po_qty) / nullif(sum(i.base_po_qty), 0) as my_rate
      from in4_po_items i
     where i.supplier_id = p_supplier_id and i.net_rate > 0
     group by i.material_id
  ),
  market as (
    select i.material_id, min(i.net_rate) as min_rate, count(distinct i.supplier_id) as suppliers
      from in4_po_items i
     where i.net_rate > 0
     group by i.material_id
  )
  select m.name, mine.my_rate, market.min_rate, market.suppliers
    from mine
    join market on market.material_id = mine.material_id
    join in4_materials m on m.id = mine.material_id
   where market.suppliers > 1 and mine.my_rate > 0
   order by mine.my_rate / nullif(market.min_rate, 0) desc nulls last
   limit p_limit
$fn$;

-- ── The purchase-order ledger ────────────────────────────────────────────────

create or replace function public.in4_po_ledger_header(p_po_id int)
returns table (po_id int, po_no text, po_value numeric, paid_amt numeric, supplier text)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select o.po_id, o.po_no, o.po_value, o.paid_amt, sup.name
    from in4_purchase_orders o
    left join in4_parties sup on sup.kind = 'supplier' and sup.id = o.supplier_id
   where o.po_id = p_po_id
$fn$;

/** What was received against this order. A line of nothing — no quantity and no
 *  value — is IN4's placeholder rather than a receipt, and is left out. */
create or replace function public.in4_po_ledger_grns(p_po_id int)
returns table (
  grn_id int, grn_no text, grn_dt date, challan text,
  material text, uom text, qty numeric, value numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select g.grn_id, g.grn_no, g.grn_dt, g.delivery_challan_no,
         m.name, u.name, g.received_qty, g.grn_material_cost
    from in4_grn_items g
    left join in4_materials m on m.id = g.material_id
    left join in4_uoms u      on u.id = g.uom_id
   where g.po_id = p_po_id
     and (coalesce(g.received_qty, 0) <> 0 or coalesce(g.grn_material_cost, 0) <> 0)
   order by g.grn_dt, g.grn_id, g.auto_id
$fn$;

/** The bills raised against this order's receipts. Joined on the GRN, not the
 *  order: a bill can cover receipts booked against a DIFFERENT purchase order,
 *  and the ledger names that order — which is what bill_po_no is for. */
create or replace function public.in4_po_ledger_bills(p_po_id int)
returns table (
  certificate_id int, bill_po_id int, bill_po_no text,
  cert_no int, cert_dt date, invoice_no text, invoice_dt date, status_name text,
  landed numeric, certified numeric, paid numeric, tds numeric, retention numeric, adv_recovery numeric)
language sql stable set search_path to 'public', 'pg_temp' as $fn$
  select p.certificate_id, p.po_id, hh.po_no,
         max(p.certificate_no), max(p.certificate_dt),
         max(p.invoice_no), max(p.invoice_dt), max(p.status_name),
         sum(p.landed_cost), sum(p.certified_amt), sum(p.paid_amt),
         sum(p.tax_deduction_amt), sum(p.retention_amt), sum(p.adv_recovery_amt)
    from in4_supplier_pay_lines p
    left join in4_purchase_orders hh on hh.po_id = p.po_id
   where p.grn_id in (select distinct g.grn_id from in4_grn_items g where g.po_id = p_po_id)
   group by p.certificate_id, p.po_id, hh.po_no
$fn$;

grant execute on function public.in4_like(text) to authenticated;
grant execute on function public.in4_material_rate_search(text, int) to authenticated;
grant execute on function public.in4_material_rate_overview(int) to authenticated;
grant execute on function public.in4_po_lines(int, text) to authenticated;
grant execute on function public.in4_material_po_history(int[], int, boolean) to authenticated;
grant execute on function public.in4_material_name_search(text[], int[], int) to authenticated;
grant execute on function public.in4_material_last_rate(int[]) to authenticated;
grant execute on function public.in4_party_po_orders(int) to authenticated;
grant execute on function public.in4_party_price_gaps(int, int) to authenticated;
grant execute on function public.in4_po_ledger_header(int) to authenticated;
grant execute on function public.in4_po_ledger_grns(int) to authenticated;
grant execute on function public.in4_po_ledger_bills(int) to authenticated;
