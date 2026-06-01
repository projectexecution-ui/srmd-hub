-- ============================================================
-- Procurement tracker — server-side state (replaces localStorage)
-- ============================================================
-- Mirrors the budget_hub_state pattern. One shared org-wide JSONB
-- blob holds the latest parsed upload (projects + line statuses +
-- metadata) so any user lands on a hydrated dashboard without
-- re-uploading. History table snapshots every prior version so the
-- next upload can compute a precise NEW / UPDATED diff.

create table if not exists public.procurement_tracker_state (
  id          text primary key default 'global',
  state       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.procurement_tracker_state_history (
  id           bigserial primary key,
  state_id     text not null,
  state        jsonb not null,
  version      integer not null,
  snapshot_at  timestamptz not null default now(),
  snapshot_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_ptsh_state_id_version
  on public.procurement_tracker_state_history(state_id, version desc);

alter table public.procurement_tracker_state enable row level security;
alter table public.procurement_tracker_state_history enable row level security;

create policy "pts_select_all" on public.procurement_tracker_state
  for select to authenticated using (true);

create policy "ptsh_select_all" on public.procurement_tracker_state_history
  for select to authenticated using (true);

create policy "pts_write_writers" on public.procurement_tracker_state
  for all to authenticated using (
    exists (select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.role = 'uploader'))
  ) with check (
    exists (select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.role = 'uploader'))
  );

create policy "ptsh_insert_writers" on public.procurement_tracker_state_history
  for insert to authenticated with check (
    exists (select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.role = 'uploader'))
  );
