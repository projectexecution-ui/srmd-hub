-- ===========================================================================
-- WAREHOUSE V2 — Site Material In-Out register (the HOD's mindmap + the 22
-- review fixes). A SEPARATE module: its own wh_* tables, its own stock and its
-- own ledger. The existing inventory module is not referenced anywhere.
--
-- Shared with the rest of the hub (never duplicated): profiles, projects,
-- role_permissions, app_settings, notifications, recycle bin.
-- ===========================================================================

create type wh_movement_kind as enum
  ('in','damage','issue','move_out','move_in','return','adjust');

create or replace function fn_wh_can(p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from role_permissions rp join profiles p on rp.role = p.role
    where p.id = auth.uid() and rp.module_slug = 'warehouse'
      and case p_action when 'view'  then rp.can_view
                        when 'edit'  then rp.can_edit
                        when 'admin' then rp.can_admin
                        else false end
  );
$$;

-- 1. Storage locations — TWO levels (site → spot), as per the screenshot. A
--    location name must never read like a project name, hence "… store".
create table wh_locations (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references wh_locations(id) on delete restrict,
  code       text not null unique,
  name       text not null,
  keeper_id  uuid references profiles(id),      -- who may post entries here
  sort       int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id)
);
-- exactly two levels: a spot's parent must itself be a top-level site
create or replace function fn_wh_loc_depth() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'a location cannot be its own parent'; end if;
    if (select parent_id from wh_locations where id = new.parent_id) is not null then
      raise exception 'storage locations are only two levels deep (site then spot)';
    end if;
  end if;
  return new;
end $$;
create trigger wh_loc_depth before insert or update on wh_locations
  for each row execute function fn_wh_loc_depth();

-- 2. Small lists the admin maintains — item categories, units, delivery modes,
--    entities. One table so a new list never needs a migration.
create table wh_lists (
  id        uuid primary key default gen_random_uuid(),
  kind      text not null check (kind in ('category','unit','delivery_mode','entity','discipline','count_reason')),
  value     text not null,
  sort      int  not null default 0,
  is_active boolean not null default true,
  unique (kind, value)
);

-- 3. Item master. `unit` is locked to the item — one wrong unit used to poison
--    an item's stock forever.                                          (#11)
create table wh_items (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  unit        text not null,
  category    text,
  subcategory text,
  discipline  text,
  hsn_code    text,
  last_rate   numeric(14,2),
  image_url   text,
  is_active   boolean not null default true,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references profiles(id)
);
create index wh_items_name_idx on wh_items (lower(name)) where deleted_at is null;
create index wh_items_cat_idx  on wh_items (category)    where deleted_at is null;

-- 4. Stock — per item per location. min_qty drives the low/nil flag.
create table wh_stock (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references wh_items(id) on delete cascade,
  location_id   uuid not null references wh_locations(id) on delete restrict,
  qty           numeric(14,3) not null default 0,
  damaged_qty   numeric(14,3) not null default 0,
  min_qty       numeric(14,3),
  last_moved_at timestamptz,
  unique (item_id, location_id)
);
create index wh_stock_loc_idx on wh_stock (location_id);

-- 5. The ledger. Every stock change lands here — this is the audit trail.
create table wh_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references wh_items(id),
  location_id uuid not null references wh_locations(id),
  kind        wh_movement_kind not null,
  qty         numeric(14,3) not null,
  rate        numeric(14,2),
  ref_table   text,
  ref_id      uuid,
  actor_id    uuid references profiles(id),
  remarks     text,
  created_at  timestamptz not null default now()
);
create index wh_mov_item_idx on wh_movements (item_id, created_at desc);
create index wh_mov_loc_idx  on wh_movements (location_id, created_at desc);
create index wh_mov_ref_idx  on wh_movements (ref_table, ref_id);

-- 6. Purchase orders — the PO carries a running pending balance, so a part
--    delivery is the normal case rather than an exception.              (#21)
create table wh_po (
  id                 uuid primary key default gen_random_uuid(),
  po_no              text not null unique,
  po_date            date,
  kind               text not null default 'po' check (kind in ('po','wo')),
  vendor             text,
  entity             text,
  project_id         uuid references projects(id) on delete set null,
  status             text not null default 'open'
                     check (status in ('open','partly_received','fully_received','short_closed')),
  short_close_reason text,
  short_closed_by    uuid references profiles(id),
  short_closed_at    timestamptz,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references profiles(id)
);
create table wh_po_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references wh_po(id) on delete cascade,
  item_id     uuid not null references wh_items(id),
  ordered_qty numeric(14,3) not null check (ordered_qty > 0),
  rate        numeric(14,2),
  unique (po_id, item_id)
);
create index wh_po_status_idx on wh_po (status) where deleted_at is null;

-- 7. Gate IN — one entry per challan / per truck.
create table wh_gate_in (
  id                uuid primary key default gen_random_uuid(),
  entry_no          text not null unique,
  entry_date        date not null default (now() at time zone 'Asia/Kolkata')::date,
  owner             text not null default 'srm' check (owner in ('srm','vendor')),
  po_id             uuid references wh_po(id) on delete set null,
  po_no_text        text,
  no_po_reason      text,
  party             text not null,
  entity            text,
  project_id        uuid references projects(id) on delete set null,
  location_id       uuid not null references wh_locations(id),
  delivery_mode     text,
  vehicle_no        text,
  driver_mobile     text,
  challan_no        text,
  challan_date      date,
  remarks           text,
  photo_urls        text[] not null default '{}',
  security_sign_url text,
  receiver_sign_url text,
  receiver_name     text,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references profiles(id),
  -- an emergency entry must say why it had no PO                        (#15)
  constraint wh_gate_in_nopo_reason
    check (po_id is not null or po_no_text is not null or no_po_reason is not null)
);
create table wh_gate_in_lines (
  id           uuid primary key default gen_random_uuid(),
  gate_in_id   uuid not null references wh_gate_in(id) on delete cascade,
  item_id      uuid not null references wh_items(id),
  po_line_id   uuid references wh_po_lines(id) on delete set null,
  challan_qty  numeric(14,3) not null check (challan_qty  >= 0),
  received_qty numeric(14,3) not null check (received_qty >= 0),
  damaged_qty  numeric(14,3) not null default 0 check (damaged_qty >= 0),
  rate         numeric(14,2),
  -- a typed rate moves stock value with no check behind it, so it is flagged
  -- at source and reported.                                             (#4)
  rate_source  text check (rate_source in ('po','typed','last')),
  -- the two numbers must never be confused: short_qty is the challan check,
  -- the PO balance is a separate calculation entirely.            (#9 vs #21)
  good_qty     numeric(14,3) generated always as (received_qty - damaged_qty) stored,
  short_qty    numeric(14,3) generated always as (challan_qty  - received_qty) stored,
  constraint wh_gate_in_dmg_le_recv check (damaged_qty <= received_qty)
);
create index wh_gin_date_idx  on wh_gate_in (entry_date desc) where deleted_at is null;
create index wh_gin_loc_idx   on wh_gate_in (location_id, entry_date desc);
create index wh_gin_po_idx    on wh_gate_in (po_id) where po_id is not null;
create index wh_gin_owner_idx on wh_gate_in (owner, party);
create index wh_ginl_item_idx on wh_gate_in_lines (item_id);
create index wh_ginl_po_idx   on wh_gate_in_lines (po_line_id) where po_line_id is not null;

-- 8. Gate OUT — ONE table for a site issue AND a store-to-store move. They look
--    identical on screen, so the difference is enforced in the shape of the row:
--    a site issue consumes stock and charges a project; a store move only
--    relocates it and charges nothing.                                   (#8)
create table wh_gate_out (
  id              uuid primary key default gen_random_uuid(),
  entry_no        text not null unique,
  entry_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  dest_type       text not null check (dest_type in ('site','store')),
  from_location_id uuid not null references wh_locations(id),
  to_location_id  uuid references wh_locations(id),
  project_id      uuid references projects(id) on delete set null,
  entity          text,
  engineer_id     uuid references profiles(id),
  is_returnable   boolean not null default false,
  return_due_date date,
  vehicle_no      text,
  remarks         text,
  from_sign_url   text,
  to_sign_url     text,
  confirmed_by    uuid references profiles(id),   -- engineer confirms at site (#12)
  confirmed_at    timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references profiles(id),
  constraint wh_gate_out_shape check (
    (dest_type = 'site'
       and project_id     is not null
       and to_location_id is null)
    or
    (dest_type = 'store'
       and to_location_id is not null
       and to_location_id <> from_location_id
       and project_id     is null      -- a move charges NOTHING to a project
       and engineer_id    is null
       and is_returnable  is false)
  )
);
create table wh_gate_out_lines (
  id           uuid primary key default gen_random_uuid(),
  gate_out_id  uuid not null references wh_gate_out(id) on delete cascade,
  item_id      uuid not null references wh_items(id),
  qty          numeric(14,3) not null check (qty > 0),
  rate         numeric(14,2),
  returned_qty numeric(14,3) not null default 0 check (returned_qty >= 0),
  constraint wh_gate_out_ret_le_qty check (returned_qty <= qty)
);
create index wh_gout_date_idx  on wh_gate_out (entry_date desc) where deleted_at is null;
create index wh_gout_from_idx  on wh_gate_out (from_location_id, entry_date desc);
create index wh_gout_proj_idx  on wh_gate_out (project_id) where project_id is not null;
create index wh_gout_ret_idx   on wh_gate_out (is_returnable, entry_date) where is_returnable;
create index wh_goutl_item_idx on wh_gate_out_lines (item_id);

-- 9. Physical count — location-scoped, blind, witnessed, then approved.
--    Book stock is in-minus-out; the count is reality.                   (#2)
create table wh_counts (
  id            uuid primary key default gen_random_uuid(),
  count_no      text not null unique,
  location_id   uuid not null references wh_locations(id),
  scope         text not null check (scope in ('spot_top','location','full')),
  status        text not null default 'counting'
                check (status in ('counting','submitted','approved','rejected')),
  blind         boolean not null default true,   -- book qty hidden while counting
  counted_by    uuid references profiles(id),
  witness_id    uuid references profiles(id),
  counter_sign_url text,
  witness_sign_url text,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_by   uuid references profiles(id),
  approved_at   timestamptz,
  reject_reason text,
  -- an approved count must carry both people and an approver: a keeper
  -- counting his own store alone is checking himself.
  constraint wh_counts_approved_complete check (
    status <> 'approved'
    or (approved_by is not null and counted_by is not null and witness_id is not null)
  )
);
create table wh_count_lines (
  id          uuid primary key default gen_random_uuid(),
  count_id    uuid not null references wh_counts(id) on delete cascade,
  item_id     uuid not null references wh_items(id),
  seq         int  not null default 0,           -- shelf order, so he walks in a line
  book_qty    numeric(14,3) not null,
  counted_qty numeric(14,3),
  skipped     boolean not null default false,
  skip_reason text,
  reason      text,                              -- only asked on a difference
  remark      text,
  photo_url   text,
  diff        numeric(14,3) generated always as (coalesce(counted_qty,0) - book_qty) stored,
  unique (count_id, item_id),
  -- either it was counted, or it was skipped with a reason
  constraint wh_count_line_shape check (
    (skipped is true  and skip_reason is not null)
    or (skipped is false and counted_qty is not null)
    or (skipped is false and counted_qty is null)   -- not reached yet
  )
);
create index wh_count_lines_seq_idx on wh_count_lines (count_id, seq);
create index wh_counts_loc_idx      on wh_counts (location_id, started_at desc);

-- 10. Strictly sequential entry numbers per register per day — a missing number
--     is visible, so an unrecorded truck cannot hide.                    (#1)
create table wh_number_series (
  register text not null check (register in ('in','out','move','count')),
  day      date not null,
  last_no  int  not null default 0,
  primary key (register, day)
);

create or replace function fn_wh_next_no(p_register text, p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
        n int;
        prefix text := case p_register when 'in' then 'In' when 'out' then 'Out'
                                       when 'move' then 'Tr' else 'Ct' end;
begin
  insert into wh_number_series (register, day, last_no) values (p_register, d, 1)
  on conflict (register, day) do update set last_no = wh_number_series.last_no + 1
  returning last_no into n;
  return prefix || ': ' || to_char(d, 'DDMonYY') || '/' || lpad(n::text, 3, '0');
end $$;

-- 11. RLS — one shape everywhere: view reads, edit writes, admin deletes.
do $$
declare t text;
begin
  foreach t in array array['wh_locations','wh_lists','wh_items','wh_stock','wh_movements',
                           'wh_po','wh_po_lines','wh_gate_in','wh_gate_in_lines',
                           'wh_gate_out','wh_gate_out_lines','wh_counts','wh_count_lines',
                           'wh_number_series']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (fn_wh_can(''view''))',  t||'_read',   t);
    execute format('create policy %I on %I for all    using (fn_wh_can(''edit'')) with check (fn_wh_can(''edit''))', t||'_write', t);
    execute format('create policy %I on %I for delete using (fn_wh_can(''admin''))', t||'_delete', t);
  end loop;
end $$;

grant execute on function fn_wh_can(text)          to authenticated;
grant execute on function fn_wh_next_no(text,date) to authenticated;
