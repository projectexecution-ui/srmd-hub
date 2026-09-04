-- IN4 live sync, Phase 1 (budget). Mirror tables for the parts of IN4 the hub
-- reads, the report lines rebuilt from them, and the link that says which IN4
-- sub-project is which Budget-Hub project. Applied to the live database on
-- 4 Sept 2026; every statement is idempotent for the merge-time Action.
--
-- Read access mirrors budget_hub_state (any signed-in user): these are the
-- same figures the Budget pages already show. Writes are service-role only —
-- the sync route is the single writer.

create table if not exists public.in4_sync_runs (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  trigger       text not null,                -- 'cron' | 'manual'
  mode          text not null,                -- 'shadow' | 'live'
  ok            boolean,
  error         text,
  rows_read     integer,
  subprojects   integer,
  linked        integer,
  compared      jsonb,                        -- ComparisonSummary
  wrote_budget_hub boolean not null default false,
  actor_id      uuid
);

create table if not exists public.in4_projects (
  id                 integer primary key,
  name               text not null,
  ex_code            text,
  parent_project_id  integer,
  cert_company_id    integer,
  status             integer,
  budget_amt         numeric,
  synced_at          timestamptz not null default now()
);

create table if not exists public.in4_subprojects (
  id                    integer primary key,
  project_id            integer not null,
  name                  text not null,
  ex_code               text,
  is_active             boolean not null default true,
  status                integer,
  construction_area_ft  numeric,
  budget                numeric,
  parent_subproject_id  integer,
  is_common_service     boolean not null default false,
  synced_at             timestamptz not null default now()
);

create table if not exists public.in4_skills (
  id          integer primary key,
  name        text not null,
  code        text,                          -- the numeric prefix ("03", "317")
  parent_id   integer not null default 0,
  short_name  text,
  is_active   boolean not null default true,
  synced_at   timestamptz not null default now()
);

create table if not exists public.in4_work_orders (
  wo_id                    integer primary key,
  subproject_id            integer not null,
  category_id              integer,
  subcategory_id           integer,
  status                   integer,
  display_no               text,
  contractor_id            integer,
  wo_value                 numeric,
  wo_gross_value           numeric,
  wo_paid_amt              numeric,
  wo_advance_balance_amt   numeric,
  synced_at                timestamptz not null default now()
);
create index if not exists in4_work_orders_subproject_idx on public.in4_work_orders (subproject_id);

create table if not exists public.in4_wo_certificates (
  certificate_id        integer primary key,
  wo_id                 integer not null,
  subproject_id         integer not null,
  category_id           integer,
  subcategory_id        integer,
  status                integer,
  gross_bill_amt        numeric,
  certified_amt         numeric,
  paid_amt              numeric,
  advance_recovery_amt  numeric,
  synced_at             timestamptz not null default now()
);
create index if not exists in4_wo_certificates_subproject_idx on public.in4_wo_certificates (subproject_id);

-- The rebuilt report, one row per (sub-project, category, sub-skill); the
-- category's own totals carry sub_code = ''.
create table if not exists public.in4_report_lines (
  subproject_id  integer not null,
  cat_code       text not null,
  sub_code       text not null default '',
  head           text not null,
  budget         numeric not null default 0,
  wo_approved    numeric not null default 0,
  actual         numeric not null default 0,
  synced_at      timestamptz not null default now(),
  primary key (subproject_id, cat_code, sub_code)
);

-- Which IN4 sub-project is which Budget-Hub project (budget_hub_state ids) and,
-- through cc_bph_project_links, which Cost Control project. Seeded from the
-- file names of the uploads (38 of 40 match an IN4 name exactly); the rest are
-- confirmed by hand on /budget/in4.
create table if not exists public.in4_subproject_links (
  subproject_id   integer primary key,
  bph_project_id  text not null unique,
  source          text not null default 'filename',   -- 'filename' | 'manual'
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  note            text,
  created_at      timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['in4_sync_runs','in4_projects','in4_subprojects','in4_skills','in4_work_orders','in4_wo_certificates','in4_report_lines','in4_subproject_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)', t || '_read', t);
  end loop;
end $$;

-- Admins may confirm a link from the mapping screen; everything else is written
-- by the service role.
drop policy if exists in4_subproject_links_admin_write on public.in4_subproject_links;
create policy in4_subproject_links_admin_write on public.in4_subproject_links
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)));

-- The switch. 'false' = shadow mode: sync, compare, report, but the Excel
-- upload stays the source. 'true' = the sync writes budget_hub_state itself.
insert into public.app_settings (key, value)
values ('in4_budget_live', 'false')
on conflict (key) do nothing;
