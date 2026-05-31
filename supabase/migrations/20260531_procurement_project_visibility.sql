-- ============================================================
-- Procurement project visibility — per-user filter
-- ============================================================
-- Two tables:
--   procurement_known_projects        — auto-grown registry of every
--                                       project name ever seen in an
--                                       upload. Any signed-in user can
--                                       upsert (so uploads from any
--                                       user keep it current); admins
--                                       can delete stale entries.
--
--   procurement_user_project_visibility — per-user hide list. Mirrors
--                                       module_visibility's "row exists
--                                       = override" convention: a row
--                                       in this table means the
--                                       project is HIDDEN for that
--                                       user. Default state (no row)
--                                       is "visible". Keeps the table
--                                       small.
--
-- Admin (role = 'admin') is the only writer for the hide list.
-- ============================================================

-- ─── Known-project registry ─────────────────────────────────
create table if not exists public.procurement_known_projects (
  name           text primary key,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_seen_by   uuid references public.profiles(id) on delete set null
);

comment on table public.procurement_known_projects is
  'Union of distinct project names seen across all procurement-tracker uploads. Auto-grows. Drives the admin project-visibility picker.';

alter table public.procurement_known_projects enable row level security;

drop policy if exists "pkp_select_all" on public.procurement_known_projects;
create policy "pkp_select_all"
  on public.procurement_known_projects
  for select
  to authenticated
  using (true);

drop policy if exists "pkp_insert_authenticated" on public.procurement_known_projects;
create policy "pkp_insert_authenticated"
  on public.procurement_known_projects
  for insert
  to authenticated
  with check (true);

drop policy if exists "pkp_update_authenticated" on public.procurement_known_projects;
create policy "pkp_update_authenticated"
  on public.procurement_known_projects
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "pkp_delete_admin" on public.procurement_known_projects;
create policy "pkp_delete_admin"
  on public.procurement_known_projects
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ─── Per-user hide list ─────────────────────────────────────
create table if not exists public.procurement_user_project_visibility (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  project_name  text not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id) on delete set null,
  primary key (user_id, project_name)
);

comment on table public.procurement_user_project_visibility is
  'Per-user hidden-projects list. Row present (user_id, project_name) => project is hidden for that user. Absent => visible. Only admins (role = ''admin'') can write.';

alter table public.procurement_user_project_visibility enable row level security;

-- Users can SELECT their own rows so the procurement-tracker page can
-- fetch the hide list. Admins can SELECT all rows for the admin UI.
drop policy if exists "pupv_select_own_or_admin" on public.procurement_user_project_visibility;
create policy "pupv_select_own_or_admin"
  on public.procurement_user_project_visibility
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Only admins can write (insert/update/delete).
drop policy if exists "pupv_write_admin" on public.procurement_user_project_visibility;
create policy "pupv_write_admin"
  on public.procurement_user_project_visibility
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ─── Touch trigger for hide-list rows ───────────────────────
create or replace function public.procurement_user_project_visibility_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_procurement_user_project_visibility_touch on public.procurement_user_project_visibility;
create trigger trg_procurement_user_project_visibility_touch
  before insert or update on public.procurement_user_project_visibility
  for each row execute function public.procurement_user_project_visibility_touch();
