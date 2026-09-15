-- ============================================================
-- Material In & Out — GOING LIVE.  **NOT APPLIED.**
--
-- This file lives in docs/ and NOT in supabase/migrations/ on purpose.
--
-- The auto-apply action selects files with the GIT PATHSPEC
-- 'supabase/migrations/*.sql', and a git pathspec's * crosses directory
-- separators — unlike a shell glob. A subfolder such as migrations/_pending
-- would therefore have been applied on the next merge, which is the single
-- outcome this file exists to prevent. Checked, not assumed.
--
-- Aksha, 15 Sep 2026: "create the security and storekeeper accounts - but i am
-- not making it LIVE as of now".
--
-- GOING LIVE IS TWO ACTS AND BOTH ARE NEEDED:
--   1. set STORES_LIVE = true in lib/stores/core.ts   (who sees the section)
--   2. copy this into supabase/migrations/ and merge  (who the DATABASE admits)
--
-- Either alone is harmless and does nothing useful: the app would hide a
-- section the database serves, or the database would refuse a section the app
-- shows. Do both, in one go, or neither.
--
-- TO UNDO: re-apply 20260913_material_in_out_pilot_lock.sql, which sets every
-- policy back to admin-only, and set STORES_LIVE = false.
-- ============================================================

-- Who may read and write the section. Mirrors LIVE_ROLES in lib/stores/core.ts;
-- if you change one, change the other, or somebody sees a screen that then
-- refuses to load their data.
create or replace function public.mio_can_use() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text in
    ('admin', 'founder', 'head', 'store_manager', 'security', 'engineer');
$$;

-- Masters stay narrower — a storekeeper records material, they do not invent
-- storage locations or trusts.
create or replace function public.mio_can_master() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text in ('admin', 'founder', 'head');
$$;

do $$
declare t text;
begin
  -- The ledger and everything that hangs off it.
  foreach t in array array[
    'mio_items','mio_requests','mio_request_lines',
    'mio_entries','mio_entry_lines','mio_photos'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format(
      'create policy %I on public.%I for select using (public.mio_can_use())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all using (public.mio_can_use()) with check (public.mio_can_use())',
      t || '_write', t);
  end loop;

  -- The masters: everyone who uses the section can READ them (the pickers are
  -- built from them), but only management changes them.
  execute 'drop policy if exists mio_lists_select on public.mio_lists';
  execute 'drop policy if exists mio_lists_write  on public.mio_lists';
  execute 'create policy mio_lists_select on public.mio_lists for select using (public.mio_can_use())';
  execute 'create policy mio_lists_write  on public.mio_lists for all
             using (public.mio_can_master()) with check (public.mio_can_master())';
end $$;

-- Movements stay append-only for everyone. Stock is FOLDED from this table and
-- never stored, so a row that can be edited is a quantity that can be changed
-- after the fact with nothing to show for it. Corrections are a void and a
-- re-entry, which leave both.
drop policy if exists mio_movements_select on public.mio_movements;
drop policy if exists mio_movements_insert on public.mio_movements;
create policy mio_movements_select on public.mio_movements
  for select using (public.mio_can_use());
create policy mio_movements_insert on public.mio_movements
  for insert with check (public.mio_can_use());

-- The photographs. Same list — a guard who cannot upload the challan cannot
-- finish a gate entry, because the photo is compulsory.
drop policy if exists mio_photos_read  on storage.objects;
drop policy if exists mio_photos_write on storage.objects;
create policy mio_photos_read on storage.objects for select
  using (bucket_id = 'mio-photos' and public.mio_can_use());
create policy mio_photos_write on storage.objects for insert
  with check (bucket_id = 'mio-photos' and public.mio_can_use());
