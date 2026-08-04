-- Email reliability overhaul.
--
-- Problems this fixes (all found in the 2026-08-04 audit):
--   1. "sent" was a lie — the trigger fired pg_net and immediately marked the
--      delivery 'sent', before Gmail had accepted it. The real result lands in
--      net._http_response, which auto-purges. So a rejected email still read
--      'sent' and nobody knew.
--   2. No retry / dead-letter — a momentary bad config or Gmail hiccup lost the
--      email forever (160 stuck 'pending' since June proved it).
--   3. No failure alert — the stuck-email bug only surfaced because a human
--      noticed.
--   4. The "Daily digest" bundling deferred emails that were already digests, so
--      they sat unsent (fixed 2026-08-04 by pinning; here we remove the defer
--      path entirely).
--
-- Model: pending → (route confirms) sent | failed → (sweep retries) → dead.
--   - dispatch_email_delivery_now() posts one email to /api/email/send and
--     leaves it 'pending' (in-flight); it does NOT optimistically mark 'sent'.
--   - /api/email/send writes the TRUE outcome back (sent / failed) by deliveryId.
--   - email_retry_sweep() (cron, 2×/day) re-dispatches stuck/failed rows under a
--     5-attempt cap, dead-letters the rest, and bell-alerts admins on dead-letter.

-- ── 1. Columns for retry + reconciliation ──────────────────────────────
alter table public.notification_deliveries
  add column if not exists attempts int not null default 0,
  add column if not exists dispatched_at timestamptz;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status = any (array['pending','sent','failed','skipped','deferred','dead']));

-- ── 2. One dispatch function (used by the trigger AND the retry sweep) ──
create or replace function public.dispatch_email_delivery_now(p_delivery_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare
  v_url text; v_secret text; v_to text; v_subject text; v_body text; v_link text;
  v_type text; v_data jsonb; v_channel text; v_notif uuid;
begin
  select channel, notification_id into v_channel, v_notif
    from public.notification_deliveries where id = p_delivery_id;
  if v_channel is null or v_channel <> 'email' then return; end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    -- Config not set → leave 'pending'; the sweep retries once it exists.
    update public.notification_deliveries
      set error = 'dispatch config missing', dispatched_at = now()
      where id = p_delivery_id;
    return;
  end if;

  select n.title, n.body, n.url, n.type, n.data, coalesce(np.email_address, p.email)
    into v_subject, v_body, v_link, v_type, v_data, v_to
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = v_notif;

  if v_to is null or v_to = '' or v_to like 'anon-%' then
    update public.notification_deliveries set status = 'skipped', error = 'no recipient email'
      where id = p_delivery_id;
    return;
  end if;

  -- Mark in-flight (pending) and count the attempt. The route writes the final
  -- sent/failed. A pending row still sitting here after 10 min = the route never
  -- confirmed → the sweep re-dispatches it.
  update public.notification_deliveries
    set status = 'pending', attempts = attempts + 1, dispatched_at = now(), error = null
    where id = p_delivery_id;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'to', v_to,
                   'subject', coalesce(v_subject, 'CT HUB notification'),
                   'text', coalesce(v_body, ''),
                   'url', v_link,
                   'type', v_type,
                   'data', v_data,
                   'deliveryId', p_delivery_id
                 ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret)
    );
  exception when others then
    update public.notification_deliveries set status = 'failed', error = left(SQLERRM, 300)
      where id = p_delivery_id;
  end;
end
$function$;

-- ── 3. Trigger now just delegates to the shared function ───────────────
create or replace function public.dispatch_email_delivery()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
begin
  if new.channel = 'email' and new.status = 'pending' then
    perform public.dispatch_email_delivery_now(new.id);
  end if;
  return new;
end
$function$;

-- ── 4. Retry sweep — re-dispatch stuck/failed, dead-letter, alert admins ─
create or replace function public.email_retry_sweep()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_retried int := 0; v_dead int := 0; v_rec record; v_admin uuid;
begin
  -- Give up after 5 attempts (≈ trigger + 4 sweeps).
  update public.notification_deliveries
    set status = 'dead'
    where channel = 'email' and status in ('pending','failed') and attempts >= 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes';
  get diagnostics v_dead = row_count;

  -- Re-dispatch failed rows + pending rows the route never confirmed.
  for v_rec in
    select id from public.notification_deliveries
    where channel = 'email' and status in ('pending','failed') and attempts < 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes'
    order by created_at
    limit 200
  loop
    perform public.dispatch_email_delivery_now(v_rec.id);
    v_retried := v_retried + 1;
  end loop;

  -- Bell-alert admins when something is dead-lettered (email_health is
  -- in-app-only — see the notification_rules rows below — so a broken email
  -- channel can still report itself).
  if v_dead > 0 then
    for v_admin in select id from public.profiles where role = 'admin' and coalesce(is_active, true) loop
      perform public.notify_user(
        v_admin, 'email_health', 'Email delivery needs a look',
        v_dead || ' email(s) could not be delivered after 5 retries — open Admin → Notifications to review.',
        '/admin/notifications', null, null, null, null);
    end loop;
  end if;

  return jsonb_build_object('retried', v_retried, 'dead', v_dead);
end
$function$;

-- email_health is bell-only (never email/push — don't rely on the channel that
-- may be broken to report itself).
insert into public.notification_rules (scope, scope_key, event_type, channel, enabled)
values ('global','','email_health','email', false),
       ('global','','email_health','web_push', false)
on conflict do nothing;

-- ── 5. notify_user: drop the "daily digest" defer path (send instantly) ─
create or replace function public.notify_user(p_user_id uuid, p_type text, p_title text, p_body text default null::text, p_url text default null::text, p_module_slug text default null::text, p_doc_table text default null::text, p_doc_id uuid default null::uuid, p_data jsonb default null::jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_pref record; v_mode text;
begin
  insert into public.notifications(user_id, module_slug, doc_table, doc_id, type, title, body, url, data)
  values (p_user_id, p_module_slug, p_doc_table, p_doc_id, p_type, p_title, p_body, p_url, p_data)
  returning id into v_id;

  -- Timing is now just instant vs off (the daily-digest bundling is gone).
  v_mode := public.notification_mode(p_user_id, p_type);

  select coalesce(in_app,true) as in_app, coalesce(email,true) as email,
         coalesce(telegram,false) as telegram, coalesce(web_push,false) as web_push
    into v_pref
  from public.notification_preferences where user_id = p_user_id;
  if not found then
    v_pref.in_app := true; v_pref.email := true; v_pref.telegram := false; v_pref.web_push := false;
  end if;

  -- In-app bell is always live.
  if v_pref.in_app and public.notification_allowed(p_user_id, p_type, 'in_app') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'in_app','sent');
  end if;
  if v_mode <> 'off' and v_pref.email and public.notification_allowed(p_user_id, p_type, 'email') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'email','pending');
  end if;
  if v_pref.telegram then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram');
  end if;
  if v_mode <> 'off' and v_pref.web_push and public.notification_allowed(p_user_id, p_type, 'web_push') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'web_push','pending');
  end if;

  return v_id;
end $function$;

-- ── 6. Remove the daily-digest bundling machinery ──────────────────────
drop function if exists public.notification_send_daily_digests();
-- Any leftover global 'daily' schedule rows now behave as instant; clear them
-- so nothing looks like it's on a digest.
update public.notification_schedule set mode = 'instant' where mode = 'daily';
