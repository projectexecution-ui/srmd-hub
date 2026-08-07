-- Weekly promises (Last Planner style): item × floor committed for a week.
-- Ticking a promise done also sets that floor cell done (one source of truth).
create table if not exists public.sched_promises (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id    uuid not null references public.sched_items(id) on delete cascade,
  location   text not null,
  week_start date not null,
  status     text not null default 'open' check (status in ('open','done','not_done')),
  done_at    timestamptz,
  owner_name text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists sched_promises_uniq
  on public.sched_promises (item_id, lower(location), week_start);
create index if not exists sched_promises_week on public.sched_promises (project_id, week_start);

alter table public.sched_promises enable row level security;
drop policy if exists sched_promises_select on public.sched_promises;
create policy sched_promises_select on public.sched_promises for select using (true);
drop policy if exists sched_promises_write on public.sched_promises;
create policy sched_promises_write on public.sched_promises for all
  using (public.sched_can_write()) with check (public.sched_can_write());
