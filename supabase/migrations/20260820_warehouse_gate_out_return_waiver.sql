-- Releasing a return on material that has ALREADY gone out.
--
-- The obligation to bring something back lives on the OUT entry, not on the
-- request: the request is an intent, the gate entry is the material physically
-- leaving. The Returnables outstanding report counts gate entries, so a waiver
-- that only touched the request line would leave it on the report for ever.
--
-- is_returnable is deliberately NOT flipped to false. It WAS issued on a
-- returnable footing and the register must keep saying so; the waiver is a
-- second, later, attributed fact recorded beside it.
--
-- Applied to production 2026-08-20.
alter table wh_gate_out
  add column if not exists return_waived_at   timestamptz,
  add column if not exists return_waived_by   uuid references profiles(id),
  add column if not exists return_waived_note text;

comment on column wh_gate_out.return_waived_at is
  'When the Atm Head decided this material need not come back. NULL means it is '
  'still expected, and still counted by the Returnables outstanding report. '
  'is_returnable stays true either way - the entry was issued as returnable and '
  'the register must not rewrite that.';

alter table wh_gate_out
  drop constraint if exists wh_gate_out_waiver_sane;
alter table wh_gate_out
  add constraint wh_gate_out_waiver_sane check (
    return_waived_at is null
    or (is_returnable and return_waived_by is not null)
  );

create index if not exists wh_gate_out_returnable_open_idx
  on wh_gate_out (request_id)
  where is_returnable and return_waived_at is null and deleted_at is null;
