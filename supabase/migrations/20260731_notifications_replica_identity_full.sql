-- Realtime live delivery for the in-app notification bell.
-- The notifications table has RLS (user_id = auth.uid()) but REPLICA IDENTITY
-- DEFAULT (primary key only), so Supabase Realtime cannot reliably evaluate the
-- row-level policy against a WAL change and may drop the live event — the bell
-- then only updates on a full page refresh. FULL puts the whole row in the WAL
-- so Realtime can authorize and deliver every insert/update live. Tiny,
-- low-write table → negligible overhead.
alter table public.notifications replica identity full;
