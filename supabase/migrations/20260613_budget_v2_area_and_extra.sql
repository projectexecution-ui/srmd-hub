-- V2 area override + extra (placeholder) projects. Admin-write RLS;
-- everyone-read. Read-only over Budget/Contractor/Supplier modules — these
-- tables are V2-owned and additive.

create table if not exists public.budget_v2_project_area (
  project_name text primary key,
  area_sft     numeric not null check (area_sft > 0),
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table public.budget_v2_project_area enable row level security;
drop policy if exists bv2_area_read on public.budget_v2_project_area;
create policy bv2_area_read on public.budget_v2_project_area for select to authenticated using (true);
drop policy if exists bv2_area_write on public.budget_v2_project_area;
create policy bv2_area_write on public.budget_v2_project_area for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));

create table if not exists public.budget_v2_extra_project (
  name        text primary key,
  group_name  text,
  area_sft    numeric check (area_sft is null or area_sft > 0),
  notes       text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
alter table public.budget_v2_extra_project enable row level security;
drop policy if exists bv2_extra_read on public.budget_v2_extra_project;
create policy bv2_extra_read on public.budget_v2_extra_project for select to authenticated using (true);
drop policy if exists bv2_extra_write on public.budget_v2_extra_project;
create policy bv2_extra_write on public.budget_v2_extra_project for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));
