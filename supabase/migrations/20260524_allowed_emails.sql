-- ============================================================
-- Allowlist: only pre-approved emails get an active profile on first
-- sign-in. Everyone else lands on the "Account Deactivated" page
-- until an admin adds them.
-- ============================================================

create table if not exists public.allowed_emails (
  email      text primary key,
  role       public.user_role not null default 'viewer',
  added_by   uuid references public.profiles(id) on delete set null,
  added_at   timestamptz not null default now(),
  notes      text
);

create or replace function public.allowed_emails_lowercase()
returns trigger language plpgsql as $$
begin
  new.email := lower(new.email);
  return new;
end $$;

drop trigger if exists trg_allowed_emails_lowercase on public.allowed_emails;
create trigger trg_allowed_emails_lowercase
  before insert or update on public.allowed_emails
  for each row execute function public.allowed_emails_lowercase();

-- ---------- RLS ----------
alter table public.allowed_emails enable row level security;

drop policy if exists allowed_emails_read on public.allowed_emails;
create policy allowed_emails_read
  on public.allowed_emails for select
  to authenticated using (
    email = lower((select email from public.profiles where id = auth.uid()))
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.is_portal_owner = true)
    )
  );

drop policy if exists allowed_emails_write on public.allowed_emails;
create policy allowed_emails_write
  on public.allowed_emails for all
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role = 'admin' or p.is_portal_owner = true))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role = 'admin' or p.is_portal_owner = true))
  );

-- ---------- Bootstrap: don't lock out current active users ----------
insert into public.allowed_emails (email, role, notes)
select lower(email), role, 'auto-added: existing active user at allowlist rollout'
from public.profiles
where is_active = true and email is not null and email not like 'anon-%'
on conflict (email) do nothing;

insert into public.allowed_emails (email, role, notes)
select lower(value), 'admin'::public.user_role, 'pinned admin from app_settings'
from public.app_settings
where key = 'admin_email' and value is not null and value <> ''
on conflict (email) do update set role = excluded.role;

-- ---------- Updated handle_new_user trigger ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_em text;
  v_email text;
  v_name text;
  v_role public.user_role;
  v_active boolean;
  v_allow record;
begin
  select value into admin_em from public.app_settings where key = 'admin_email';

  if new.email is null or new.email = '' then
    -- Anonymous quick sign-in stays admin so the dev workflow works
    v_email := 'anon-' || new.id::text || '@srmd.local';
    v_name := 'Anonymous';
    v_role := 'admin'::public.user_role;
    v_active := true;
  else
    v_email := new.email;
    v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1));

    select role into v_allow from public.allowed_emails where email = lower(v_email);

    if v_allow.role is not null then
      v_role := v_allow.role;
      v_active := true;
    elsif lower(v_email) = lower(admin_em) then
      v_role := 'admin'::public.user_role;
      v_active := true;
    else
      -- Not allowlisted → blocked until admin adds them
      v_role := 'viewer'::public.user_role;
      v_active := false;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, name, role, is_active)
  values (new.id, v_email, v_name, v_name, v_role, v_active)
  on conflict (id) do nothing;
  return new;
end $$;
