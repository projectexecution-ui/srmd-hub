-- ============================================================
-- IN4 → hub intake (Aksha, 23 Sep 2026, N1 + NS4)
-- ============================================================
-- One row per IN4 sub-project the hub has met but does not hold:
--   new      waiting to be chosen on Data › From IN4
--   added    a hub project was created for it (by hand or by the sync)
--   skipped  somebody said no; the sync will not offer it again
-- The masters feed inserts arrivals; Execution ones it adopts at once.
-- The backlog on the day this shipped is seeded as 'new' and never adopted
-- blindly — an admin or Parimal ticks what comes in. Idempotent.

create table if not exists public.in4_hub_intake (
  subproject_id  integer primary key,
  first_seen_at  timestamptz not null default now(),
  status         text not null default 'new' check (status in ('new', 'added', 'skipped')),
  hub_project_id uuid references public.projects(id) on delete set null,
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  note           text
);

alter table public.in4_hub_intake enable row level security;

drop policy if exists in4_hub_intake_select on public.in4_hub_intake;
create policy in4_hub_intake_select on public.in4_hub_intake
  for select to authenticated using (true);

drop policy if exists in4_hub_intake_write on public.in4_hub_intake;
create policy in4_hub_intake_write on public.in4_hub_intake
  for all to authenticated using (public.is_writer()) with check (public.is_writer());

-- The backlog: every active IN4 sub-project the hub does not hold today.
insert into public.in4_hub_intake (subproject_id, status, note)
select s.id, 'new', 'waiting on the day intake shipped, 23 Sep 2026'
from public.in4_subprojects s
where s.is_active
  and not exists (
    select 1 from public.in4_subproject_links l
    join public.cc_bph_project_links b on b.bph_project_id = l.bph_project_id
    where l.subproject_id = s.id)
on conflict (subproject_id) do nothing;
