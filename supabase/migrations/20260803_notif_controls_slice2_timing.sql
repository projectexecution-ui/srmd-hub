-- Notification Controls — Slice 2: per-type delivery timing (Instant / Daily / Off)
--
-- Default 'instant' everywhere → with nothing configured, behaviour is exactly
-- today's. Only email + phone are timed; the in-app bell stays a live passive
-- inbox. Approvals are hard-pinned to Instant.
--
--   • notification_schedule (scope/scope_key/event_type → mode) with precedence
--     user → role → global → default 'instant'.
--   • notification_mode(user, type) resolves it (approvals always 'instant').
--   • notify_user now creates email/phone deliveries 'deferred' when mode='daily'
--     (held from the instant dispatch triggers), skips them when 'off'.
--   • notification_send_daily_digests() sweeps each user's deferred items into one
--     digest (sent via the normal instant path) and marks them sent — run once a
--     day by the cron dispatcher (morning slot).

create table if not exists public.notification_schedule (
  scope       text not null,
  scope_key   text not null default '',
  event_type  text not null,
  mode        text not null default 'instant' check (mode in ('instant','daily','off')),
  send_hour   int  not null default 8,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (scope, scope_key, event_type)
);
alter table public.notification_schedule enable row level security;

drop policy if exists nsch_read on public.notification_schedule;
create policy nsch_read on public.notification_schedule for select using (auth.uid() is not null);

drop policy if exists nsch_write on public.notification_schedule;
create policy nsch_write on public.notification_schedule for all
  using ((select role from public.profiles where id = (select auth.uid())) = 'admin'
      or (scope = 'user' and scope_key = (select auth.uid())::text))
  with check ((select role from public.profiles where id = (select auth.uid())) = 'admin'
      or (scope = 'user' and scope_key = (select auth.uid())::text));

create or replace function public.notification_mode(p_user_id uuid, p_event_type text)
 returns text language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_role text; v_mode text;
begin
  if p_event_type = 'approval_pending' then return 'instant'; end if;
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

create or replace function public.notify_user(p_user_id uuid, p_type text, p_title text, p_body text default null::text, p_url text default null::text, p_module_slug text default null::text, p_doc_table text default null::text, p_doc_id uuid default null::uuid, p_data jsonb default null::jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
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
    insert into public.notification_deliveries(notification_id, channel, status)
      values (v_id,'email', case when v_mode='daily' then 'deferred' else 'pending' end);
  end if;
  if v_pref.telegram then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram');
  end if;
  if v_mode <> 'off' and v_pref.web_push and public.notification_allowed(p_user_id, p_type, 'web_push') then
    insert into public.notification_deliveries(notification_id, channel, status)
      values (v_id,'web_push', case when v_mode='daily' then 'deferred' else 'pending' end);
  end if;

  return v_id;
end $function$;

create or replace function public.notification_send_daily_digests()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare u record; itm record; v_lines text; v_count int; n int := 0;
begin
  for u in
    select distinct n2.user_id
    from public.notification_deliveries d
    join public.notifications n2 on n2.id = d.notification_id
    where d.status = 'deferred'
  loop
    select count(distinct n2.id) into v_count
      from public.notification_deliveries d
      join public.notifications n2 on n2.id = d.notification_id
      where d.status='deferred' and n2.user_id = u.user_id;
    if v_count = 0 then continue; end if;

    v_lines := '';
    for itm in
      select distinct n2.id, n2.title, n2.created_at
      from public.notification_deliveries d
      join public.notifications n2 on n2.id = d.notification_id
      where d.status='deferred' and n2.user_id = u.user_id
      order by n2.created_at desc
      limit 15
    loop
      v_lines := v_lines || '• ' || coalesce(itm.title, '(update)') || E'\n';
    end loop;
    if v_count > 15 then v_lines := v_lines || '…and ' || (v_count - 15) || ' more.' || E'\n'; end if;

    perform public.notify_user(
      u.user_id, 'daily_digest',
      'Your daily update — ' || v_count || ' item' || case when v_count = 1 then '' else 's' end,
      v_lines, '/dashboard', null, null, null, null);

    update public.notification_deliveries d set status='sent', sent_at=now()
      from public.notifications n2
      where d.notification_id = n2.id and d.status='deferred' and n2.user_id = u.user_id;
    n := n + 1;
  end loop;
  return n;
end $function$;
