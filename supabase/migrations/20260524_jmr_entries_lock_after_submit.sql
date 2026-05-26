-- JMR daily entries are now locked the moment they're submitted.
-- Engineer / site_staff / uploader can INSERT but never UPDATE or DELETE
-- their own entries. Only admin and head can amend a submitted entry.
-- This drops the previous 12-hour edit grace window.

drop policy if exists "jmr_entries_update" on public.jmr_daily_entries;

create policy "jmr_entries_update"
  on public.jmr_daily_entries
  for update
  using (current_user_role() = any (array['admin'::user_role, 'head'::user_role]))
  with check (current_user_role() = any (array['admin'::user_role, 'head'::user_role]));

-- DELETE policy already restricted to admin / head — kept as is.
