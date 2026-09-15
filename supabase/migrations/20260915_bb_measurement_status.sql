-- Bills Approval: mirror IN4's approval state for an abstract and a GRN.
--
-- Aksha, 15 Sep 2026: "once abstract and GRN is approved in in4 should go
-- ahead." The Site Head measures once, in IN4; when IN4 approves that
-- measurement the bill moves itself to CT Disc Head. Nobody clicks Forward.
--
-- Neither signal was mirrored, so CT Hub could see THAT an abstract existed but
-- not whether it had been approved. Both exist in IN4 and both are clean:
--
--   abstract  dbo.ENGG_BOQ_ABSTRACT_STATUS (ABSTRACT_ID, STATUS) — exactly one
--             row per abstract, so it is the current state, not a history.
--             Approved 2,801 · Cancelled 60 · Draft 18 · "No Items" 14 ·
--             Verify 12 · Submitted 1
--
--   GRN       BI.DIM_PURCHASE_GRN_HEADER.STATUS — already joined by the sync
--             for its number and date; the status was simply not carried.
--             Approved 1,572 · Submitted 3
--
-- Nullable and free-text, deliberately: IN4 owns these words and adding a CHECK
-- here would turn a new IN4 status into a failed sync instead of a value CT Hub
-- can show and decline to act on.

alter table public.in4_wo_abstract_items
  add column if not exists status text;

comment on column public.in4_wo_abstract_items.status is
  'IN4 ENGG_BOQ_ABSTRACT_STATUS.STATUS for this abstract. Only ''Approved'' moves a bill on.';

alter table public.in4_grn_items
  add column if not exists status text;

comment on column public.in4_grn_items.status is
  'IN4 DIM_PURCHASE_GRN_HEADER.STATUS for this receipt. Only ''Approved'' moves a bill on.';

-- The sweep asks "is there an approved measurement for this order and bill
-- number", which is a filtered lookup on both.
create index if not exists in4_wo_abstract_items_status_idx
  on public.in4_wo_abstract_items (wo_id, status);

create index if not exists in4_grn_items_status_idx
  on public.in4_grn_items (po_id, status);
