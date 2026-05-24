-- ============================================================
-- Module visibility — Portal Owner master switch per module
-- ============================================================
-- Lets a Portal Owner hide a dashboard module from everyone
-- (except themselves). Sits on top of role_permissions: even if
-- a role has view perm, a disabled module is hidden + its routes
-- redirect.
--
-- Storage convention: a row exists ONLY when a module is disabled.
-- Missing slug = enabled (default). Keeps the table small and
-- means new modules added to lib/modules.ts don't need a migration.
-- ============================================================

create table if not exists public.module_visibility (
  slug        text primary key,
  enabled     boolean not null default false,  -- row exists => override; default override is "off"
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

comment on table public.module_visibility is
  'Portal Owner-controlled per-module on/off switch. Row present = explicit override (typically enabled=false to hide). Missing row = enabled.';

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.module_visibility enable row level security;

-- Anyone signed-in can read (needed by every page that gates by perms).
drop policy if exists "module_visibility_select_all" on public.module_visibility;
create policy "module_visibility_select_all"
  on public.module_visibility
  for select
  to authenticated
  using (true);

-- Only Portal Owners can insert/update/delete.
drop policy if exists "module_visibility_write_portal_owner" on public.module_visibility;
create policy "module_visibility_write_portal_owner"
  on public.module_visibility
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_portal_owner = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_portal_owner = true
    )
  );

-- ------------------------------------------------------------
-- Trigger: keep updated_at + updated_by current
-- ------------------------------------------------------------
create or replace function public.module_visibility_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_module_visibility_touch on public.module_visibility;
create trigger trg_module_visibility_touch
  before insert or update on public.module_visibility
  for each row execute function public.module_visibility_touch();
