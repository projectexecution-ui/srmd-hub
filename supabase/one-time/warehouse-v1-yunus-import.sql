-- ===========================================================================
-- ONE-TIME DATA MOVE — already run against production on 2026-08-16.
--
-- NOT a migration and NOT a test. This folder is never applied automatically;
-- the file is kept so there is a record of what was done to live data and why.
-- Re-running it is harmless (every insert is guarded) but pointless.
--
-- WHAT: the 472 stock rows sitting in the old `inventory` module's "Yunus"
-- warehouse, brought into Warehouse V2 as the opening balance of a new location
-- "Yunus Land → Yunus Land Store".
--
-- WHY IT IS AN `adjust` AND NOT AN `in`: no truck arrived. This is a balance
-- carried over from the old module, and every ledger row says so in its remark.
-- Recording it as a receipt would have put 472 phantom deliveries into the
-- supplier and PO reports.
--
-- WHAT IT IS NOT: verified. V1's own figures were never checked against a shelf
-- (that module was never adopted), so this imports an unverified number and
-- labels it as one. A physical count of Yunus Land is what turns it into a
-- figure anybody can stand behind.
--
-- RESULT: 472 items · 78,375.5 units · 472 ledger entries · keeper carried over
-- from V1 (Akshay Atmarpit) · reorder levels carried from inv_stock.min_threshold.
-- V1 was left completely untouched.
-- ===========================================================================

do $$
declare
  me uuid; site_id uuid; store_id uuid; keeper uuid;
  n_stock int; n_mov int; v_qty numeric;
begin
  select id into me from profiles where email='projectexecution@construction.srmd.org' limit 1;
  if me is null then select id into me from profiles order by created_at limit 1; end if;
  select store_manager_id into keeper from inv_warehouses where name='Yunus';

  -- 1 · the location, following the existing Central Store pattern (site → store)
  insert into wh_locations (code, name, sort, is_active)
  values ('YL', 'Yunus Land', 5, true)
  on conflict (code) do nothing;
  select id into site_id from wh_locations where code='YL';

  insert into wh_locations (parent_id, code, name, keeper_id, sort, is_active)
  values (site_id, 'YL-MAIN', 'Yunus Land Store', keeper, 1, true)
  on conflict (code) do nothing;
  select id into store_id from wh_locations where code='YL-MAIN';

  -- 2 · the stock, matched to V2 items on the normalised name.
  --     Measured before running: 472 of 472 matched, and NOT ONE unit
  --     disagreed — which mattered, because a unit is locked to its item and a
  --     mismatch would have silently rescaled a quantity.
  create temp table _v1 on commit drop as
  select t.id as item_id, s.physical_qty, s.damaged_qty, s.min_threshold
  from inv_stock s
  join inv_items i on i.id = s.item_id
  join inv_warehouses w on w.id = s.warehouse_id
  join wh_items t on t.deleted_at is null
    and lower(btrim(regexp_replace(t.name,'[^a-zA-Z0-9]+',' ','g')))
      = lower(btrim(regexp_replace(i.name,'[^a-zA-Z0-9]+',' ','g')))
  where w.name = 'Yunus' and s.physical_qty > 0;

  insert into wh_stock (item_id, location_id, qty, damaged_qty, min_qty, last_moved_at)
  select item_id, store_id, physical_qty, coalesce(damaged_qty,0), min_threshold, now()
  from _v1
  on conflict (item_id, location_id) do nothing;
  get diagnostics n_stock = row_count;

  insert into wh_movements (item_id, location_id, kind, qty, ref_table, actor_id, remarks)
  select item_id, store_id, 'adjust', physical_qty, 'inv_stock', me,
         'Opening balance imported from Warehouse V1 (Yunus) — not physically verified'
  from _v1;
  get diagnostics n_mov = row_count;

  select coalesce(sum(qty),0) into v_qty from wh_stock where location_id = store_id;

  -- All or nothing. A half-imported store is worse than none.
  if n_stock <> 472 or n_mov <> 472 or v_qty <> 78375.5 then
    raise exception 'ROLLED BACK — expected 472 rows / 78375.5 units, got stock=% movements=% qty=%',
      n_stock, n_mov, v_qty;
  end if;
  raise notice 'imported % stock rows, % ledger entries, % units', n_stock, n_mov, v_qty;
end $$;
