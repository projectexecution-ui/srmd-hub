-- Server-backed state for the Contractor Report module, mirroring
-- budget_hub_state: one org-wide JSON blob the whole team shares, written
-- on every upload, with a rolling history of previous versions.

create table if not exists public.contractor_report_state (
  id          text primary key default 'global',
  state       jsonb not null default '{}'::jsonb,
  version     integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.contractor_report_state_history (
  id          uuid primary key default gen_random_uuid(),
  state_id    text not null,
  state       jsonb not null,
  version     integer not null,
  snapshot_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

insert into public.contractor_report_state (id, state, version)
values ('global', '{"reports":[]}'::jsonb, 0)
on conflict (id) do nothing;

alter table public.contractor_report_state enable row level security;
alter table public.contractor_report_state_history enable row level security;

drop policy if exists crs_state_read on public.contractor_report_state;
create policy crs_state_read on public.contractor_report_state
  for select to authenticated using (auth.uid() is not null);

drop policy if exists crs_state_write on public.contractor_report_state;
create policy crs_state_write on public.contractor_report_state
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists crs_history_insert on public.contractor_report_state_history;
create policy crs_history_insert on public.contractor_report_state_history
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists crs_history_read on public.contractor_report_state_history;
create policy crs_history_read on public.contractor_report_state_history
  for select to authenticated using (auth.uid() is not null);
