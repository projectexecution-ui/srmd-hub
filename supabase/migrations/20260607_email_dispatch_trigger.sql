-- When notify_user() queues an 'email' delivery, relay it to the app's
-- /api/email/send route (which sends via Gmail). Best-effort + exception-safe:
-- never blocks the insert; does nothing until the dispatch URL + secret are
-- configured in app_private_settings.

create or replace function public.dispatch_email_delivery()
returns trigger language plpgsql security definer set search_path = public, net as $$
declare
  v_url text;
  v_secret text;
  v_to text;
  v_subject text;
  v_body text;
  v_link text;
begin
  if new.channel <> 'email' or new.status <> 'pending' then
    return new;
  end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    return new;  -- not configured yet
  end if;

  select n.title, n.body, n.url, coalesce(np.email_address, p.email)
    into v_subject, v_body, v_link, v_to
  from public.notifications n
  join public.profiles p on p.id = n.user_id
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = new.notification_id;

  if v_to is null or v_to = '' or v_to like 'anon-%' then
    update public.notification_deliveries set status = 'skipped' where id = new.id;
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'to', v_to,
                   'subject', coalesce(v_subject, 'CT HUB notification'),
                   'text', coalesce(v_body, ''),
                   'url', v_link,
                   'deliveryId', new.id
                 ),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-internal-secret', v_secret
                 )
    );
    update public.notification_deliveries set status = 'sent', sent_at = now() where id = new.id;
  exception when others then
    update public.notification_deliveries set status = 'failed', error = left(SQLERRM, 300) where id = new.id;
  end;

  return new;
end $$;

drop trigger if exists trg_dispatch_email_delivery on public.notification_deliveries;
create trigger trg_dispatch_email_delivery
  after insert on public.notification_deliveries
  for each row execute function public.dispatch_email_delivery();
