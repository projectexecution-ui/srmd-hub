-- Anonymous quick sign-in used to mint ADMIN profiles ("Anonymous") — full
-- access to confidential figures (Internal Estimate etc.). Kill it:
--   1. any future anonymous signup lands as an INACTIVE viewer;
--   2. existing anon-*@srmd.local admin profiles are demoted + deactivated
--      (17 rows at apply time).
-- The login page's quick sign-in button is removed in the same release.
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
    -- Anonymous sign-in: NO access. (Was admin for dev convenience — that
    -- exposed management-only numbers to anyone tapping the button.)
    v_email := 'anon-' || new.id::text || '@srmd.local';
    v_name := 'Anonymous';
    v_role := 'viewer'::public.user_role;
    v_active := false;
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

-- Demote + deactivate the throwaway anon accounts already created.
update public.profiles
   set role = 'viewer'::public.user_role, is_active = false
 where email like 'anon-%@srmd.local';
