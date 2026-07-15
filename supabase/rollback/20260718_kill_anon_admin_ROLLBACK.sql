-- Rollback for 20260718_kill_anon_admin: restore the pre-change
-- handle_new_user (anonymous signup → active admin, the old dev-workflow
-- behaviour). NOTE: does NOT re-promote the demoted anon-*@srmd.local
-- profiles — re-promoting throwaway accounts to admin must be a conscious
-- manual step, never automatic.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
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
    -- Anonymous quick sign-in stays admin so existing dev workflow works
    v_email := 'anon-' || new.id::text || '@srmd.local';
    v_name := 'Anonymous';
    v_role := 'admin'::public.user_role;
    v_active := true;
  else
    v_email := new.email;
    v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1));

    -- Look up the allowlist
    select role into v_allow from public.allowed_emails where email = lower(v_email);

    if v_allow.role is not null then
      v_role := v_allow.role;
      v_active := true;
    elsif lower(v_email) = lower(admin_em) then
      -- Configured admin email always gets in
      v_role := 'admin'::public.user_role;
      v_active := true;
    else
      -- Not allowlisted → land on "Account Deactivated" page
      v_role := 'viewer'::public.user_role;
      v_active := false;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, name, role, is_active)
  values (new.id, v_email, v_name, v_name, v_role, v_active)
  on conflict (id) do nothing;
  return new;
end $function$;
