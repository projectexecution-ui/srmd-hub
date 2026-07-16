-- Central Recycle Bin — soft-delete + restore across modules.
--
-- Pattern (mirrors cc_working_sheets.archived_at): a record is soft-deleted
-- IN PLACE by stamping its own `deleted_at`, so it instantly drops out of
-- every list (each read filters `deleted_at is null`) but is never lost. A
-- pointer row in `recycle_bin` indexes it so one Admin > Recycle Bin page can
-- list and restore anything. Items are kept forever (no auto-purge).
--
-- Wired modules extend two things: (1) add deleted_at/deleted_by to the table,
-- (2) add the table name to the whitelist in recycle_restore().

create table if not exists public.recycle_bin (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,            -- e.g. 'Established rate'
  source_table text not null,            -- table whose deleted_at we flip on restore
  entity_id    uuid not null,
  label        text not null,            -- what the user sees in the bin
  context      text,                     -- extra line (project / discipline / …)
  module_slug  text,                     -- for grouping + icon in the bin UI
  deleted_by   uuid references public.profiles(id),
  deleted_at   timestamptz not null default now(),
  restored_at  timestamptz,
  restored_by  uuid references public.profiles(id)
);

create index if not exists recycle_bin_active_idx
  on public.recycle_bin (deleted_at desc) where restored_at is null;

alter table public.recycle_bin enable row level security;

-- The delete itself is already permission-gated on each source table, so any
-- authenticated user who performed a delete may record the pointer row.
drop policy if exists recycle_bin_insert on public.recycle_bin;
create policy recycle_bin_insert on public.recycle_bin
  for insert to authenticated with check (true);

-- Only admin / Portal Owner can browse + restore the bin.
drop policy if exists recycle_bin_admin_read on public.recycle_bin;
create policy recycle_bin_admin_read on public.recycle_bin
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner)
  );

-- ── First wired module: Established Rates (est_rates) ─────────────────────
alter table public.est_rates
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

-- Generic restore: clears deleted_at on a whitelisted source table and marks
-- the bin row restored. SECURITY DEFINER so the flip works regardless of the
-- source table's own RLS, but gated to admin / Portal Owner here.
create or replace function public.recycle_restore(p_bin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_row public.recycle_bin;
begin
  v_is_admin := (public.current_user_role() = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner);
  if not v_is_admin then raise exception 'Only an admin can restore items'; end if;

  select * into v_row from public.recycle_bin where id = p_bin_id for update;
  if not found then raise exception 'Recycle item not found'; end if;
  if v_row.restored_at is not null then return jsonb_build_object('ok', true, 'noop', true); end if;

  -- Whitelist of restorable tables (extended as each module is wired).
  if v_row.source_table not in ('est_rates') then
    raise exception 'Restore not yet supported for %', v_row.source_table;
  end if;

  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', v_row.source_table)
    using v_row.entity_id;

  update public.recycle_bin
     set restored_at = now(), restored_by = auth.uid()
   where id = p_bin_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.recycle_restore(uuid) to authenticated;
