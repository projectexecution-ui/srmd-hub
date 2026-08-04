-- Self-contained digest emails (the Indent→PO procurement digest, the engineer
-- digest, and the daily-digest bundle itself) must NEVER be put into "Daily
-- digest" mode: they're already once-a-day summaries, so deferring them to be
-- re-bundled means the email is held and — if the sweep doesn't run — never
-- sent at all. That is exactly what happened: procurement_digest was set to
-- daily, so every "send to the heads" produced a DEFERRED email that just sat
-- there and the heads received nothing.
--
-- Pin these event types to 'instant' in notification_mode() (same treatment as
-- approval_pending) so they always send directly, regardless of any schedule
-- row an admin sets. Purely additive to the existing pin list.
create or replace function public.notification_mode(p_user_id uuid, p_event_type text)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_role text; v_mode text;
begin
  -- Approvals + all self-contained digests always send immediately.
  if p_event_type in ('approval_pending','procurement_digest','engineer_digest','daily_digest')
    then return 'instant'; end if;
  select role::text into v_role from public.profiles where id = p_user_id;
  select mode into v_mode from public.notification_schedule
    where scope='user' and scope_key = p_user_id::text and event_type = p_event_type;
  if found then return v_mode; end if;
  select mode into v_mode from public.notification_schedule
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = p_event_type;
  if found then return v_mode; end if;
  select mode into v_mode from public.notification_schedule
    where scope='global' and scope_key='' and event_type = p_event_type;
  if found then return v_mode; end if;
  return 'instant';
end $function$;

-- Drop the now-inert daily schedule row for the procurement digest so the admin
-- UI stops showing it as "Daily" (the function ignores it anyway).
delete from public.notification_schedule
 where scope='global' and scope_key='' and event_type='procurement_digest';
