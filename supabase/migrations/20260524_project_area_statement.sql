-- ============================================================
-- Projects — Area Statement template
-- ============================================================
-- Brings the Hub project setup in line with the Budget vs Actual
-- (budget-hub.html) area statement: plot/built-up/carpet/super
-- areas, FSI permitted vs consumed, and a per-floor breakdown.
-- ============================================================

-- 1. Project-level area + meta columns (all nullable — not every project is a building)
alter table public.projects
  add column if not exists location           text,
  add column if not exists plot_area_sft      numeric,
  add column if not exists carpet_sft         numeric,
  add column if not exists super_built_up_sft numeric,
  add column if not exists fsi_permitted      numeric,
  add column if not exists fsi_consumed       numeric,
  add column if not exists project_type       text default 'individual';

-- Optional sanity: project_type ∈ {individual, group}
do $$ begin
  alter table public.projects
    add constraint projects_project_type_chk
    check (project_type in ('individual','group'));
exception when duplicate_object then null;
end $$;

-- 2. Floor breakdown — child rows under a project
create table if not exists public.project_floors (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  sequence      integer not null default 0,
  name          text not null,
  built_up_sft  numeric,
  carpet_sft    numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists project_floors_project_id_idx
  on public.project_floors(project_id, sequence);

-- Touch trigger
create or replace function public.project_floors_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_project_floors_touch on public.project_floors;
create trigger trg_project_floors_touch
  before update on public.project_floors
  for each row execute function public.project_floors_touch();

-- 3. RLS — read for all authenticated; write requires projects.edit perm
alter table public.project_floors enable row level security;

drop policy if exists "project_floors_select_all"   on public.project_floors;
create policy "project_floors_select_all"
  on public.project_floors for select to authenticated using (true);

drop policy if exists "project_floors_write_editor" on public.project_floors;
create policy "project_floors_write_editor"
  on public.project_floors for all to authenticated
  using (
    exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid()
        and rp.role = p.role
        and rp.module_slug = 'projects'
        and rp.can_edit = true
    )
  )
  with check (
    exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid()
        and rp.role = p.role
        and rp.module_slug = 'projects'
        and rp.can_edit = true
    )
  );
