-- Round 4 — "Reports & digests" control centre (Aksha, 10 Sep 2026: "users who
-- will get what I should be able to decide — like the Permission Matrix").
--
-- notification_allowed() learns a per-USER scope, checked before the role and
-- global rules: a row (scope='user', scope_key=<user id>, event_type, channel,
-- enabled=false) mutes that message for that person on that channel. The
-- matrix on /admin/reports writes these rows; deleting them restores the
-- role/global default. Additive: every existing rule behaves exactly as before.
-- Idempotent (CREATE OR REPLACE).

create or replace function public.notification_allowed(p_user_id uuid, p_event_type text, p_channel text)
 returns boolean
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
declare v_role text; v_enabled boolean;
begin
  -- 1. this person, this message
  select enabled into v_enabled from public.notification_rules
    where scope='user' and scope_key = p_user_id::text and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  -- 2. this person, every message
  select enabled into v_enabled from public.notification_rules
    where scope='user' and scope_key = p_user_id::text and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;

  select role::text into v_role from public.profiles where id = p_user_id;
  -- 3. their role
  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  -- 4. everyone
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  return true;
end $function$;
