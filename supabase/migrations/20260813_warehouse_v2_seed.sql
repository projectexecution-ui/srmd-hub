-- Warehouse V2 — permissions, starter lists, and a one-time copy of the item
-- master so nobody retypes 514 items. DO NOTHING on every conflict: never
-- DO UPDATE on a seed, or a re-run silently overwrites live edits.

-- 1. The module's row in the central permissions matrix.
insert into role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin',         'warehouse', true,  true,  true ),
  ('founder',       'warehouse', true,  false, false),   -- Trustee: reports only
  ('head',          'warehouse', true,  true,  true ),   -- Atm Head approves counts
  ('project_head',  'warehouse', true,  false, false),
  ('coordinator',   'warehouse', true,  true,  false),
  ('store_manager', 'warehouse', true,  true,  false),   -- Storekeeper
  ('backoffice',    'warehouse', true,  true,  false),
  ('security',      'warehouse', true,  true,  false),   -- gate entries, values hidden
  ('engineer',      'warehouse', true,  true,  false),   -- confirms receipt
  ('uploader',      'warehouse', true,  true,  false),
  ('billing',       'warehouse', true,  false, false),
  ('viewer',        'warehouse', true,  false, false)
on conflict (role, module_slug) do nothing;

insert into role_labels (role, label, description) values
  ('security', 'Security (Gate)', 'Records material arriving and leaving at the main gate. Cannot see rates, values or reports.')
on conflict (role) do nothing;

-- 2. Starter lists. The three Aksha still owes ("you fill" in the preview) are
--    seeded with sensible construction defaults so the module is usable from day
--    one; he edits them in Settings without a developer.
insert into wh_lists (kind, value, sort) values
  ('entity','SRMD Org Stock',1),('entity','SRASSK',2),('entity','SRET',3),
  ('entity','SRJT',4),('entity','SRST',5),
  ('unit','Bag',1),('unit','MT',2),('unit','Nos',3),('unit','Brass',4),
  ('unit','Kg',5),('unit','Ltr',6),('unit','Box',7),('unit','Sqm',8),('unit','Rmt',9),
  ('delivery_mode','Truck',1),('delivery_mode','Tempo',2),('delivery_mode','Tractor',3),
  ('delivery_mode','By hand',4),('delivery_mode','Courier',5),
  ('count_reason','Wastage at site',1),('count_reason','Breakage',2),
  ('count_reason','Not traced',3),('count_reason','Entry missed',4),
  ('count_reason','Unit confusion',5),('count_reason','Theft suspected',6)
on conflict (kind, value) do nothing;

-- 3. Categories lifted from whatever the old item master already uses, so the
--    list reflects reality rather than my guesses.
insert into wh_lists (kind, value)
select distinct 'category', trim(category) from inv_items
where category is not null and trim(category) <> ''
on conflict (kind, value) do nothing;

-- 4. One-time copy of the item master. READ ONLY from inv_items — the existing
--    module is not modified in any way. After this the two are independent.
insert into wh_items (code, name, unit, category, subcategory, hsn_code, image_url, is_active)
select code, name, coalesce(nullif(trim(unit),''), 'Nos'), category, subcategory,
       hsn_code, image_url, coalesce(is_active, true)
from inv_items
where deleted_at is null and coalesce(approval_status,'approved') <> 'rejected'
on conflict (code) do nothing;
