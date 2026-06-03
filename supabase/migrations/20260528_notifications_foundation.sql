-- Hub-wide notifications + multi-channel preferences.
-- One row per (user × event) in public.notifications.
-- public.notification_deliveries tracks delivery per channel
-- (in_app / email / telegram / web_push) so workers can retry.
-- public.push_subscriptions stores Web Push endpoints per user.
-- public.notification_preferences holds per-user channel toggles.
--
-- Trigger trg_notify_on_approval_event on approval_events fires
-- notify_user() for everyone whose effective role can act on the
-- transition out of the doc's new stage.
--
-- Realtime is enabled on `notifications` so the in-app bell subscribes
-- and live-updates without polling.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  module_slug text,
  doc_table   text,
  doc_id      uuid,
  type        text not null,
  title       text not null,
  body        text,
  url         text,
  is_read     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, is_read, created_at desc);
create index if not exists notifications_doc_idx on public.notifications(doc_table, doc_id);

alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.notification_preferences (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  in_app            boolean not null default true,
  email             boolean not null default true,
  email_address     text,
  telegram          boolean not null default false,
  telegram_chat_id  text,
  web_push          boolean not null default false,
  digest_only       boolean not null default false,
  updated_at        timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
drop policy if exists notification_preferences_self on public.notification_preferences;
create policy notification_preferences_self on public.notification_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_self on public.push_subscriptions;
create policy push_subscriptions_self on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel         text not null check (channel in ('in_app','email','telegram','web_push')),
  status          text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists notif_del_pending_idx
  on public.notification_deliveries(channel, status, created_at)
  where status = 'pending';
alter table public.notification_deliveries enable row level security;
drop policy if exists notif_del_read_self on public.notification_deliveries;
create policy notif_del_read_self on public.notification_deliveries
  for select to authenticated using (
    exists (select 1 from public.notifications n where n.id = notification_id and n.user_id = auth.uid())
  );

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
  if v_pref.in_app   is null then v_pref.in_app   := true;  end if;
  if v_pref.email    is null then v_pref.email    := true;  end if;
  if v_pref.telegram is null then v_pref.telegram := false; end if;
  if v_pref.web_push is null then v_pref.web_push := false; end if;

  if v_pref.in_app   then insert into public.notification_deliveries(notification_id, channel, status) values (v_id,'in_app','sent'); end if;
  if v_pref.email    then insert into public.notification_deliveries(notification_id, channel) values (v_id,'email');    end if;
  if v_pref.telegram then insert into public.notification_deliveries(notification_id, channel) values (v_id,'telegram'); end if;
  if v_pref.web_push then insert into public.notification_deliveries(notification_id, channel) values (v_id,'web_push'); end if;

  return v_id;
end $$;

create or replace function public.notify_on_approval_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor record; v_recipient uuid; v_summary text; v_url text;
begin
  select coalesce(name, full_name, email) as label into v_actor from public.profiles where id = new.actor_id;
  v_summary := coalesce(v_actor.label, 'Someone')
            || ' ' || new.decision
            || ' a ' || new.doc_type
            || ' (' || new.from_stage || ' → ' || new.to_stage || ')';
  v_url := '/approvals';

  for v_recipient in
    select distinct p.id
    from public.profiles p, public.approval_rules ar
    where p.is_active = true and ar.is_active = true
      and ar.module_slug = new.module_slug and ar.doc_type = new.doc_type
      and ar.from_stage = new.to_stage
      and (
        public.effective_user_role(p.id, ar.module_slug)::text = ar.approver_role
        or public.effective_user_role(p.id, ar.module_slug)::text = ar.override_role
      )
      and p.id <> coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform public.notify_user(
      v_recipient, 'approval_pending',
      'Action needed: ' || new.doc_type, v_summary, v_url,
      new.module_slug, new.doc_table, new.doc_id
    );
  end loop;

  return new;
end $$;

drop trigger if exists trg_notify_on_approval_event on public.approval_events;
create trigger trg_notify_on_approval_event
  after insert on public.approval_events
  for each row execute function public.notify_on_approval_event();

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
