-- ============================================================
-- Material In & Out — lock the pilot to ADMIN, in the database
-- ============================================================
-- Aksha, 13 Sep 2026: "hope its visible to Admin only".
--
-- The app already hides the Stores lane and refuses the pages for anyone but
-- an admin. That is not the whole gate: `mio_*` shipped with
-- `select ... using (true)`, which is the house pattern for a live module, so
-- any signed-in person could still have read the register through the API
-- without ever opening a screen. During a pilot that is exactly wrong.
--
-- So every policy now runs through mio_pilot_admin() — role = 'admin', and
-- nothing else. Today that is one live account.
--
-- TO WIDEN IT LATER: this is deliberately ONE function. Opening the section
-- up is a migration that redefines mio_pilot_admin(), not fifteen policy
-- edits — and the three app-side flags (PILOT_PROJECT_IDS in
-- lib/stores/core.ts, pilotProjectIds on the tab, canSeeStores in NavBar).
-- ============================================================

create or replace function public.mio_pilot_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text = 'admin';
$$;

-- ── Every table: read and write, admin only ─────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'mio_lists','mio_items','mio_requests','mio_request_lines',
    'mio_entries','mio_entry_lines','mio_photos'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.mio_pilot_admin())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.mio_pilot_admin()) with check (public.mio_pilot_admin())',
      t || '_write', t);
  end loop;
end $$;

-- The ledger keeps its append-only shape: still no update and no delete
-- policy, so a movement can be written and then only ever read.
drop policy if exists mio_movements_select on public.mio_movements;
create policy mio_movements_select on public.mio_movements for select to authenticated
  using (public.mio_pilot_admin());
drop policy if exists mio_movements_insert on public.mio_movements;
create policy mio_movements_insert on public.mio_movements for insert to authenticated
  with check (public.mio_pilot_admin());

drop policy if exists mio_edits_select on public.mio_edits;
create policy mio_edits_select on public.mio_edits for select to authenticated
  using (public.mio_pilot_admin());
drop policy if exists mio_edits_insert on public.mio_edits;
create policy mio_edits_insert on public.mio_edits for insert to authenticated
  with check (public.mio_pilot_admin());

-- Gate photographs are of bills and challans, so they follow the register.
drop policy if exists mio_photos_read on storage.objects;
create policy mio_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'mio-photos' and public.mio_pilot_admin());
drop policy if exists mio_photos_upload on storage.objects;
create policy mio_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'mio-photos' and public.mio_pilot_admin());
