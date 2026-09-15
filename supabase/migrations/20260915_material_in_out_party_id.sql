-- Material In & Out — the gate records WHICH supplier, not just a name.
--
-- Security typed the party as free text, so "Yogi Electricals" at the gate and
-- "YOGI ELECTRICALS" in IN4 could only ever be matched by normalising both and
-- hoping. On the example data that worked for one name in seven.
--
-- Picking from IN4's supplier list instead makes the match exact, which is what
-- lets the storekeeper's order picker lead with "the orders belonging to the
-- shop whose lorry is at the gate".
--
-- Nullable on purpose, and it always will be: a delivery from a shop that is
-- not in IN4 must still be recordable. party_name stays the record of what was
-- actually written down, whether or not an id sits beside it.

alter table public.mio_entries
  add column if not exists in4_party_id integer;

comment on column public.mio_entries.in4_party_id is
  'IN4 in4_parties.id where kind = ''supplier'', when the gate picked one from the list. Null = typed by hand, which stays allowed.';

-- Finding a supplier's deliveries, which is the only thing this column is for.
create index if not exists mio_entries_in4_party_idx
  on public.mio_entries (in4_party_id)
  where in4_party_id is not null;
