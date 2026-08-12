-- Telegram delivery channel + account linking.
--
-- The notification pipeline has enqueued a 'telegram' delivery since the
-- foundation (20260528) whenever a user's telegram pref is on — but nothing
-- ever SENT it. This adds the missing half, mirroring the email pipeline
-- (20260804) exactly:
--   • dispatch_telegram_delivery_now() posts one queued delivery to
--     /api/telegram/send (secured by the same notify_internal_secret); the
--     route calls the Telegram Bot API and writes the true outcome back.
--   • a trigger fires it on each new pending 'telegram' delivery row.
--   • telegram_retry_sweep() re-dispatches stuck/failed rows (5-attempt cap),
--     run alongside the email sweep from /api/cron/email-retry.
--
-- Plus code-based account linking: the app hands the user a /start <code>
-- deep-link; the bot webhook calls telegram_link_confirm() to bind their chat.
-- All additive — inert until a user links Telegram, so nothing else changes.

-- ── 1. Link-code columns on notification_preferences ───────────────────
alter table public.notification_preferences
  add column if not exists telegram_link_code    text,
  add column if not exists telegram_link_expires  timestamptz,
  add column if not exists telegram_linked_at      timestamptz;

-- A pending code maps to exactly one user.
create unique index if not exists notif_pref_tg_code_idx
  on public.notification_preferences(telegram_link_code)
  where telegram_link_code is not null;

-- ── 2. Dispatch one telegram delivery to /api/telegram/send ────────────
create or replace function public.dispatch_telegram_delivery_now(p_delivery_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare
  v_url text; v_secret text; v_chat text; v_title text; v_body text; v_link text;
  v_channel text; v_notif uuid;
begin
  select channel, notification_id into v_channel, v_notif
    from public.notification_deliveries where id = p_delivery_id;
  if v_channel is null or v_channel <> 'telegram' then return; end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    -- Config not set → leave 'pending'; the sweep retries once it exists.
    update public.notification_deliveries
      set error = 'dispatch config missing', dispatched_at = now()
      where id = p_delivery_id;
    return;
  end if;
  -- Same app, sibling route.
  v_url := replace(v_url, 'email/send', 'telegram/send');

  select n.title, n.body, n.url, np.telegram_chat_id
    into v_title, v_body, v_link, v_chat
  from public.notifications n
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = v_notif;

  if v_chat is null or v_chat = '' then
    -- Telegram not linked → retrying won't help; skip.
    update public.notification_deliveries set status = 'skipped', error = 'telegram not linked'
      where id = p_delivery_id;
    return;
  end if;

  -- Mark in-flight (pending) and count the attempt. The route writes the final
  -- sent/failed/skipped. A pending row still here after 10 min = never
  -- confirmed → the sweep re-dispatches it.
  update public.notification_deliveries
    set status = 'pending', attempts = attempts + 1, dispatched_at = now(), error = null
    where id = p_delivery_id;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'chatId', v_chat,
                   'title', coalesce(v_title, 'CT HUB'),
                   'text', coalesce(v_body, ''),
                   'url', v_link,
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

-- ── 3. Trigger — fire on a new pending telegram delivery ───────────────
create or replace function public.dispatch_telegram_delivery()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
begin
  if new.channel = 'telegram' and new.status = 'pending' then
    perform public.dispatch_telegram_delivery_now(new.id);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_dispatch_telegram_delivery on public.notification_deliveries;
create trigger trg_dispatch_telegram_delivery
  after insert on public.notification_deliveries
  for each row execute function public.dispatch_telegram_delivery();

-- ── 4. Retry sweep (run from /api/cron/email-retry alongside email) ────
create or replace function public.telegram_retry_sweep()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_retried int := 0; v_dead int := 0; v_rec record;
begin
  update public.notification_deliveries
    set status = 'dead'
    where channel = 'telegram' and status in ('pending','failed') and attempts >= 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes';
  get diagnostics v_dead = row_count;

  for v_rec in
    select id from public.notification_deliveries
    where channel = 'telegram' and status in ('pending','failed') and attempts < 5
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes'
    order by created_at
    limit 200
  loop
    perform public.dispatch_telegram_delivery_now(v_rec.id);
    v_retried := v_retried + 1;
  end loop;

  return jsonb_build_object('retried', v_retried, 'dead', v_dead);
end
$function$;

-- ── 5. Account linking RPCs ────────────────────────────────────────────
-- Start: mint (or refresh) a one-time code for the signed-in user. The bot's
-- /start <code> deep-link carries it back. 15-minute expiry.
create or replace function public.telegram_link_start()
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_code text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_code := left('ct' || replace(gen_random_uuid()::text, '-', ''), 22);
  insert into public.notification_preferences(user_id, telegram_link_code, telegram_link_expires)
    values (v_uid, v_code, now() + interval '15 minutes')
  on conflict (user_id) do update
    set telegram_link_code = excluded.telegram_link_code,
        telegram_link_expires = excluded.telegram_link_expires,
        updated_at = now();
  return v_code;
end
$function$;

-- Confirm: bind a chat to the user who owns an unexpired code, turn telegram
-- on, clear the code. Called by the webhook (service role) after /start <code>.
-- Returns the user's display name for the bot's reply, or null if unknown/expired.
create or replace function public.telegram_link_confirm(p_code text, p_chat_id text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid; v_name text;
begin
  select user_id into v_uid from public.notification_preferences
    where telegram_link_code = p_code
      and (telegram_link_expires is null or telegram_link_expires > now());
  if v_uid is null then return null; end if;
  update public.notification_preferences
    set telegram_chat_id = p_chat_id, telegram = true,
        telegram_link_code = null, telegram_link_expires = null,
        telegram_linked_at = now(), updated_at = now()
    where user_id = v_uid;
  select coalesce(nullif(trim(name), ''), nullif(trim(full_name), ''), 'there')
    into v_name from public.profiles where id = v_uid;
  return v_name;
end
$function$;

-- Disconnect (self) — the app calls this with the signed-in user's session.
create or replace function public.telegram_unlink()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  update public.notification_preferences
    set telegram = false, telegram_chat_id = null, telegram_linked_at = null, updated_at = now()
    where user_id = v_uid;
end
$function$;

-- Disconnect by chat id — the bot's /stop. Webhook (service role) only, so a
-- signed-in user can't disconnect someone else by guessing a chat id.
create or replace function public.telegram_unlink_by_chat(p_chat_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.notification_preferences
    set telegram = false, telegram_chat_id = null, telegram_linked_at = null, updated_at = now()
    where telegram_chat_id = p_chat_id;
end
$function$;

-- telegram_link_confirm + telegram_unlink_by_chat are called only by the
-- webhook (service role). Lock them away from every app-facing role (PUBLIC +
-- Supabase's default anon/authenticated grants) so no signed-in user can spoof
-- a link or disconnect someone else by chat id. telegram_link_start /
-- telegram_unlink stay open to authenticated — they act on auth.uid() only.
revoke execute on function public.telegram_link_confirm(text, text)  from public, anon, authenticated;
grant  execute on function public.telegram_link_confirm(text, text)  to service_role;
revoke execute on function public.telegram_unlink_by_chat(text)      from public, anon, authenticated;
grant  execute on function public.telegram_unlink_by_chat(text)      to service_role;
