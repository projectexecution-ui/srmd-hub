-- Purchase orders: remember what IN4 had ALREADY received before this system.
--
-- The problem this fixes. IN4 has been running for years. Of the 1,316 POs in
-- the Indent → PO tracker, 1,122 were fully delivered before Warehouse V2
-- existed, and 1,373,374 of the 1,415,280 ordered units had already arrived.
-- The PO import brought `ordered_qty` across and discarded IN4's received
-- quantity, so getPoBalance() computed
--
--     pending = ordered_qty − (receipts recorded at OUR gate)
--
-- and our gate had recorded nothing. Every one of the 4,067 imported lines
-- therefore presented its FULL ordered quantity as still to come. A keeper
-- working down that list would have booked in over a million units of material
-- that arrived months ago and was largely consumed — double-counting it against
-- the 472-line, 78,375-unit opening balance imported from V1, which is the
-- actual physical truth.
--
-- So the line keeps IN4's figure separately, and pending nets both off.

alter table wh_po_lines
  add column if not exists received_before_qty numeric not null default 0;

alter table wh_po_lines
  drop constraint if exists wh_po_lines_received_before_qty_check;
alter table wh_po_lines
  add constraint wh_po_lines_received_before_qty_check
  check (received_before_qty >= 0);

comment on column wh_po_lines.received_before_qty is
  'What IN4 had already received against this line at the moment the PO was '
  'imported into Warehouse V2. A FROZEN SNAPSHOT: it must never be refreshed '
  'from a later weekly IN4 upload. Once a PO is in this system, further '
  'deliveries are recorded at the gate (wh_gate_in_lines), and re-reading IN4 '
  'would subtract the same delivery twice. pending = ordered_qty − '
  'received_before_qty − gate receipts, floored at zero.';

comment on column wh_po_lines.ordered_qty is
  'What the purchase order said, per IN4. Never reduced by receipts — the '
  'balance is derived, see received_before_qty.';
