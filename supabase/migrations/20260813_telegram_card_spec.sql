-- Pass the report's full-detail text (data.report_text) and the rich card spec
-- (data.card_spec) to /api/telegram/send, so the Telegram image can carry the
-- complete, email-matching breakdown. Everything else is unchanged from the
-- 20260813_telegram_card_type version.
create or replace function public.dispatch_telegram_delivery_now(p_delivery_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare
  v_url text; v_secret text; v_chat text; v_title text; v_body text; v_link text; v_type text;
  v_cardtext text; v_cardspec jsonb;
  v_channel text; v_notif uuid;
begin
  select channel, notification_id into v_channel, v_notif
    from public.notification_deliveries where id = p_delivery_id;
  if v_channel is null or v_channel <> 'telegram' then return; end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    update public.notification_deliveries
      set error = 'dispatch config missing', dispatched_at = now()
      where id = p_delivery_id;
    return;
  end if;
  v_url := replace(v_url, 'email/send', 'telegram/send');

  select n.title, n.body, n.url, n.type, n.data->>'report_text', n.data->'card_spec', np.telegram_chat_id
    into v_title, v_body, v_link, v_type, v_cardtext, v_cardspec, v_chat
  from public.notifications n
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = v_notif;

  if v_chat is null or v_chat = '' then
    update public.notification_deliveries set status = 'skipped', error = 'telegram not linked'
      where id = p_delivery_id;
    return;
  end if;

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
                   'type', v_type,
                   'cardText', v_cardtext,
                   'cardSpec', v_cardspec,
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
