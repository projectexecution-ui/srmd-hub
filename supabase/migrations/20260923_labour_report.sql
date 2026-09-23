-- Labour Report — the daily manpower count per agency, per project.
--
-- Aksha, 23 Sep 2026: a module in place of the Excel "DAILY LABOUR REPORT" and
-- the small "SRAH DAILY MANPOWER" web form. Vatsal (site engineer, SRAH) types
-- the day's count per agency; the month sheet, graph and WhatsApp card read it.
--
-- Two tables and nothing else. An agency may carry sub-heads (Lalit Kumawat:
-- Mason · Labour · Brick Work Mason · Epoxy Grouting); an entry is one number
-- for one (day, agency, sub-head). sub_head is '' for an agency without them,
-- so the primary key holds.
--
-- Access = the permission matrix, module slug 'labour-report': view reads,
-- edit writes. Admin switches the module on/off at Admin › Hub › Modules like
-- any other; no row in module_visibility means on.
--
-- Seeded with SRAH's September so the sheet is full on day one. The numbers
-- were typed from Aksha's screenshots; two day totals differ by one from the
-- Excel (19 Sep 79 vs 78, 21 Sep 117 vs 118) — a tap on the cell fixes either.

create table if not exists public.labour_agencies (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  sub_heads   text[] not null default '{}',
  sort_order  integer not null default 0,
  hidden      boolean not null default false,        -- left site: off the entry screen, history stays
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);
comment on table public.labour_agencies is 'Labour Report: the agencies (contractors) whose people are counted each day on a project.';

create table if not exists public.labour_entries (
  project_id  uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  agency_id   uuid not null references public.labour_agencies(id) on delete cascade,
  sub_head    text not null default '',
  count       integer not null check (count >= 0),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, report_date, agency_id, sub_head)
);
comment on table public.labour_entries is 'Labour Report: heads on site for one agency (and sub-head) on one day. One row per cell of the month sheet.';
create index if not exists labour_entries_project_date on public.labour_entries (project_id, report_date desc);

-- ── Access ──────────────────────────────────────────────────────────────────
create or replace function public.labour_can(p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_action when 'edit' then p.can_edit when 'admin' then p.can_admin else p.can_view end
      from public.my_permissions() p where p.module_slug = 'labour-report' limit 1), false);
$$;

alter table public.labour_agencies enable row level security;
alter table public.labour_entries  enable row level security;

drop policy if exists labour_agencies_select on public.labour_agencies;
create policy labour_agencies_select on public.labour_agencies for select to authenticated using (public.labour_can('view'));
drop policy if exists labour_agencies_write on public.labour_agencies;
create policy labour_agencies_write on public.labour_agencies for all to authenticated
  using (public.labour_can('edit')) with check (public.labour_can('edit'));

drop policy if exists labour_entries_select on public.labour_entries;
create policy labour_entries_select on public.labour_entries for select to authenticated using (public.labour_can('view'));
drop policy if exists labour_entries_write on public.labour_entries;
create policy labour_entries_write on public.labour_entries for all to authenticated
  using (public.labour_can('edit')) with check (public.labour_can('edit'));

-- Who has it (defaults only; the matrix on Admin › Permissions overrides):
-- admin everything, site engineer types, Atm Head and Trustee read.
insert into public.role_permissions (module_slug, role, can_view, can_edit, can_admin) values
  ('labour-report', 'admin',    true, true,  true),
  ('labour-report', 'engineer', true, true,  false),
  ('labour-report', 'head',     true, false, false),
  ('labour-report', 'founder',  true, false, false)
on conflict do nothing;

-- Vatsal (Bhoya Vatsal, vatsal.srmd@gmail.com) is a viewer in the hub today.
-- Aksha: "vatsal is site engineer profile" — for THIS module he acts as one,
-- without widening what viewer means elsewhere. Admin › Users can make him a
-- site engineer outright whenever Aksha wants that.
insert into public.user_module_roles (user_id, module_slug, role, notes)
select p.id, 'labour-report', 'engineer', 'Aksha, 23 Sep 2026: Vatsal keeps the SRAH labour report'
  from public.profiles p where p.email = 'vatsal.srmd@gmail.com'
on conflict do nothing;

-- ── SRAH agencies, in sheet order ───────────────────────────────────────────
insert into public.labour_agencies (id, project_id, name, sub_heads, sort_order) values
  ('a11ab0e0-2026-4923-8000-000000000001', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Electrical (Croney)', '{}'::text[], 10),
  ('a11ab0e0-2026-4923-8000-000000000002', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Plumbing', '{}'::text[], 20),
  ('a11ab0e0-2026-4923-8000-000000000003', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Waterproofing', '{}'::text[], 30),
  ('a11ab0e0-2026-4923-8000-000000000004', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'HVAC', '{}'::text[], 40),
  ('a11ab0e0-2026-4923-8000-000000000005', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Wall Punning', '{}'::text[], 50),
  ('a11ab0e0-2026-4923-8000-000000000006', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'False Ceiling', '{}'::text[], 60),
  ('a11ab0e0-2026-4923-8000-000000000007', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Siddharth Aluminium', '{}'::text[], 70),
  ('a11ab0e0-2026-4923-8000-000000000008', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Fire', '{}'::text[], 80),
  ('a11ab0e0-2026-4923-8000-000000000009', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'MGPS', '{}'::text[], 90),
  ('a11ab0e0-2026-4923-8000-000000000010', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Paint', '{}'::text[], 100),
  ('a11ab0e0-2026-4923-8000-000000000011', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'FAPA', '{}'::text[], 110),
  ('a11ab0e0-2026-4923-8000-000000000012', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Door Fixing', '{}'::text[], 120),
  ('a11ab0e0-2026-4923-8000-000000000013', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Agron', '{}'::text[], 130),
  ('a11ab0e0-2026-4923-8000-000000000014', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'DCPL (RCC Work)', '{}'::text[], 140),
  ('a11ab0e0-2026-4923-8000-000000000015', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Kamdar', '{}'::text[], 150),
  ('a11ab0e0-2026-4923-8000-000000000016', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'BHP Panel', '{}'::text[], 160),
  ('a11ab0e0-2026-4923-8000-000000000017', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Railing Work', '{}'::text[], 170),
  ('a11ab0e0-2026-4923-8000-000000000018', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'V-Care', '{}'::text[], 180),
  ('a11ab0e0-2026-4923-8000-000000000019', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Hardik Bhai (Courtyard Work)', array['Mason', 'Labour']::text[], 190),
  ('a11ab0e0-2026-4923-8000-000000000020', '768e48c0-6a01-4c95-b406-1ccc8c82a93b', 'Lalit Kumawat', array['Mason', 'Labour', 'Brick Work Mason', 'Epoxy Grouting']::text[], 200)
on conflict do nothing;

-- ── SRAH September 2026, as typed from the screenshots ──────────────────────
-- One line per sheet row: the 19 dated columns of the Excel (01–22 Sep, no
-- Sundays or 14 Sep) as an array — null where the sheet shows "-" (agency not
-- yet on site) — then the 23 Sep figure from the manpower form.
with s(n, head, vals, today) as (values
  (1, '', array[3,4,4,4,4,4,4,4,4,4,2,2,2,0,4,6,6,14,14]::int[], 14),
  (2, '', array[0,3,0,0,0,0,0,0,0,0,5,5,5,0,4,3,6,6,10]::int[], 9),
  (3, '', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::int[], 2),
  (4, '', array[21,21,18,20,20,23,22,18,18,18,18,15,14,14,0,14,0,9,7]::int[], 15),
  (5, '', array[2,2,2,2,2,2,0,0,0,0,0,0,0,0,3,3,3,3,5]::int[], 4),
  (6, '', array[0,0,0,0,0,2,3,4,3,2,3,2,3,4,6,9,9,12,15]::int[], 12),
  (7, '', array[4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,3]::int[], 2),
  (8, '', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::int[], 2),
  (9, '', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2]::int[], 2),
  (10, '', array[2,2,0,0,0,0,0,3,3,3,2,3,3,3,3,5,5,9,14]::int[], 12),
  (11, '', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::int[], 5),
  (12, '', array[0,0,4,2,2,2,0,4,3,4,0,2,2,2,7,6,4,7,8]::int[], 9),
  (13, '', array[null,null,null,null,2,2,0,0,0,0,0,0,0,0,0,0,2,1,3]::int[], 4),
  (14, '', array[null,null,null,null,null,null,null,null,null,null,null,3,1,0,0,3,0,0,4]::int[], 3),
  (15, '', array[null,null,null,null,null,null,null,null,null,null,null,null,null,null,3,4,5,5,5]::int[], 7),
  (16, '', array[null,null,null,null,null,null,null,null,null,null,null,null,null,null,5,5,0,0,0]::int[], 0),
  (17, '', array[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,3]::int[], 2),
  (18, '', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,12,23,32]::int[], 37),
  (19, 'Mason', array[2,2,2,2,2,0,0,0,0,0,0,2,2,0,2,0,0,2,2]::int[], 2),
  (19, 'Labour', array[4,4,4,2,0,0,0,0,0,0,0,0,0,0,1,0,0,2,2]::int[], 2),
  (20, 'Mason', array[3,3,2,3,2,2,2,2,2,2,3,3,2,3,0,5,4,6,7]::int[], 7),
  (20, 'Labour', array[5,4,3,4,4,3,2,4,3,5,5,4,6,4,6,5,0,2,17]::int[], 15),
  (20, 'Brick Work Mason', array[null,null,null,null,null,null,null,null,null,null,null,null,1,1,1,2,0,12,4]::int[], 6),
  (20, 'Epoxy Grouting', array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,6,2,3]::int[], 0)
), d(i, dt) as (
  select t.i, t.dt from unnest(array['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22']::date[]) with ordinality as t(dt, i)
), rows as (
  select d.dt as report_date, s.n, s.head, s.vals[d.i] as count from s cross join d where s.vals[d.i] is not null
  union all
  select date '2026-09-23', s.n, s.head, s.today from s
)
insert into public.labour_entries (project_id, report_date, agency_id, sub_head, count, updated_at)
select '768e48c0-6a01-4c95-b406-1ccc8c82a93b', r.report_date, ('a11ab0e0-2026-4923-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid, r.head, r.count,
       (r.report_date::timestamp + time '18:00') at time zone 'Asia/Kolkata'
  from rows r
on conflict do nothing;
