-- Material In & Out — who works on which project.
--
-- Aksha, 15 Sep 2026: "the respective project eng can only request for that
-- particular project from thier own projects stock" — and, asked where that
-- mapping should come from: "i will set that up later - as Eng are not in CT
-- Hub yet - but give me the desk to assign them".
--
-- So this is the desk. Nothing in CT Hub recorded it before: cc_project_approvers
-- holds the four Atm Heads who APPROVE, sr_stakeholders has no rows with a
-- login, and the ENG role grants every project with no assignment at all.
--
-- WHY A TABLE OF ITS OWN rather than widening one of those. The approvers list
-- answers "who signs this off" and is owned by Cost Control; this answers "whose
-- site is this" and is owned by the store. They will diverge — an engineer moves
-- site far more often than an approver changes — and a shared table would make
-- one module's correction the other module's surprise.
--
-- Empty on purpose. It stays empty until Aksha fills it in, and the rule that
-- reads it says so out loud rather than silently letting everyone through or
-- silently locking everyone out.

create table if not exists public.mio_project_staff (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- What they are ON THIS PROJECT. A person can be the engineer on one site
  -- and the site head on another.
  role        text not null default 'engineer' check (role in ('engineer', 'site_head')),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists mio_project_staff_user_idx
  on public.mio_project_staff (user_id) where is_active;
create index if not exists mio_project_staff_project_idx
  on public.mio_project_staff (project_id) where is_active;

comment on table public.mio_project_staff is
  'Which site engineer / site head works on which project, for Material In & Out. Owned by the store, NOT by Cost Control — see cc_project_approvers for who approves.';

alter table public.mio_project_staff enable row level security;

-- Same lock as the rest of the section while it is under review: admin only.
-- Widened by docs/go-live/material-in-out-go-live.sql when the section opens.
drop policy if exists mio_project_staff_select on public.mio_project_staff;
drop policy if exists mio_project_staff_write  on public.mio_project_staff;

create policy mio_project_staff_select on public.mio_project_staff
  for select using (public.mio_pilot_admin());
create policy mio_project_staff_write on public.mio_project_staff
  for all using (public.mio_pilot_admin()) with check (public.mio_pilot_admin());
