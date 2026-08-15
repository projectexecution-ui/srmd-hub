-- Budget vs Actual V2 — manual overrides + weekly snapshots.
--
-- (1) Hand-added projects can now carry real numbers (e.g. Raj Uphaar, which
--     isn't in the IN4 upload) — budget/approved/paid on budget_v2_extra_project.
-- (2) budget_v2_override — a FLAGGED correction to a project that DID come from
--     the IN4 upload. Only the columns set are overridden; the uploaded value is
--     kept in the tree underneath and the cell is badged "manually adjusted".
-- (3) budget_v2_weekly_snapshot — one row per week, storing each project's
--     budget/approved/paid so the weekly report can show the change vs last week.
--
-- All V2-owned + additive. Admin-write, authenticated-read — same policy shape as
-- budget_v2_project_area / budget_v2_extra_project.

-- (1) Numbers on hand-added projects ------------------------------------------
alter table public.budget_v2_extra_project add column if not exists budget   numeric;
alter table public.budget_v2_extra_project add column if not exists approved numeric;
alter table public.budget_v2_extra_project add column if not exists paid     numeric;

-- (2) Flagged overrides for uploaded projects ---------------------------------
create table if not exists public.budget_v2_override (
  project_name text primary key,
  budget       numeric,   -- null = don't override this figure
  approved     numeric,
  paid         numeric,
  note         text,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table public.budget_v2_override enable row level security;
drop policy if exists bv2_override_read on public.budget_v2_override;
create policy bv2_override_read on public.budget_v2_override for select to authenticated using (true);
drop policy if exists bv2_override_write on public.budget_v2_override;
create policy bv2_override_write on public.budget_v2_override for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));

-- (3) Weekly snapshots for week-over-week deltas ------------------------------
-- totals shape: { overall: {budget,approved,paid}, projects: { "<name>": {budget,approved,paid} } }
create table if not exists public.budget_v2_weekly_snapshot (
  week_ending  date primary key,
  captured_at  timestamptz not null default now(),
  captured_by  uuid,
  totals       jsonb not null
);
alter table public.budget_v2_weekly_snapshot enable row level security;
drop policy if exists bv2_snap_read on public.budget_v2_weekly_snapshot;
create policy bv2_snap_read on public.budget_v2_weekly_snapshot for select to authenticated using (true);
drop policy if exists bv2_snap_write on public.budget_v2_weekly_snapshot;
create policy bv2_snap_write on public.budget_v2_weekly_snapshot for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));
