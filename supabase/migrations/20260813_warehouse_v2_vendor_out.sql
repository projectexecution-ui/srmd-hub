-- ===========================================================================
-- WAREHOUSE V2 — material going back OUT to a vendor.
--
-- Gate IN already records whose material arrived (wh_gate_in.owner = srm |
-- vendor + party): a contractor's shuttering plates and scaffolding come in
-- under his own name and are never SRM stock. But Gate OUT only knew two
-- destinations, site and store, so there was no way to record the same
-- material leaving again.
--
-- That makes two of the HOD's registers unanswerable — "Vendor OUT: what went
-- back, matched to its IN" and the vendor material balance (brought vs taken
-- back, which is what warns when he takes out more than he brought). A
-- register you cannot post to is worse than no register, so OUT gains a third
-- destination rather than the report being shipped empty.
-- ===========================================================================

alter table wh_gate_out add column if not exists party text;
comment on column wh_gate_out.party is
  'Who the material went back to, for dest_type = vendor. Matched by name against wh_gate_in.party.';

alter table wh_gate_out drop constraint if exists wh_gate_out_dest_type_check;
alter table wh_gate_out add constraint wh_gate_out_dest_type_check
  check (dest_type in ('site','store','vendor'));

-- The shape check does the real work: the three destinations stay mutually
-- exclusive, so a row cannot quietly be two things at once.
alter table wh_gate_out drop constraint if exists wh_gate_out_shape;
alter table wh_gate_out add constraint wh_gate_out_shape check (
  -- consumed at a site: charges a project, no destination store, no party
  (dest_type = 'site'
     and project_id     is not null
     and to_location_id is null
     and party          is null)
  or
  -- only relocated: charges NOTHING, and cannot name a project or an engineer
  (dest_type = 'store'
     and to_location_id is not null
     and to_location_id <> from_location_id
     and project_id     is null
     and engineer_id    is null
     and is_returnable  is false
     and party          is null)
  or
  -- back to the vendor: his own material leaving. A project may be named
  -- (it is useful on the balance report) but nothing is charged, nobody
  -- receives it on our side, and it is not "returnable" — this IS the return.
  (dest_type = 'vendor'
     and party          is not null
     and to_location_id is null
     and engineer_id    is null
     and is_returnable  is false)
);

create index if not exists wh_gout_party_idx
  on wh_gate_out (party, entry_date desc) where party is not null;

-- A vendor taking his own material back must not read as site consumption:
-- "SRM OUT — issued to sites" would otherwise include material that was never
-- ours and was never consumed. 'return' is reserved for returnable material
-- coming BACK into a store (wh_gate_out_lines.returned_qty), so this is its
-- own kind.
alter type wh_movement_kind add value if not exists 'vendor_out';
