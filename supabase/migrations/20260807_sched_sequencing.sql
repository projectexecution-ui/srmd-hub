-- Plain-language sequencing: each item can follow another item ("after X"),
-- with a gap (curing/deshuttering days) and a per-floor cycle time. Everything
-- else (per-floor windows, readiness, finish dates) is derived, never typed.
alter table public.sched_items
  add column if not exists follows_item_id uuid references public.sched_items(id) on delete set null,
  add column if not exists gap_days   int not null default 0,
  add column if not exists cycle_days int;
create index if not exists sched_items_follows on public.sched_items (follows_item_id);
