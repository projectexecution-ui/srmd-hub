-- Server-backed state for the Supplier Report module, mirroring
-- contractor_report_state: one org-wide JSON blob the whole team shares,
-- written on every upload, with a rolling history of previous versions.
-- Also seeds role_permissions so the module appears for the same roles as
-- the Contractor Report.

create table if not exists public.supplier_report_state (
  id          text primary key default 'global',
  state       jsonb not null default '{}'::jsonb,
  version     integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.supplier_report_state_history (
  id          uuid primary key default gen_random_uuid(),
  state_id    text not null,
  state       jsonb not null,
  version     integer not null,
  snapshot_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

insert into public.supplier_report_state (id, state, version)
values ('global', '{"reports":[]}'::jsonb, 0)
on conflict (id) do nothing;

alter table public.supplier_report_state enable row level security;
alter table public.supplier_report_state_history enable row level security;

drop policy if exists srs_state_read on public.supplier_report_state;
create policy srs_state_read on public.supplier_report_state
  for select to authenticated using (auth.uid() is not null);

drop policy if exists srs_state_write on public.supplier_report_state;
create policy srs_state_write on public.supplier_report_state
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists srs_history_insert on public.supplier_report_state_history;
create policy srs_history_insert on public.supplier_report_state_history
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists srs_history_read on public.supplier_report_state_history;
create policy srs_history_read on public.supplier_report_state_history
  for select to authenticated using (auth.uid() is not null);

-- Seed role_permissions to match contractor-report exactly so the new tile
-- shows for the same roles. Missing rows read as "off"; admins can tune from
-- /admin/permissions afterwards.
insert into public.role_permissions (module_slug, role, can_view, can_edit, can_admin)
values
  ('supplier-report', 'admin',         true,  true,  true),
  ('supplier-report', 'uploader',      true,  true,  false),
  ('supplier-report', 'viewer',        true,  false, false),
  ('supplier-report', 'founder',       true,  true,  false),
  ('supplier-report', 'head',          true,  true,  false),
  ('supplier-report', 'engineer',      false, false, false),
  ('supplier-report', 'site_staff',    false, false, false),
  ('supplier-report', 'contractor',    false, false, false),
  ('supplier-report', 'backoffice',    true,  true,  false),
  ('supplier-report', 'store_manager', true,  false, false)
on conflict (module_slug, role) do nothing;
