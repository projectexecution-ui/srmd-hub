-- ===========================================================================
-- Warehouse / Site Material In-Out — gate register spine.
--
-- Builds ON TOP of the existing inventory module rather than beside it: the
-- item master (inv_items), stores (inv_warehouses), inv_stock and the
-- inv_stock_movement_type enum (which already carries receipt / issue /
-- transfer_in / transfer_out / damage / adjustment) are all reused. Nothing
-- existing is altered or dropped.
--
-- Note: the inv_gate_out CHECK below is superseded by
-- 20260813_warehouse_gate_out_shape_fix.sql, which adds the missing
-- `project_id is null` on the store branch. Kept as applied so a replay of the
-- migration history reproduces the same end state.
-- ===========================================================================

-- 1. The gate register's main user did not exist as a role anywhere in the hub.
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                 where t.typname='user_role' and e.enumlabel='security') then
    alter type user_role add value 'security';
  end if;
end $$;

-- 2. Permission helper — same shape as the existing inv_stock policies, in one
--    place so every new table's RLS reads identically.
create or replace function fn_inv_can(p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from role_permissions rp join profiles p on rp.role = p.role
    where p.id = auth.uid() and rp.module_slug = 'inventory'
      and case p_action when 'view'  then rp.can_view
                        when 'edit'  then rp.can_edit
                        when 'admin' then rp.can_admin
                        else false end
  );
$$;

-- 3. Purchase orders — light header + lines, so a PO can carry a running
--    pending balance. Part deliveries are the normal case, not an exception.
create table if not exists inv_po (
  id                 uuid primary key default gen_random_uuid(),
  po_no              text not null unique,
  po_date            date,
  kind               text not null default 'po' check (kind in ('po','wo')),
  vendor             text,
  entity             text,                       -- which trust paid
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

create table if not exists inv_po_lines (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references inv_po(id) on delete cascade,
  item_id     uuid not null references inv_items(id),
  ordered_qty numeric(14,3) not null check (ordered_qty > 0),
  rate        numeric(14,2),
  unique (po_id, item_id)
);

-- 4. Gate IN — one entry per challan / per truck.
create table if not exists inv_gate_in (
  id             uuid primary key default gen_random_uuid(),
  entry_no       text not null unique,           -- e.g. In: 15Aug26/004
  entry_date     date not null default (now() at time zone 'Asia/Kolkata')::date,
  owner          text not null default 'srm' check (owner in ('srm','vendor')),
  po_id          uuid references inv_po(id) on delete set null,
  po_no_text     text,                           -- unstructured PO reference
  no_po_reason   text,                           -- required when there is no PO
  party          text not null,
  entity         text,
  project_id     uuid references projects(id) on delete set null,
  warehouse_id   uuid not null references inv_warehouses(id),
  delivery_mode  text,
  vehicle_no     text,
  driver_mobile  text,
  challan_no     text,
  challan_date   date,
  remarks        text,
  photo_urls     text[] not null default '{}',
  security_sign_url text,
  receiver_sign_url text,
  receiver_name  text,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references profiles(id),
  -- an emergency entry must say why it had no PO
  constraint inv_gate_in_nopo_reason
    check (po_id is not null or po_no_text is not null or no_po_reason is not null)
);

create table if not exists inv_gate_in_lines (
  id           uuid primary key default gen_random_uuid(),
  gate_in_id   uuid not null references inv_gate_in(id) on delete cascade,
  item_id      uuid not null references inv_items(id),
  po_line_id   uuid references inv_po_lines(id) on delete set null,
  challan_qty  numeric(14,3) not null check (challan_qty >= 0),
  received_qty numeric(14,3) not null check (received_qty >= 0),
  damaged_qty  numeric(14,3) not null default 0 check (damaged_qty >= 0),
  rate         numeric(14,2),
  -- 'typed' rates move stock value with no check behind them, so they are
  -- flagged at source and reported.
  rate_source  text check (rate_source in ('po','typed','last')),
  -- what actually joins stock, and what the supplier owes us
  good_qty     numeric(14,3) generated always as (received_qty - damaged_qty) stored,
  short_qty    numeric(14,3) generated always as (challan_qty - received_qty) stored,
  constraint inv_gate_in_dmg_le_recv check (damaged_qty <= received_qty)
);

-- 5. Gate OUT — ONE table for both a site issue and a store-to-store move.
--    They looked identical on screen, so the difference is enforced here in the
--    shape of the row: a site issue consumes stock and charges a project; a
--    store move only relocates it and charges nothing.
create table if not exists inv_gate_out (
  id                uuid primary key default gen_random_uuid(),
  entry_no          text not null unique,        -- Out: … / Tr: …
  entry_date        date not null default (now() at time zone 'Asia/Kolkata')::date,
  dest_type         text not null check (dest_type in ('site','store')),
  from_warehouse_id uuid not null references inv_warehouses(id),
  to_warehouse_id   uuid references inv_warehouses(id),
  project_id        uuid references projects(id) on delete set null,
  entity            text,
  engineer_id       uuid references profiles(id),
  is_returnable     boolean not null default false,
  return_due_date   date,
  vehicle_no        text,
  remarks           text,
  from_sign_url     text,
  to_sign_url       text,
  confirmed_by      uuid references profiles(id),  -- engineer confirms at site
  confirmed_at      timestamptz,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references profiles(id),
  constraint inv_gate_out_shape check (
    (dest_type = 'site'
       and project_id      is not null
       and to_warehouse_id is null)
    or
    (dest_type = 'store'
       and to_warehouse_id is not null
       and to_warehouse_id <> from_warehouse_id
       and engineer_id     is null
       and is_returnable   is false)
  )
);

create table if not exists inv_gate_out_lines (
  id           uuid primary key default gen_random_uuid(),
  gate_out_id  uuid not null references inv_gate_out(id) on delete cascade,
  item_id      uuid not null references inv_items(id),
  qty          numeric(14,3) not null check (qty > 0),
  rate         numeric(14,2),
  returned_qty numeric(14,3) not null default 0 check (returned_qty >= 0),
  constraint inv_gate_out_ret_le_qty check (returned_qty <= qty)
);

-- 6. Indexes for the reports that will actually be run.
create index if not exists inv_gate_in_date_idx      on inv_gate_in (entry_date desc) where deleted_at is null;
create index if not exists inv_gate_in_wh_idx        on inv_gate_in (warehouse_id, entry_date desc);
create index if not exists inv_gate_in_po_idx        on inv_gate_in (po_id) where po_id is not null;
create index if not exists inv_gate_in_owner_idx     on inv_gate_in (owner, party);
create index if not exists inv_gate_in_lines_item_idx on inv_gate_in_lines (item_id);
create index if not exists inv_gate_in_lines_po_idx  on inv_gate_in_lines (po_line_id) where po_line_id is not null;
create index if not exists inv_gate_out_date_idx     on inv_gate_out (entry_date desc) where deleted_at is null;
create index if not exists inv_gate_out_from_idx     on inv_gate_out (from_warehouse_id, entry_date desc);
create index if not exists inv_gate_out_proj_idx     on inv_gate_out (project_id) where project_id is not null;
create index if not exists inv_gate_out_ret_idx      on inv_gate_out (is_returnable, entry_date) where is_returnable;
create index if not exists inv_gate_out_lines_item_idx on inv_gate_out_lines (item_id);
create index if not exists inv_po_status_idx         on inv_po (status) where deleted_at is null;

-- 7. RLS — identical shape on every table: view to read, edit to write,
--    admin to delete.
do $$
declare t text;
begin
  foreach t in array array['inv_po','inv_po_lines','inv_gate_in','inv_gate_in_lines',
                           'inv_gate_out','inv_gate_out_lines']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read',   t);
    execute format('drop policy if exists %I on %I', t||'_write',  t);
    execute format('drop policy if exists %I on %I', t||'_delete', t);
    execute format('create policy %I on %I for select using (fn_inv_can(''view''))', t||'_read', t);
    execute format('create policy %I on %I for all using (fn_inv_can(''edit'')) with check (fn_inv_can(''edit''))', t||'_write', t);
    execute format('create policy %I on %I for delete using (fn_inv_can(''admin''))', t||'_delete', t);
  end loop;
end $$;

grant execute on function fn_inv_can(text) to authenticated;
