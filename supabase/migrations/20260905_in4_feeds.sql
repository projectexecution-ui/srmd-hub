-- IN4 live sync, Phase 2: every IN4-sourced Excel upload becomes a feed, and
-- the IN4 masters (parties, materials, stores, paying companies, units) get
-- mirror tables the Masters screens read. Applied to the live database on
-- 5 Sept 2026; every statement is idempotent for the merge-time Action.
--
-- Feeds (each has its own shadow/live switch in app_settings):
--   budget      in4_budget_live      the SRMD Budget vs Expenses report   (Phase 1)
--   tracker     in4_tracker_live     Indent → PO tracker (both report slots)
--   contractor  in4_contractor_live  Contractor report (All Types Certificates)
--   supplier    in4_supplier_live    Supplier report (All Purchase Payments)
--   masters     (always mirrors; nothing in the hub is overwritten)
--
-- Read access mirrors the pages these feed (any signed-in user); writes are
-- service-role only — the sync is the single writer.

alter table public.in4_sync_runs add column if not exists feed text not null default 'budget';
create index if not exists in4_sync_runs_feed_idx on public.in4_sync_runs (feed, id desc);

-- ── Indent → PO: one row per indent item, the POs and GRNs under it as JSON ──
create table if not exists public.in4_indent_items (
  indent_item_id    integer primary key,
  indent_id         integer not null,
  indent_no         text not null,
  indent_date       date,
  indent_status     integer,
  project_id        integer,
  project_name      text,
  subproject_id     integer,
  subproject_name   text,
  wo_id             integer,
  wo_no             text,
  skill_id          integer,
  skill_name        text,
  material_id       integer,
  material_name     text,
  material_type     text,
  material_subtype  text,
  uom               text,
  indent_qty        numeric not null default 0,
  ordered_qty       numeric not null default 0,
  received_qty      numeric not null default 0,
  pending_qty       numeric not null default 0,
  status            text,                       -- no_po | pending | partial | received
  pos               jsonb not null default '[]',
  grns              jsonb not null default '[]',
  synced_at         timestamptz not null default now()
);
create index if not exists in4_indent_items_project_idx on public.in4_indent_items (project_id);
create index if not exists in4_indent_items_material_idx on public.in4_indent_items (material_id);

-- ── Contractor certificates: the existing mirror grows the report's columns ──
alter table public.in4_wo_certificates
  add column if not exists kind                text not null default 'wo',   -- wo | advance | misc
  add column if not exists certificate_type_id integer,
  add column if not exists certificate_type    text,
  add column if not exists contractor_id       integer,
  add column if not exists contractor_name     text,
  add column if not exists wo_no               text,
  add column if not exists wo_value            numeric,
  add column if not exists project_id          integer,
  add column if not exists invoice_no          text,
  add column if not exists invoice_date        date,
  add column if not exists creation_dt         date,
  add column if not exists recoveries          numeric,
  add column if not exists deductions          numeric,
  add column if not exists retention_amt       numeric,
  add column if not exists outstanding_amt     numeric;
create index if not exists in4_wo_certificates_project_idx on public.in4_wo_certificates (project_id);

-- ── Supplier certificates (payment + advance), one row per certificate ───────
create table if not exists public.in4_supplier_certificates (
  certificate_id   integer not null,
  kind             text not null,               -- payment | advance
  certificate_no   text,
  project_id       integer,
  subproject_id    integer,
  supplier_id      integer,
  supplier_name    text,
  po_id            integer,
  status           integer,
  category         text,                        -- material type(s), IN4's own spelling
  certified_amt    numeric not null default 0,
  landed_cost      numeric not null default 0,
  tax_addition     numeric not null default 0,
  tax_deduction    numeric not null default 0,
  adv_recovery     numeric not null default 0,
  debit_note_adj   numeric not null default 0,
  retention        numeric not null default 0,
  payable          numeric not null default 0,
  paid             numeric not null default 0,
  outstanding      numeric not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (kind, certificate_id)
);
create index if not exists in4_supplier_certificates_project_idx on public.in4_supplier_certificates (project_id);

-- ── Masters ──────────────────────────────────────────────────────────────────
create table if not exists public.in4_parties (
  kind            text not null,                -- contractor | supplier
  id              integer not null,
  name            text not null,
  code            text,
  pan             text,
  gstin           text,
  msme            text,
  constitution    text,
  address         text,
  city            text,
  state           text,
  pin             text,
  phone           text,
  email           text,
  contact_person  text,
  is_active       boolean not null default true,
  skills          text[] not null default '{}',
  synced_at       timestamptz not null default now(),
  primary key (kind, id)
);

create table if not exists public.in4_materials (
  id            integer primary key,
  name          text not null,
  code          text,
  long_name     text,
  short_name    text,
  type_id       integer,
  type_name     text,
  subtype_id    integer,
  subtype_name  text,
  uom_id        integer,
  uom           text,
  hsn_code      text,
  rate          numeric,
  lead_time     integer,
  is_active     boolean not null default true,
  created_date  date,
  synced_at     timestamptz not null default now()
);
create index if not exists in4_materials_type_idx on public.in4_materials (type_id, subtype_id);

create table if not exists public.in4_stores (
  id            integer primary key,
  name          text not null,
  code          text,
  company_id    integer,
  address       text,
  location      text,
  is_active     boolean not null default true,
  synced_at     timestamptz not null default now()
);

create table if not exists public.in4_companies (
  id            integer primary key,
  name          text not null,
  code          text,
  print_name    text,
  synced_at     timestamptz not null default now()
);

create table if not exists public.in4_uoms (
  id            integer primary key,
  name          text not null,
  is_active     boolean not null default true,
  synced_at     timestamptz not null default now()
);

-- A hub record that an admin has pinned to an IN4 master record, where the
-- name match alone could not decide. Nothing in the hub's own tables changes.
create table if not exists public.master_links (
  id          bigserial primary key,
  kind        text not null check (kind in ('party', 'material', 'store')),
  hub_table   text not null,                    -- vendors | jmr_contractors | wh_items | inv_items | wh_locations | inv_warehouses
  hub_id      text not null,
  in4_key     text not null,                    -- parties: '<kind>:<id>'; materials/stores: '<id>'
  note        text,
  linked_by   uuid,
  linked_at   timestamptz not null default now(),
  unique (kind, hub_table, hub_id)
);

do $$
declare t text;
begin
  foreach t in array array['in4_indent_items','in4_supplier_certificates','in4_parties','in4_materials','in4_stores','in4_companies','in4_uoms']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)', t || '_read', t);
  end loop;
end $$;

alter table public.master_links enable row level security;
drop policy if exists master_links_read on public.master_links;
create policy master_links_read on public.master_links for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists master_links_admin_write on public.master_links;
create policy master_links_admin_write on public.master_links for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)));

-- The switches. 'false' = shadow: sync, compare, report; the upload stays the
-- source. 'true' = the sync writes the module's state the way the upload did.
insert into public.app_settings (key, value) values
  ('in4_tracker_live', 'false'),
  ('in4_contractor_live', 'false'),
  ('in4_supplier_live', 'false')
on conflict (key) do nothing;

-- Advance and misc certificates share the WO certificates' id space in IN4
-- (each is its own header table), so the mirror is keyed by (kind, id).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'in4_wo_certificates_pkey'
             and conrelid = 'public.in4_wo_certificates'::regclass
             and array_length(conkey, 1) = 1) then
    alter table public.in4_wo_certificates drop constraint in4_wo_certificates_pkey;
    alter table public.in4_wo_certificates add primary key (kind, certificate_id);
  end if;
end $$;
