-- Self-service access requests. A non-allowlisted Google sign-in already
-- lands as an inactive profile (handle_new_user). We add a lifecycle marker
-- and notify admins so they can approve + assign a role without pre-adding
-- every email.

alter table public.profiles add column if not exists access_state text;

create or replace function public.notify_admins_of_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.is_active is false
     and new.access_state is null
     and coalesce(new.email, '') not like 'anon-%' then
    begin
      for r in
        select id from public.profiles
        where is_active = true and (role = 'admin'::public.user_role or is_portal_owner = true)
      loop
        perform public.notify_user(
          r.id,
          'access_request',
          'New access request',
          coalesce(new.full_name, new.name, new.email) || ' signed in and is awaiting your approval',
          '/admin/users',
          null, 'profiles', new.id
        );
      end loop;
    exception when others then
      null; -- never break the auth sign-up transaction
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_access_request on public.profiles;
create trigger trg_notify_access_request
  after insert on public.profiles
  for each row execute function public.notify_admins_of_access_request();
