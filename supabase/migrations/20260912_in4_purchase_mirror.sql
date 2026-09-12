-- The purchase side of IN4, mirrored.
--
-- Five screens still read IN4 live for what a material has cost before, what a
-- supplier has delivered, and what a purchase order has been billed for:
-- /masters/rates, the line-rates panel, the approver's price hints, a contact
-- card and the PO ledger. All of it is history — what was ordered, received
-- and paid — so a twice-daily copy tells the same story as the live read.
--
-- Four tables, about 15,700 rows in total. Deliberately NOT copied: indents,
-- purchase-order approval state and audit trails. Those change during the
-- working day, and Vercel's free plan only fires two scheduled jobs a day, so
-- mirroring them would mean showing someone a status six hours stale. They
-- stay live.

-- The order header. 1,451 rows.
create table if not exists public.in4_purchase_orders (
  po_id        integer primary key,
  po_no        text,
  po_dt        date,
  supplier_id  integer,
  project_id   integer,
  po_category  text,
  po_value     numeric,
  payable_amt  numeric,
  paid_amt     numeric,
  status_id    integer,
  status       text,
  grn_status   text,
  synced_at    timestamptz not null default now()
);
create index if not exists in4_purchase_orders_supplier_idx on public.in4_purchase_orders (supplier_id);

-- One row per ordered line. 5,080 rows. net_rate is the rate the rate screens
-- compare; base_po_qty the quantity they weight it by.
create table if not exists public.in4_po_items (
  item_id        integer primary key,
  po_id          integer not null,
  indent_id      integer,
  wo_id          integer,
  project_id     integer,
  subproject_id  integer,
  supplier_id    integer,
  material_id    integer,
  uom_id         integer,
  base_po_qty    numeric,
  grn_qty        numeric,
  net_rate       numeric,
  material_value numeric,
  synced_at      timestamptz not null default now()
);
create index if not exists in4_po_items_po_idx       on public.in4_po_items (po_id);
create index if not exists in4_po_items_material_idx on public.in4_po_items (material_id);
create index if not exists in4_po_items_supplier_idx on public.in4_po_items (supplier_id);

-- Goods received, with their GRN header folded in. 4,708 rows.
create table if not exists public.in4_grn_items (
  auto_id             bigint primary key,
  grn_id              integer,
  po_id               integer,
  indent_id           integer,
  material_id         integer,
  subproject_id       integer,
  supplier_id         integer,
  store_id            integer,
  uom_id              integer,
  received_qty        numeric,
  grn_material_cost   numeric,
  grn_no              text,
  grn_dt              date,
  delivery_challan_no text,
  synced_at           timestamptz not null default now()
);
create index if not exists in4_grn_items_po_idx  on public.in4_grn_items (po_id);
create index if not exists in4_grn_items_grn_idx on public.in4_grn_items (grn_id);

-- Supplier bill lines, with their certificate header folded in. 4,485 rows.
--
-- Kept separate from in4_supplier_certificates, which the Accounts lane reads:
-- that one is per certificate, this is per (certificate, GRN, material). The PO
-- ledger needs the finer grain because a bill can cover GRNs raised against a
-- DIFFERENT purchase order, and the ledger names that order — a distinction the
-- certificate-level copy cannot make.
create table if not exists public.in4_supplier_pay_lines (
  auto_id            bigint primary key,
  certificate_id     integer,
  po_id              integer,
  grn_id             integer,
  supplier_id        integer,
  subproject_id      integer,
  material_id        integer,
  certificate_no     integer,
  certificate_dt     date,
  invoice_no         text,
  invoice_dt         date,
  status_name        text,
  landed_cost        numeric,
  certified_amt      numeric,
  paid_amt           numeric,
  tax_deduction_amt  numeric,
  retention_amt      numeric,
  adv_recovery_amt   numeric,
  synced_at          timestamptz not null default now()
);
create index if not exists in4_supplier_pay_lines_po_idx  on public.in4_supplier_pay_lines (po_id);
create index if not exists in4_supplier_pay_lines_grn_idx on public.in4_supplier_pay_lines (grn_id);

do $$
declare t text;
begin
  foreach t in array array['in4_purchase_orders', 'in4_po_items', 'in4_grn_items', 'in4_supplier_pay_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)', t || '_read', t);
  end loop;
end $$;
