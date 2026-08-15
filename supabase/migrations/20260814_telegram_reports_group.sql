-- Telegram "Reports group": deliver the curated broadcast reports (e.g. the
-- weekly Budget vs Actual portfolio card) to a shared management Telegram GROUP,
-- in addition to the per-person DMs. Approvals / @mentions never go to the group.
--
-- The group is captured by the admin typing /reportshere INSIDE the group (the
-- bot must be a group admin to receive it). We authorise that by the sender's
-- Telegram user id: only MANAGEMENT can link Telegram at all (the Connect card
-- is management-only), so a from_id that matches a linked telegram_chat_id IS a
-- management user. Config lives in app_settings (key/value) — no schema change.

-- Register (called by the webhook, service-role only). Returns the registrant's
-- display name, or null when the sender isn't a linked (management) user.
create or replace function public.telegram_register_reports_group(p_chat_id text, p_title text, p_from_id text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid; v_name text;
begin
  select np.user_id into v_uid
  from public.notification_preferences np
  where np.telegram_chat_id = p_from_id
  limit 1;
  if v_uid is null then return null; end if;

  select coalesce(nullif(btrim(pr.name), ''), nullif(btrim(pr.full_name), ''), pr.email)
    into v_name from public.profiles pr where pr.id = v_uid;

  insert into public.app_settings(key, value) values
    ('telegram_reports_group_chat_id', p_chat_id),
    ('telegram_reports_group_title',   coalesce(p_title, '')),
    ('telegram_reports_group_by',      v_uid::text),
    ('telegram_reports_group_at',      now()::text)
  on conflict (key) do update set value = excluded.value;

  return coalesce(v_name, 'CT Hub');
end
$function$;

-- Unregister from the webhook (/stop typed in the group). Only clears if the
-- stored group IS this chat, and the sender is a linked management user.
create or replace function public.telegram_unregister_reports_group_by_chat(p_chat_id text, p_from_id text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid;
begin
  select np.user_id into v_uid
  from public.notification_preferences np
  where np.telegram_chat_id = p_from_id limit 1;
  if v_uid is null then return false; end if;

  if exists (select 1 from public.app_settings where key = 'telegram_reports_group_chat_id' and value = p_chat_id) then
    delete from public.app_settings where key in
      ('telegram_reports_group_chat_id','telegram_reports_group_title','telegram_reports_group_by','telegram_reports_group_at');
    return true;
  end if;
  return false;
end
$function$;

-- Unregister from the CT Hub Settings "Disconnect" button (admin only, self-auth).
create or replace function public.telegram_unregister_reports_group()
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  delete from public.app_settings where key in
    ('telegram_reports_group_chat_id','telegram_reports_group_title','telegram_reports_group_by','telegram_reports_group_at');
  return true;
end
$function$;

-- Read the current group status for the Settings card (admin only).
create or replace function public.telegram_reports_group_info()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return null;
  end if;
  select jsonb_build_object(
    'chatId', max(value) filter (where key = 'telegram_reports_group_chat_id'),
    'title',  max(value) filter (where key = 'telegram_reports_group_title'),
    'at',     max(value) filter (where key = 'telegram_reports_group_at')
  ) into v
  from public.app_settings
  where key in ('telegram_reports_group_chat_id','telegram_reports_group_title','telegram_reports_group_at');
  return v;
end
$function$;

-- Grants. Register + by_chat unregister are webhook-only (service_role). The
-- self-serve unregister + info self-check admin, so authenticated may call them.
revoke all on function public.telegram_register_reports_group(text, text, text)      from public, anon, authenticated;
revoke all on function public.telegram_unregister_reports_group_by_chat(text, text)  from public, anon, authenticated;
grant  execute on function public.telegram_register_reports_group(text, text, text)      to service_role;
grant  execute on function public.telegram_unregister_reports_group_by_chat(text, text)  to service_role;

revoke all on function public.telegram_unregister_reports_group()  from public, anon;
revoke all on function public.telegram_reports_group_info()        from public, anon;
grant  execute on function public.telegram_unregister_reports_group()  to authenticated, service_role;
grant  execute on function public.telegram_reports_group_info()        to authenticated, service_role;
