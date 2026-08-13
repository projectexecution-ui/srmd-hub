-- Starter storage locations: two levels (site → spot), taken from Aksha's
-- screenshot and the store names the old module already used. Every spot name
-- says "store"/"area" so a location can never be mistaken for a project name —
-- the ambiguity that made a site issue and a store move look identical.
insert into wh_locations (code, name, sort) values
  ('CT',  'CT Warehouse', 1),
  ('NGH', 'NGH',          2),
  ('P2',  'P2',           3),
  ('CEN', 'Central',      4)
on conflict (code) do nothing;

insert into wh_locations (code, name, parent_id, sort)
select v.code, v.name, p.id, v.sort
from (values
  ('CT-OPEN',  'Open Area (CT)',   'CT',  1),
  ('CT-CON1',  'Container 1 (CT)', 'CT',  2),
  ('CT-CON2',  'Container 2 (CT)', 'CT',  3),
  ('NGH-OPEN', 'NGH Open Area',    'NGH', 1),
  ('NGH-A',    'NGH A store',      'NGH', 2),
  ('NGH-B',    'NGH B store',      'NGH', 3),
  ('P2-OPEN',  'P2 Open Area',     'P2',  1),
  ('CEN-MAIN', 'Central Store',    'CEN', 1)
) as v(code, name, parent_code, sort)
join wh_locations p on p.code = v.parent_code and p.parent_id is null
on conflict (code) do nothing;

-- Keeper on the CT stores: the one keeper the old module actually had mapped.
-- Read-only from inv_warehouses; the existing module is not modified.
update wh_locations l set keeper_id = w.store_manager_id
from inv_warehouses w
where w.store_manager_id is not null and l.code in ('CT-OPEN','CT-CON1','CT-CON2')
  and l.keeper_id is null;
