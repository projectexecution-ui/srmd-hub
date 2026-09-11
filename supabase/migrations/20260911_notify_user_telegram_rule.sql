-- Telegram DMs obey the same on/off rules as every other channel.
--
-- Aksha, 11 Sep 2026: "where is telegram option??" — the Messages page could
-- not offer a Telegram switch because notify_user() queued a Telegram delivery
-- for anyone who had linked Telegram, without asking notification_allowed().
-- So a report switched off for Telegram still arrived there. This makes the
-- Telegram branch identical to e-mail and phone: the person's own preference
-- AND the rules (user scope first, then role, then global). Rows are still
-- inserted with no status, exactly as before, so the Telegram sender is unchanged.
--
-- Applied to live via Supabase MCP on 11 Sep 2026 (the GitHub Action does not fire).

create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text default null, p_url text default null,
  p_module_slug text default null, p_doc_table text default null, p_doc_id uuid default null, p_data jsonb default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_pref record; v_mode text;
begin
  insert into public.notifications(user_id, module_slug, doc_table, doc_id, type, title, body, url, data)
  values (p_user_id, p_module_slug, p_doc_table, p_doc_id, p_type, p_title, p_body, p_url, p_data)
  returning id into v_id;

  v_mode := public.notification_mode(p_user_id, p_type);

  select coalesce(in_app,true) as in_app, coalesce(email,true) as email,
         coalesce(telegram,false) as telegram, coalesce(web_push,false) as web_push
    into v_pref
  from public.notification_preferences where user_id = p_user_id;
  if not found then
    v_pref.in_app := true; v_pref.email := true; v_pref.telegram := false; v_pref.web_push := false;
  end if;

  if v_pref.in_app and public.notification_allowed(p_user_id, p_type, 'in_app') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'in_app','sent');
  end if;
  if v_mode <> 'off' and v_pref.email and public.notification_allowed(p_user_id, p_type, 'email') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'email','pending');
  end if;
  -- Was: `if v_pref.telegram then` — no rule check, so no switch could stop it.
  if v_pref.telegram and public.notification_allowed(p_user_id, p_type, 'telegram') then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram');
  end if;
  if v_mode <> 'off' and v_pref.web_push and public.notification_allowed(p_user_id, p_type, 'web_push') then
    insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'web_push','pending');
  end if;

  return v_id;
end $function$;
