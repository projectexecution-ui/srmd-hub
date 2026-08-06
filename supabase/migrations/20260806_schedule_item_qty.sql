-- Add a trackable quantity to schedule items. The setup template pre-fills the
-- item name + unit of measure, so building a project's schedule only needs the
-- quantity typed in. qty_done supports quantity-based progress later.
alter table public.sched_items
  add column if not exists qty      numeric(14,3),
  add column if not exists uom      text,
  add column if not exists qty_done numeric(14,3);
