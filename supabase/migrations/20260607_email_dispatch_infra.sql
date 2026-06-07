-- Email delivery infrastructure (Gmail via the app's /api/email/send route).
-- Enables pg_net (DB → HTTP) and a private, RLS-locked config table holding
-- the dispatch URL + shared secret.
--
-- NOTE: the real notify_internal_secret was set out-of-band (it must match the
-- NOTIFY_INTERNAL_SECRET env var in Vercel). The value below is a REDACTED
-- placeholder so the secret isn't committed to git — set the live value with:
--   update public.app_private_settings set value = '<secret>' where key = 'notify_internal_secret';

create extension if not exists pg_net;

create table if not exists public.app_private_settings (
  key   text primary key,
  value text
);
alter table public.app_private_settings enable row level security;
-- Intentionally NO policies: PostgREST returns nothing to clients; only
-- SECURITY DEFINER functions (the dispatch trigger) can read it.

-- URL can be safely re-asserted; the secret is inserted only if absent so a
-- re-run never clobbers the live value set out-of-band.
insert into public.app_private_settings(key, value)
  values ('notify_dispatch_url', 'https://ct-hub.vercel.app/api/email/send')
on conflict (key) do update set value = excluded.value;

insert into public.app_private_settings(key, value)
  values ('notify_internal_secret', 'REDACTED-SET-OUT-OF-BAND')
on conflict (key) do nothing;
