-- ============================================================
-- Project Schedule + Work-Order + Drawings tracker — foundation
-- ============================================================
-- Per-project schedule. Work items grouped by trade; each carries a plan
-- window, a work-back WO deadline (computed in app), an engineer-confirmed
-- progress %, WO issued-or-not, and a floor-by-floor progress matrix.
-- Drawings register (with revisions) links to items. Date moves are logged
-- with a reason (NOT approval-gated). Additive + non-breaking; reuses hub
-- infra (profiles/projects/project_floors/cc_disciplines/cc_sub_skills/
-- role_permissions/app_settings) and helpers current_user_role() +
-- set_updated_at(). No shared table is altered.
--
-- Access model: broad authenticated SELECT (defense-in-depth; the page is
-- gated by requirePermission('schedule',...) + module_visibility). Writes are
-- role-gated: management+engineer for progress/updates, management-only for
-- structural item create/delete.
-- ============================================================

create extension if not exists "uuid-ossp";

-- 1. sched_items — one row per scheduled work item
create table if not exists public.sched_items (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  trade             text not null,
  name              text not null,
  sub               text,
  cc_discipline_id  uuid references public.cc_disciplines(id) on delete set null,
  cc_sub_skill_id   uuid references public.cc_sub_skills(id) on delete set null,
  seq               int not null default 0,
  plan_start        date,
  plan_end          date,
  baseline_start    date,
  baseline_end      date,
  locked_at         timestamptz,
  state             text not null default 'planned'
                      check (state in ('planned','in_progress','done','on_hold')),
  pct               int not null default 0 check (pct between 0 and 100),
  wo_issued         boolean not null default false,
  wo_number         text,
  wo_issued_on      date,
  owner_user_id     uuid references public.profiles(id) on delete set null,
  notes             text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists sched_items_project_idx on public.sched_items(project_id, seq);
create index if not exists sched_items_owner_idx   on public.sched_items(owner_user_id);

-- 2. sched_progress — item × location (floor-by-floor matrix)
create table if not exists public.sched_progress (
  id          uuid primary key default uuid_generate_v4(),
  item_id     uuid not null references public.sched_items(id) on delete cascade,
  location    text not null,
  floor_id    uuid references public.project_floors(id) on delete set null,
  status      text not null default 'not_started'
                check (status in ('not_started','wip','done','na')),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create unique index if not exists sched_progress_item_loc_uq on public.sched_progress(item_id, lower(location));
create index if not exists sched_progress_item_idx on public.sched_progress(item_id);

-- 3. sched_drawings — drawing register
create table if not exists public.sched_drawings (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  item_id      uuid references public.sched_items(id) on delete set null,
  number       text,
  title        text not null,
  discipline   text,
  status       text not null default 'requested'
                 check (status in ('requested','wip','received','in_review','gfc','superseded')),
  current_rev  text,
  consultant   text,
  target_date  date,
  received_on  date,
  gfc_on       date,
  blocking     boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sched_drawings_project_idx on public.sched_drawings(project_id);
create index if not exists sched_drawings_item_idx    on public.sched_drawings(item_id);

-- 4. sched_drawing_revisions
create table if not exists public.sched_drawing_revisions (
  id          uuid primary key default uuid_generate_v4(),
  drawing_id  uuid not null references public.sched_drawings(id) on delete cascade,
  rev         text not null,
  status      text,
  issued_on   date,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sched_drawing_rev_idx on public.sched_drawing_revisions(drawing_id);

-- 5. sched_date_changes — reason log for date moves (NOT approval-gated)
create table if not exists public.sched_date_changes (
  id          uuid primary key default uuid_generate_v4(),
  item_id     uuid not null references public.sched_items(id) on delete cascade,
  field       text not null check (field in ('plan_start','plan_end')),
  from_date   date,
  to_date     date,
  reason      text,
  changed_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sched_date_changes_item_idx on public.sched_date_changes(item_id, created_at desc);

-- 6. updated_at triggers + freeze immutable cols
do $$ begin
  create trigger sched_items_set_updated_at before update on public.sched_items
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger sched_drawings_set_updated_at before update on public.sched_drawings
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

create or replace function public.sched_items_freeze()
returns trigger language plpgsql set search_path = public as $$
begin
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  return new;
end $$;
drop trigger if exists sched_items_freeze_trg on public.sched_items;
create trigger sched_items_freeze_trg before update on public.sched_items
  for each row execute function public.sched_items_freeze();

-- 7. Helper functions
create or replace function public.sched_is_management()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('admin','project_head','head','founder');
$$;

create or replace function public.sched_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('admin','project_head','head','engineer');
$$;

create or replace function public.sched_can_build()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('admin','project_head','head');
$$;

-- 8. RLS
alter table public.sched_items             enable row level security;
alter table public.sched_progress          enable row level security;
alter table public.sched_drawings          enable row level security;
alter table public.sched_drawing_revisions enable row level security;
alter table public.sched_date_changes      enable row level security;

drop policy if exists sched_items_select on public.sched_items;
create policy sched_items_select on public.sched_items for select to authenticated using (true);
drop policy if exists sched_items_insert on public.sched_items;
create policy sched_items_insert on public.sched_items for insert to authenticated with check (public.sched_can_build());
drop policy if exists sched_items_update on public.sched_items;
create policy sched_items_update on public.sched_items for update to authenticated using (public.sched_can_write()) with check (public.sched_can_write());
drop policy if exists sched_items_delete on public.sched_items;
create policy sched_items_delete on public.sched_items for delete to authenticated using (public.sched_can_build());

drop policy if exists sched_progress_select on public.sched_progress;
create policy sched_progress_select on public.sched_progress for select to authenticated using (true);
drop policy if exists sched_progress_write on public.sched_progress;
create policy sched_progress_write on public.sched_progress for all to authenticated using (public.sched_can_write()) with check (public.sched_can_write());

drop policy if exists sched_drawings_select on public.sched_drawings;
create policy sched_drawings_select on public.sched_drawings for select to authenticated using (true);
drop policy if exists sched_drawings_write on public.sched_drawings;
create policy sched_drawings_write on public.sched_drawings for all to authenticated using (public.sched_can_write()) with check (public.sched_can_write());

drop policy if exists sched_drawing_rev_select on public.sched_drawing_revisions;
create policy sched_drawing_rev_select on public.sched_drawing_revisions for select to authenticated using (true);
drop policy if exists sched_drawing_rev_write on public.sched_drawing_revisions;
create policy sched_drawing_rev_write on public.sched_drawing_revisions for all to authenticated using (public.sched_can_write()) with check (public.sched_can_write());

drop policy if exists sched_date_changes_select on public.sched_date_changes;
create policy sched_date_changes_select on public.sched_date_changes for select to authenticated using (true);
drop policy if exists sched_date_changes_insert on public.sched_date_changes;
create policy sched_date_changes_insert on public.sched_date_changes for insert to authenticated with check (public.sched_can_write());
drop policy if exists sched_date_changes_delete on public.sched_date_changes;
create policy sched_date_changes_delete on public.sched_date_changes for delete to authenticated using (public.current_user_role() = 'admin');

-- 9. role_permissions seed (missing row reads as "off")
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin',        'schedule', true, true,  true),
  ('project_head', 'schedule', true, true,  false),
  ('head',         'schedule', true, true,  false),
  ('engineer',     'schedule', true, true,  false),
  ('founder',      'schedule', true, false, false)
on conflict (role, module_slug) do nothing;

-- 10. app_settings config defaults (work-back lead times + dormant AI toggle)
insert into public.app_settings (key, value) values
  ('sched_lead_procurement_days', '21'),
  ('sched_lead_approval_days',    '7'),
  ('sched_lead_drawing_days',     '14'),
  ('sched_ai_assist_projects',    '[]')
on conflict (key) do nothing;
