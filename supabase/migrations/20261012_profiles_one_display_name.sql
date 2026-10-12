-- One display name for a person, everywhere (Aksha, 12 Oct 2026: "The names
-- in People of CT Hub i had changed but that is not getting changed across
-- the Hub Why").
--
-- Why: the Users & Roles rename wrote profiles.name only, while 56 database
-- functions (notifications, approvals, bills) and ~60 screen spots read
-- coalesce(full_name, name, …) — the Google sign-in name first. So a rename
-- showed on Users & Roles and nowhere else.
--
-- Fix: a rename now sets full_name too, in the database, so it holds however
-- the name is edited. Sign-in never rewrites full_name (handle_new_user only
-- fills it when the account is first created), so the rename stays.

create or replace function public.fn_profiles_name_is_display_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is distinct from old.name and coalesce(btrim(new.name), '') <> '' then
    new.full_name := btrim(new.name);
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_name_is_display_name on public.profiles;
create trigger trg_profiles_name_is_display_name
  before update of name on public.profiles
  for each row execute function public.fn_profiles_name_is_display_name();

-- The renames already made, carried across. Akshay Parekh's "Test" (7 Jun)
-- is left out on purpose — it reads as a leftover test, not a chosen name.
update public.profiles
   set full_name = btrim(name)
 where coalesce(btrim(name), '') <> ''
   and btrim(name) is distinct from btrim(coalesce(full_name, ''))
   and btrim(name) <> 'Test';
