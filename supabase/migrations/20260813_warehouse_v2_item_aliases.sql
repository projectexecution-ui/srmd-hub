-- IN4 names a material generically ("TEPLON TAPE"); our item master names it
-- specifically ("TEPLON TAPE (YELLOW)"). Only 29 of 2,271 tracker materials
-- match exactly, so a PO's LINES can never be auto-linked reliably — but a
-- person confirming a suggestion once is quick, and remembering that choice
-- means the next PO carrying the same material links itself.
create table wh_item_aliases (
  id            uuid primary key default gen_random_uuid(),
  -- lowercased, punctuation-stripped, whitespace-collapsed source text
  alias_key     text not null unique,
  -- kept for display, so an admin can see what IN4 actually wrote
  source_text   text not null,
  item_id       uuid not null references wh_items(id) on delete cascade,
  source        text not null default 'tracker' check (source in ('tracker','manual')),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index wh_item_aliases_item_idx on wh_item_aliases (item_id);

alter table wh_item_aliases enable row level security;
create policy wh_item_aliases_read   on wh_item_aliases for select using (fn_wh_can('view'));
create policy wh_item_aliases_write  on wh_item_aliases for all    using (fn_wh_can('edit')) with check (fn_wh_can('edit'));
create policy wh_item_aliases_delete on wh_item_aliases for delete using (fn_wh_can('admin'));

-- Where a PO came from, so an imported PO is distinguishable from a typed one.
alter table wh_po add column if not exists source text not null default 'manual'
  check (source in ('manual','tracker'));
alter table wh_po add column if not exists indent_no text;
alter table wh_po_lines add column if not exists source_text text;
