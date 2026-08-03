-- ============================================================================
-- Web Push — phone/desktop notifications even when CT HUB is closed
-- ============================================================================
-- Mirrors the email pipeline exactly: notify_user() already inserts a
-- notification_deliveries row (channel 'web_push') for opted-in users; this
-- migration makes those rows actually deliver. A trigger pg_net-POSTs each
-- queued web_push delivery to /api/push/send (same host + shared secret as
-- email — no new secret), which sends over the Web Push protocol to every
-- device the user has registered in push_subscriptions.
--
-- Requires (Vercel env, set by the Portal Owner — app keys, not secrets I hold):
--   NEXT_PUBLIC_VAPID_PUBLIC_KEY   the VAPID public key (safe to expose)
--   VAPID_PRIVATE_KEY              the VAPID private key
--   VAPID_SUBJECT (optional)       mailto: contact, defaults in the route
-- Until those exist the sender returns 503 and nothing is sent — inert, safe.

-- 1) Web Push follows the same on/off rules as in-app + email (default ON).
--    The real opt-in gate stays the per-user notification_preferences.web_push
--    flag PLUS having at least one registered device. (Previously web_push
--    was hard-defaulted OFF here, which would have suppressed every push.)
create or replace function public.notification_allowed(p_user_id uuid, p_event_type text, p_channel text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_role text; v_enabled boolean;
begin
  select role::text into v_role from public.profiles where id = p_user_id;

  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  return true;  -- default ON for every channel (web_push gated by the user pref + a device)
end $function$;

-- 2) Where to POST push deliveries — same host as email, /push/send. Reuses the
--    existing notify_internal_secret, so there is no new secret to configure.
insert into public.app_private_settings (key, value)
select 'push_dispatch_url', replace(value, '/api/email/send', '/api/push/send')
from public.app_private_settings where key = 'notify_dispatch_url'
on conflict (key) do update set value = excluded.value;

-- 3) Dispatch trigger — POST the sender for each queued web_push delivery.
create or replace function public.dispatch_push_delivery()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public','net'
as $function$
declare v_url text; v_secret text;
begin
  if new.channel <> 'web_push' or new.status <> 'pending' then
    return new;
  end if;
  select value into v_url    from public.app_private_settings where key = 'push_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    return new;  -- not configured yet → leave pending, nothing sent
  end if;
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('deliveryId', new.id),
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', v_secret)
    );
    update public.notification_deliveries set status='sent', sent_at=now() where id = new.id;
  exception when others then
    update public.notification_deliveries set status='failed', error=left(SQLERRM,300) where id = new.id;
  end;
  return new;
end $function$;

drop trigger if exists trg_dispatch_push_delivery on public.notification_deliveries;
create trigger trg_dispatch_push_delivery
  after insert on public.notification_deliveries
  for each row execute function public.dispatch_push_delivery();
