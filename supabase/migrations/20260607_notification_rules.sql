-- Admin-controlled notification policy. Lets an admin decide, org-wide and
-- per-role, which event types notify on which channels. Layered over each
-- user's own per-user channel toggles (notification_preferences).
--
-- Effective decision for (user, event_type, channel):
--   user's own channel toggle (notification_preferences)   -- user opt-out
--   AND notification_allowed(user, event_type, channel)    -- admin cascade:
--         role + exact event  →  role + '*'  →  global + exact event
--         →  global + '*'      →  built-in default (in_app/email on, push off)
-- First matching rule in the cascade wins. No rule anywhere → built-in default,
-- so behaviour is unchanged until an admin sets something.

create table if not exists public.notification_rules (
  scope       text not null check (scope in ('global','role')),
  scope_key   text not null default '',     -- '' for global; role name for role scope
  event_type  text not null,                -- a specific event key, or '*' (all events)
  channel     text not null check (channel in ('in_app','email','web_push')),
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (scope, scope_key, event_type, channel)
);

alter table public.notification_rules enable row level security;

drop policy if exists notification_rules_read on public.notification_rules;
create policy notification_rules_read on public.notification_rules
  for select to authenticated using (true);

drop policy if exists notification_rules_admin_write on public.notification_rules;
create policy notification_rules_admin_write on public.notification_rules
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and (p.role = 'admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and (p.role = 'admin'::public.user_role or p.is_portal_owner)));

-- Resolve the admin cascade for one (user, event, channel).
create or replace function public.notification_allowed(p_user_id uuid, p_event_type text, p_channel text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_enabled boolean;
begin
  select role::text into v_role from public.profiles where id = p_user_id;

  -- role + exact event
  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  -- role + all events
  select enabled into v_enabled from public.notification_rules
    where scope='role' and scope_key = coalesce(v_role,'') and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  -- global + exact event
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = p_event_type and channel = p_channel;
  if found then return v_enabled; end if;
  -- global + all events
  select enabled into v_enabled from public.notification_rules
    where scope='global' and scope_key='' and event_type = '*' and channel = p_channel;
  if found then return v_enabled; end if;
  -- built-in default
  return case when p_channel = 'web_push' then false else true end;
end $$;

-- notify_user now AND-gates in_app / email / web_push through the admin cascade.
-- Telegram is left as a pure per-user toggle (no admin policy / channel not built).
create or replace function public.notify_user(
  p_user_id uuid, p_type text, p_title text,
  p_body text default null, p_url text default null,
  p_module_slug text default null, p_doc_table text default null, p_doc_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_pref record;
begin
  insert into public.notifications(user_id, module_slug, doc_table, doc_id, type, title, body, url)
  values (p_user_id, p_module_slug, p_doc_table, p_doc_id, p_type, p_title, p_body, p_url)
  returning id into v_id;

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
  if v_pref.email and public.notification_allowed(p_user_id, p_type, 'email') then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'email');
  end if;
  if v_pref.telegram then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram');
  end if;
  if v_pref.web_push and public.notification_allowed(p_user_id, p_type, 'web_push') then
    insert into public.notification_deliveries(notification_id, channel) values (v_id,'web_push');
  end if;

  return v_id;
end $$;
