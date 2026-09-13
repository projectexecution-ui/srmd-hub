-- ============================================================
-- Material In & Out — the Stores section
-- ============================================================
-- Built from Aksha's mind map "Site Material In-Out Process" (13 Sep 2026).
-- Additive only: nothing existing is altered. The old wh_* and inv_* tables
-- were dropped in the revamp, so this is a clean spine, not a patch on them.
--
-- WHY EACH TABLE
--   mio_lists       EVERY small master in one table — entity, delivery mode,
--                   item category, discipline, storage location. One table
--                   because Aksha asked for one editable place, and because
--                   an entity must stay "open to add and map" (13 Sep 2026):
--                   in4_company_id maps a local entity onto an IN4 company
--                   when one exists, and stays null when it does not, so a
--                   trust IN4 has not got yet can be added here today and
--                   pointed at IN4 later without a migration.
--   mio_items       the item master. in4_material_id maps to IN4's 4,097
--                   materials; null means a local item (an Odoo row IN4 has
--                   never carried). Same add-and-map rule.
--   mio_entries     ONE row per gate movement, in or out, across all three
--                   registers (vendor / srm / transfer). One table because
--                   the mind map's three branches share a single gate and a
--                   single numbering series — splitting them would let the
--                   vendor register and the stock register disagree.
--   mio_entry_lines the item lines on an entry. Deliberately ABSENT on a
--                   vendor IN: the map gives vendor Step 1 no item fields at
--                   all, because material delivered to a site is not stock.
--                   Only its returnables (Step 3) get lines.
--   mio_requests    the engineer's ask, and its approval.
--   mio_movements   THE LEDGER. Signed quantities; stock is folded from this
--                   and never stored as a running total, so the screen and
--                   the ledger cannot drift apart.
--   mio_photos      challan / bill / e-way / item / storage-location shots.
--   mio_edits       every correction to a saved entry — Aksha, 13 Sep 2026:
--                   entries ARE editable, but old value, new value, who and
--                   when are kept and shown.
--
-- ACCESS
--   SELECT  any authenticated user. The section itself is gated in the app,
--           which today shows it to admin only while Aksha reviews it.
--   WRITE   anyone but viewer/contractor — recording a vehicle at the gate is
--           the job, not a privilege.
--   MASTERS admin, head, founder.
--   DELETE  nothing is deleted. Entries are voided, masters deactivated.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.mio_can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role() is not null
     and public.current_user_role()::text not in ('viewer','contractor');
$$;

create or replace function public.mio_can_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text in ('admin','head','founder');
$$;

-- ── 1. Masters — one table, five kinds ──────────────────────────────────────
create table if not exists public.mio_lists (
  id             uuid primary key default uuid_generate_v4(),
  kind           text not null check (kind in ('entity','delivery_mode','item_category','discipline','location')),
  name           text not null,
  code           text,
  -- Storage location is two levels: a site, then the spot inside it
  -- ("CT Warehouse" → "Container 1"). parent_id is null for the site.
  parent_id      uuid references public.mio_lists(id) on delete cascade,
  -- A storage location may belong to a project (P2 → A01). Null = shared.
  project_id     uuid references public.projects(id) on delete set null,
  -- ENTITY ONLY: which IN4 company this is. Null is legal and expected —
  -- "keep it open to add and map" (Aksha, 13 Sep 2026).
  in4_company_id int,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mio_lists_kind_idx   on public.mio_lists(kind, is_active, display_order);
create index if not exists mio_lists_parent_idx on public.mio_lists(parent_id);
create unique index if not exists mio_lists_name_uq
  on public.mio_lists(kind, lower(name), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists mio_lists_touch on public.mio_lists;
create trigger mio_lists_touch before update on public.mio_lists
  for each row execute function public.set_updated_at();

-- ── 2. Item master ──────────────────────────────────────────────────────────
create table if not exists public.mio_items (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  unit            text not null default 'Nos',
  -- Null = an item IN4 has never carried (an Odoo row, a site-made item).
  in4_material_id int,
  discipline_id   uuid references public.mio_lists(id) on delete set null,
  -- What it last cost. Seeded from IN4's last-purchase-rate where known, then
  -- kept current by gate entries.
  last_rate       numeric(14,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists mio_items_name_uq on public.mio_items(lower(name));
create unique index if not exists mio_items_in4_uq  on public.mio_items(in4_material_id) where in4_material_id is not null;
create index if not exists mio_items_active_idx on public.mio_items(is_active, name);

drop trigger if exists mio_items_touch on public.mio_items;
create trigger mio_items_touch before update on public.mio_items
  for each row execute function public.set_updated_at();

-- ── 3. Requests (SRM Out starts here) ───────────────────────────────────────
create table if not exists public.mio_requests (
  id            uuid primary key default uuid_generate_v4(),
  no            text not null,
  project_id    uuid not null references public.projects(id) on delete cascade,
  -- Set when one project borrows from another's store: the map's
  -- "Internal Transfers/Loan". Null for a normal issue from the warehouse.
  from_project_id uuid references public.projects(id) on delete set null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','issued','closed')),
  needed_by     date,
  remarks       text,
  raised_by     uuid references public.profiles(id) on delete set null,
  raised_at     timestamptz not null default now(),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists mio_requests_status_idx on public.mio_requests(status, raised_at desc);
create index if not exists mio_requests_project_idx on public.mio_requests(project_id, raised_at desc);

drop trigger if exists mio_requests_touch on public.mio_requests;
create trigger mio_requests_touch before update on public.mio_requests
  for each row execute function public.set_updated_at();

create table if not exists public.mio_request_lines (
  id          uuid primary key default uuid_generate_v4(),
  request_id  uuid not null references public.mio_requests(id) on delete cascade,
  item_id     uuid not null references public.mio_items(id) on delete restrict,
  unit        text not null,
  qty         numeric(14,3) not null check (qty > 0),
  -- Material from ANOTHER project's store is always returnable; the Atm Head
  -- may waive it after approval. Carried forward from the retired module.
  returnable  boolean not null default false,
  issued_qty  numeric(14,3) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists mio_request_lines_req_idx on public.mio_request_lines(request_id);

-- ── 4. The gate register ────────────────────────────────────────────────────
create table if not exists public.mio_entries (
  id            uuid primary key default uuid_generate_v4(),
  direction     text not null check (direction in ('in','out')),
  register      text not null check (register in ('vendor','srm','transfer')),
  -- "In: 13Sep26/004" — the map's own format, generated not typed.
  no            text not null,
  seq           int  not null,
  entry_date    date not null default (now() at time zone 'Asia/Kolkata')::date,
  entry_at      timestamptz not null default now(),
  -- gate     Security has recorded the vehicle; the storekeeper has not finished
  -- complete the entry is finished and (for an IN) stock has moved
  -- closed   nothing further is expected of it
  -- void     recorded in error; kept, never deleted
  stage         text not null default 'gate' check (stage in ('gate','complete','closed','void')),

  project_id       uuid references public.projects(id) on delete set null,
  entity_id        uuid references public.mio_lists(id) on delete set null,
  delivery_mode_id uuid references public.mio_lists(id) on delete set null,
  item_category_id uuid references public.mio_lists(id) on delete set null,
  location_id      uuid references public.mio_lists(id) on delete set null,
  po_wo_no         text,
  party_name       text,
  in4_party_id     int,

  vehicle_no      text,
  driver_name     text,
  driver_mobile   text,
  driver_licence  text,
  remarks         text,
  security_by     text,
  handed_over_party text,
  handed_over_to  text,
  incharge_name   text,

  -- An OUT that answers an IN: the returnable going back, or the vehicle
  -- leaving. The map: 'Out: 15Aug26 (In: 15Aug26)'.
  linked_entry_id uuid references public.mio_entries(id) on delete set null,
  request_id      uuid references public.mio_requests(id) on delete set null,

  -- Signatures. Aksha, 13 Sep 2026 — query 6 still open, so this records the
  -- signed-in person and the moment, which is provable; a drawn signature can
  -- be added on top without changing any of this.
  security_signed_by uuid references public.profiles(id) on delete set null,
  security_signed_at timestamptz,
  receiver_signed_by uuid references public.profiles(id) on delete set null,
  receiver_signed_at timestamptz,
  incharge_signed_by uuid references public.profiles(id) on delete set null,
  incharge_signed_at timestamptz,

  created_by    uuid references public.profiles(id) on delete set null,
  completed_by  uuid references public.profiles(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists mio_entries_no_uq on public.mio_entries(direction, entry_date, seq);
create index if not exists mio_entries_stage_idx  on public.mio_entries(stage, entry_at desc);
create index if not exists mio_entries_project_idx on public.mio_entries(project_id, entry_at desc);
create index if not exists mio_entries_linked_idx on public.mio_entries(linked_entry_id);

drop trigger if exists mio_entries_touch on public.mio_entries;
create trigger mio_entries_touch before update on public.mio_entries
  for each row execute function public.set_updated_at();

create table if not exists public.mio_entry_lines (
  id           uuid primary key default uuid_generate_v4(),
  entry_id     uuid not null references public.mio_entries(id) on delete cascade,
  item_id      uuid not null references public.mio_items(id) on delete restrict,
  unit         text not null,
  qty          numeric(14,3) not null check (qty > 0),
  rate         numeric(14,2),
  amount       numeric(16,2),
  returnable   boolean not null default false,
  -- The IN4 PO line this answers, when the storekeeper picked a PO.
  in4_po_item_id int,
  created_at   timestamptz not null default now()
);
create index if not exists mio_entry_lines_entry_idx on public.mio_entry_lines(entry_id);
create index if not exists mio_entry_lines_item_idx  on public.mio_entry_lines(item_id);

-- ── 5. The ledger — the single source of stock ──────────────────────────────
create table if not exists public.mio_movements (
  id          uuid primary key default uuid_generate_v4(),
  item_id     uuid not null references public.mio_items(id) on delete restrict,
  location_id uuid references public.mio_lists(id) on delete set null,
  project_id  uuid references public.projects(id) on delete set null,
  kind        text not null check (kind in ('opening','in','out','adjust')),
  -- SIGNED. + adds to stock, - takes from it. Stock is sum(qty); there is no
  -- running total anywhere, so nothing can disagree with this table.
  qty         numeric(14,3) not null,
  rate        numeric(14,2),
  entry_id    uuid references public.mio_entries(id) on delete cascade,
  note        text,
  moved_at    timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists mio_movements_item_idx on public.mio_movements(item_id, location_id);
create index if not exists mio_movements_when_idx on public.mio_movements(moved_at desc);
create index if not exists mio_movements_entry_idx on public.mio_movements(entry_id);

-- ── 6. Photos ───────────────────────────────────────────────────────────────
create table if not exists public.mio_photos (
  id         uuid primary key default uuid_generate_v4(),
  entry_id   uuid not null references public.mio_entries(id) on delete cascade,
  kind       text not null check (kind in ('challan','bill','eway','item','location','other')),
  path       text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mio_photos_entry_idx on public.mio_photos(entry_id);

-- ── 7. Corrections — Aksha's "yes, entries are editable" ────────────────────
create table if not exists public.mio_edits (
  id         uuid primary key default uuid_generate_v4(),
  table_name text not null,
  row_id     uuid not null,
  field      text not null,
  old_value  text,
  new_value  text,
  reason     text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists mio_edits_row_idx on public.mio_edits(table_name, row_id, changed_at desc);

-- ── 8. Numbering — "In: 13Sep26/004", generated under a lock ────────────────
create or replace function public.fn_mio_next_seq(p_direction text, p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  -- One lock per direction+day, so two guards saving at the same moment can
  -- never be handed the same number.
  perform pg_advisory_xact_lock(hashtext('mio_no_' || p_direction || p_date::text));
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.mio_entries where direction = p_direction and entry_date = p_date;
  return v_seq;
end $$;

-- ── 9. Seed — the four editable masters ─────────────────────────────────────
-- Entities: IN4's own four, mapped by id. Aksha, 13 Sep 2026: "Use IN4
-- Entities - mindmap had errors". The map's SRST is deliberately absent; it
-- can be added here later with a null in4_company_id and mapped when IN4 has it.
insert into public.mio_lists (kind, name, code, in4_company_id, display_order)
select 'entity', c.name, c.code, c.id, row_number() over (order by c.code) * 10
  from public.in4_companies c
on conflict do nothing;

insert into public.mio_lists (kind, name, display_order) values
  ('delivery_mode','Trailer',        10),
  ('delivery_mode','Truck',          20),
  ('delivery_mode','Tempo',          30),
  ('delivery_mode','Pickup',         40),
  ('delivery_mode','Hand Delivered', 50),
  ('item_category','Vendor Materials', 10),
  ('item_category','Ordered Items',    20),
  ('item_category','Returnable Items', 30),
  ('discipline','Civil',                        10),
  ('discipline','Exterior Facade Items',        20),
  ('discipline','Mechanical: HVAC',             30),
  ('discipline','Mechanical: Lifts',            40),
  ('discipline','Mechanical: Steel Fabrication',50),
  ('discipline','Electrical',                   60),
  ('discipline','Plumbing',                     70),
  ('discipline','Fire Fighting',                80),
  ('discipline','ICT',                          90),
  ('discipline','Finishes',                    100)
on conflict do nothing;

-- Storage locations: the sites from the map that EXIST as CT Hub projects,
-- each with an Open Area. Aksha adds the rest from the Masters screen — that
-- is the point of them being editable.
do $$
declare v_parent uuid;
begin
  -- CT Warehouse is shared, not a project's.
  insert into public.mio_lists (kind, name, display_order)
  values ('location','CT Warehouse (Yunus)', 10)
  on conflict do nothing;
  select id into v_parent from public.mio_lists
   where kind='location' and lower(name)='ct warehouse (yunus)' and parent_id is null;
  if v_parent is not null then
    insert into public.mio_lists (kind, name, parent_id, display_order) values
      ('location','Open Area',   v_parent, 10),
      ('location','Container 1', v_parent, 20)
    on conflict do nothing;
  end if;
end $$;

-- ── 10. Row-level security ──────────────────────────────────────────────────
alter table public.mio_lists         enable row level security;
alter table public.mio_items         enable row level security;
alter table public.mio_requests      enable row level security;
alter table public.mio_request_lines enable row level security;
alter table public.mio_entries       enable row level security;
alter table public.mio_entry_lines   enable row level security;
alter table public.mio_movements     enable row level security;
alter table public.mio_photos        enable row level security;
alter table public.mio_edits         enable row level security;

drop policy if exists mio_lists_select on public.mio_lists;
create policy mio_lists_select on public.mio_lists for select to authenticated using (true);
drop policy if exists mio_lists_write on public.mio_lists;
create policy mio_lists_write on public.mio_lists for all to authenticated
  using (public.mio_can_admin()) with check (public.mio_can_admin());

drop policy if exists mio_items_select on public.mio_items;
create policy mio_items_select on public.mio_items for select to authenticated using (true);
-- A storekeeper must be able to add an item the moment one arrives that IN4
-- has never carried; refusing would stop the gate.
drop policy if exists mio_items_write on public.mio_items;
create policy mio_items_write on public.mio_items for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_requests_select on public.mio_requests;
create policy mio_requests_select on public.mio_requests for select to authenticated using (true);
drop policy if exists mio_requests_write on public.mio_requests;
create policy mio_requests_write on public.mio_requests for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_request_lines_select on public.mio_request_lines;
create policy mio_request_lines_select on public.mio_request_lines for select to authenticated using (true);
drop policy if exists mio_request_lines_write on public.mio_request_lines;
create policy mio_request_lines_write on public.mio_request_lines for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_entries_select on public.mio_entries;
create policy mio_entries_select on public.mio_entries for select to authenticated using (true);
drop policy if exists mio_entries_write on public.mio_entries;
create policy mio_entries_write on public.mio_entries for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_entry_lines_select on public.mio_entry_lines;
create policy mio_entry_lines_select on public.mio_entry_lines for select to authenticated using (true);
drop policy if exists mio_entry_lines_write on public.mio_entry_lines;
create policy mio_entry_lines_write on public.mio_entry_lines for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_movements_select on public.mio_movements;
create policy mio_movements_select on public.mio_movements for select to authenticated using (true);
-- The ledger is append-only: no update policy and no delete policy exist, so
-- a movement can be written and then only ever read. A mistake is corrected
-- by a further movement, which is what an audit trail means.
drop policy if exists mio_movements_insert on public.mio_movements;
create policy mio_movements_insert on public.mio_movements for insert to authenticated
  with check (public.mio_can_write());

drop policy if exists mio_photos_select on public.mio_photos;
create policy mio_photos_select on public.mio_photos for select to authenticated using (true);
drop policy if exists mio_photos_write on public.mio_photos;
create policy mio_photos_write on public.mio_photos for all to authenticated
  using (public.mio_can_write()) with check (public.mio_can_write());

drop policy if exists mio_edits_select on public.mio_edits;
create policy mio_edits_select on public.mio_edits for select to authenticated using (true);
drop policy if exists mio_edits_insert on public.mio_edits;
create policy mio_edits_insert on public.mio_edits for insert to authenticated
  with check (public.mio_can_write());

-- ── 11. Photo storage ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mio-photos', 'mio-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists mio_photos_read on storage.objects;
create policy mio_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'mio-photos');
drop policy if exists mio_photos_upload on storage.objects;
create policy mio_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'mio-photos' and public.mio_can_write());
