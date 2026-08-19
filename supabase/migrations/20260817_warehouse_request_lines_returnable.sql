-- Returnable is a per-LINE fact, and items can be added while asking.
--
-- The V1 request sheet put the Returnable tick on each ROW, and it is right: one
-- pour routinely mixes 200 bags of cement that get consumed with 40 shuttering
-- plates that must come back. A header-level flag would force the engineer to
-- raise two requests for one pour, or to lie on one of them.
alter table wh_request_lines
  add column if not exists is_returnable boolean not null default false;

-- Where an item first came from when it was not on a purchase order, so a stray
-- name in the master can be traced instead of guessed at. The Item Master's
-- merge tool is what tidies a duplicate afterwards.
alter table wh_items
  add column if not exists created_via text;

comment on column wh_items.created_via is
  'Where this item first came from when it was not on a PO: "gate", "count" or "request".';
