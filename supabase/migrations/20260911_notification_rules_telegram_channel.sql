-- notification_rules accepts 'telegram' as a channel (and 'user' as a scope).
--
-- The Telegram switch added on 11 Sep 2026 failed with
--   new row for relation "notification_rules" violates check constraint
--   "notification_rules_channel_check"
-- because the check still listed only in_app / email / web_push. The scope
-- check is widened at the same time so the user-scope mutes written since
-- 10 Sep are covered by the constraint as well as by the function that reads them.
--
-- Applied to live via Supabase MCP on 11 Sep 2026.

alter table public.notification_rules drop constraint if exists notification_rules_channel_check;
alter table public.notification_rules add constraint notification_rules_channel_check
  check (channel = any (array['in_app'::text, 'email'::text, 'web_push'::text, 'telegram'::text]));

alter table public.notification_rules drop constraint if exists notification_rules_scope_check;
alter table public.notification_rules add constraint notification_rules_scope_check
  check (scope = any (array['global'::text, 'role'::text, 'user'::text]));
