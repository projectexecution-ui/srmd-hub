-- Extend the email-reliability model to phone push (web_push): honest 'sent'
-- (the /api/push/send route writes the true outcome back), retry + dead-letter
-- via the shared sweep, and the health RPC now reports both channels.

-- ── Push dispatch function (shared by the trigger + the retry sweep) ────
create or replace function public.dispatch_push_delivery_now(p_delivery_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare v_url text; v_secret text; v_channel text;
begin
  select channel into v_channel from public.notification_deliveries where id = p_delivery_id;
  if v_channel is null or v_channel <> 'web_push' then return; end if;

  select value into v_url    from public.app_private_settings where key = 'push_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    update public.notification_deliveries set error = 'push config missing', dispatched_at = now()
      where id = p_delivery_id;
    return;
  end if;

  update public.notification_deliveries
    set status = 'pending', attempts = attempts + 1, dispatched_at = now(), error = null
    where id = p_delivery_id;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('deliveryId', p_delivery_id),
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret', v_secret)
    );
  exception when others then
    update public.notification_deliveries set status = 'failed', error = left(SQLERRM, 300)
      where id = p_delivery_id;
  end;
end
$function$;

-- Trigger delegates + leaves 'pending' (route writes back sent/failed/skipped).
create or replace function public.dispatch_push_delivery()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
begin
  if new.channel = 'web_push' and new.status = 'pending' then
    perform public.dispatch_push_delivery_now(new.id);
  end if;
  return new;
end
$function$;

-- ── Sweep now covers both channels (email + web_push) ──────────────────
create or replace function public.email_retry_sweep()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_retried int := 0; v_dead int := 0; v_rec record; v_admin uuid;
begin
  update public.notification_deliveries
    set status = 'dead'
    where channel in ('email','web_push') and status in ('pending','failed') and attempts >= 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes';
  get diagnostics v_dead = row_count;

  for v_rec in
    select id, channel from public.notification_deliveries
    where channel in ('email','web_push') and status in ('pending','failed') and attempts < 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes'
    order by created_at
    limit 200
  loop
    if v_rec.channel = 'email' then perform public.dispatch_email_delivery_now(v_rec.id);
    else perform public.dispatch_push_delivery_now(v_rec.id); end if;
    v_retried := v_retried + 1;
  end loop;

  if v_dead > 0 then
    for v_admin in select id from public.profiles where role = 'admin' and coalesce(is_active, true) loop
      perform public.notify_user(
        v_admin, 'email_health', 'Notification delivery needs a look',
        v_dead || ' email/phone alert(s) could not be delivered after 5 retries — open Admin → Notifications to review.',
        '/admin/notifications', null, null, null, null);
    end loop;
  end if;

  return jsonb_build_object('retried', v_retried, 'dead', v_dead);
end
$function$;

-- ── Health RPC now returns per-channel { email, push } ─────────────────
create or replace function public.email_delivery_health()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ok boolean;
  e_counts jsonb; e_stuck int; e_recent jsonb;
  p_counts jsonb; p_stuck int; p_recent jsonb;
begin
  select (role::text = 'admin' or coalesce(is_portal_owner, false)) into v_ok
    from public.profiles where id = auth.uid();
  if not coalesce(v_ok, false) then raise exception 'admin only'; end if;

  -- email
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into e_counts
  from (select status, count(*)::int n from public.notification_deliveries
        where channel = 'email' and created_at > now() - interval '7 days' group by status) s;
  select count(*)::int into e_stuck from public.notification_deliveries
   where channel = 'email' and status = 'pending' and coalesce(dispatched_at, created_at) < now() - interval '15 minutes';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into e_recent from (
    select jsonb_build_object('to', coalesce(p.full_name, p.name, p.email, '—'), 'subject', n.title,
      'status', d.status, 'attempts', d.attempts, 'error', d.error,
      'at', to_char(d.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) as x
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    left join public.profiles p on p.id = n.user_id
    where d.channel = 'email' and d.status in ('failed','dead') order by d.created_at desc limit 15) t;

  -- phone push
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into p_counts
  from (select status, count(*)::int n from public.notification_deliveries
        where channel = 'web_push' and created_at > now() - interval '7 days' group by status) s;
  select count(*)::int into p_stuck from public.notification_deliveries
   where channel = 'web_push' and status = 'pending' and coalesce(dispatched_at, created_at) < now() - interval '15 minutes';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into p_recent from (
    select jsonb_build_object('to', coalesce(p.full_name, p.name, p.email, '—'), 'subject', n.title,
      'status', d.status, 'attempts', d.attempts, 'error', d.error,
      'at', to_char(d.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) as x
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    left join public.profiles p on p.id = n.user_id
    where d.channel = 'web_push' and d.status in ('failed','dead') order by d.created_at desc limit 15) t;

  return jsonb_build_object(
    'email', jsonb_build_object('counts', e_counts, 'stuck', e_stuck, 'recent', e_recent),
    'push',  jsonb_build_object('counts', p_counts, 'stuck', p_stuck, 'recent', p_recent)
  );
end
$function$;
