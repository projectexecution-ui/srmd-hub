-- An engineer says WHAT he needs; the keeper decides WHERE it comes from.
--
-- Aksha: "from which store is he asking is not required for him to decide - the
-- store keeper will be handling that point." An engineer on site knows he needs
-- ten bags of cement; which of nine stores currently holds them is the keeper's
-- job, and asking the engineer to guess only produced requests pointed at the
-- wrong store.
--
-- NULL therefore means "any store — not decided yet". The store that actually
-- serves it is recorded where it belongs: on the Gate OUT entry, which already
-- names its from_location_id.
--
-- Applied to production 2026-08-22.
alter table wh_requests
  alter column from_location_id drop not null;

comment on column wh_requests.from_location_id is
  'The store being asked. NULL means the requester did not name one and the '
  'keeper decides at issue time - which is the normal case. The store that '
  'actually served it is on the wh_gate_out entry, never inferred from here.';
