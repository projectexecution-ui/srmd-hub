-- ===========================================================================
-- WAREHOUSE V2 — IN4 is the base for what an item IS on a PO.
--
-- S2 tried to MAP IN4's material names onto our own 514-item master, and since
-- only 1.3% matched exactly it asked a human to confirm each line against a
-- ranked guess. Aksha's call: don't guess. Follow IN4's item as the base. If
-- what actually turns up at the gate is not what IN4 says, the storekeeper or
-- the guard changes it on arrival and it is FLAGGED as differing from IN4 and
-- the bill, so procurement and billing can reconcile it afterwards.
--
-- So an IN4 material name is not something to be matched — it becomes an item
-- in its own right, carrying IN4's own name and UOM.
-- ===========================================================================

-- Where this item came from. IN4-sourced items keep the exact text IN4 sent, so
-- the same name always resolves to the same item without any interpretation.
alter table wh_items add column if not exists source text not null default 'manual'
  check (source in ('manual','in4'));
alter table wh_items add column if not exists in4_name text;
alter table wh_items add column if not exists in4_uom  text;

comment on column wh_items.in4_name is
  'The material name exactly as IN4 sent it. Normalised into wh_items_in4_key_idx so one IN4 name is one item.';

-- One IN4 name is one item, permanently. Normalised exactly the way in4Key() in
-- lib/warehouse/in4-items.ts does it — lowercase, punctuation to single spaces,
-- trimmed — so "TMT Bars  8MM", "TMT BARS 8MM" and " tmt-bars 8mm " cannot
-- become three items. The btrim matters: without it the index would be laxer
-- than the app and allow rows the app thinks are the same item.
create unique index if not exists wh_items_in4_key_idx
  on wh_items (lower(btrim(regexp_replace(in4_name, '[^a-zA-Z0-9]+', ' ', 'g'))))
  where in4_name is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- What arrived is not always what was ordered. The gate records BOTH: po_line_id
-- still points at the line IN4 raised (so the PO balance stays honest — the
-- truck did come against that order), while item_id is what actually came off
-- it. When they disagree the line says so, with a note, and that is what the
-- exception report and the bill check read.
-- ---------------------------------------------------------------------------
alter table wh_gate_in_lines add column if not exists differs_from_po boolean not null default false;
alter table wh_gate_in_lines add column if not exists differ_note text;

-- A flagged difference with no explanation is just noise on a report.
alter table wh_gate_in_lines drop constraint if exists wh_gin_lines_differ_note;
alter table wh_gate_in_lines add constraint wh_gin_lines_differ_note
  check (differs_from_po is false or differ_note is not null);

create index if not exists wh_ginl_differs_idx
  on wh_gate_in_lines (differs_from_po) where differs_from_po;

-- ---------------------------------------------------------------------------
-- wh_item_aliases existed only to remember which item a human had decided an
-- IN4 name mapped to. There is no mapping any more — the IN4 name IS the item,
-- indexed above — so the table is dead. It has never held a row.
-- ---------------------------------------------------------------------------
drop table if exists wh_item_aliases;
