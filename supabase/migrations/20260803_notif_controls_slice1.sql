-- Notification Controls — Slice 1
--   • Per-user "self-manage" grant: an admin decides who may tune their OWN
--     notifications. Off by default (notifications stay the admin's to set).
--   • Pin approvals ON: a budget moving through the chain must always notify —
--     the global approval_pending rules are forced enabled and locked in the UI.

create table if not exists public.notification_self_manage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now()
);
alter table public.notification_self_manage enable row level security;

drop policy if exists nsm_read on public.notification_self_manage;
create policy nsm_read on public.notification_self_manage for select
  using ((select auth.uid()) = user_id
      or (select role from public.profiles where id = (select auth.uid())) = 'admin');

drop policy if exists nsm_admin_write on public.notification_self_manage;
create policy nsm_admin_write on public.notification_self_manage for all
  using ((select role from public.profiles where id = (select auth.uid())) = 'admin')
  with check ((select role from public.profiles where id = (select auth.uid())) = 'admin');

-- Approvals always notify (bell + email + phone), can't be silenced.
insert into public.notification_rules (scope, scope_key, event_type, channel, enabled)
values ('global','','approval_pending','in_app',true),
       ('global','','approval_pending','email',true),
       ('global','','approval_pending','web_push',true)
on conflict (scope,scope_key,event_type,channel) do update set enabled=true;
