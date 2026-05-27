-- ============================================================
-- Phase 1: Dynamic role management
-- - role_labels.is_active flag enables soft-deletes
-- - admin_add_role(key, label, description) extends the user_role enum
--   and registers the label in one shot.
-- - admin_deactivate_role(key) blocks deactivation if any active user
--   still holds the role; otherwise marks role_labels.is_active = false.
-- - admin_reactivate_role(key) flips it back.
-- ============================================================

alter table public.role_labels
  add column if not exists is_active boolean not null default true;

-- Fill in any missing labels for the four inventory roles that exist
-- in the user_role enum but weren't seeded into role_labels earlier.
insert into public.role_labels (role, label, description) values
  ('backoffice'::public.user_role,        'Backoffice',        'Inventory: first-level approver. Reserves stock on approve.'),
  ('backoffice_backup'::public.user_role, 'Backoffice Backup', 'Acts for Backoffice when primary is unavailable.'),
  ('store_manager'::public.user_role,     'Store Manager',     'Issues material from a warehouse, logs receipts + damage.'),
  ('hop'::public.user_role,               'HoP',               'Inventory: final approver. Emergency bypass authority.')
on conflict (role) do nothing;

create or replace function public.admin_add_role(
  p_key text,
  p_label text,
  p_description text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_caller_ok boolean;
  v_clean_key text := lower(regexp_replace(coalesce(p_key,''), '[^a-z0-9_]', '_', 'g'));
begin
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role::text = 'admin' or p.is_portal_owner = true)
  ) into v_caller_ok;
  if not v_caller_ok then
    raise exception 'Only admin or Portal Owner can add roles';
  end if;

  if v_clean_key = '' then
    raise exception 'Role key required';
  end if;
  if length(p_label) < 1 then
    raise exception 'Role label required';
  end if;

  execute format('alter type public.user_role add value if not exists %L', v_clean_key);

  insert into public.role_labels (role, label, description, is_active)
  values (v_clean_key::public.user_role, p_label, p_description, true)
  on conflict (role) do update
    set label = excluded.label,
        description = coalesce(excluded.description, public.role_labels.description),
        is_active = true;

  return jsonb_build_object('ok', true, 'key', v_clean_key);
end $$;

create or replace function public.admin_deactivate_role(p_key text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_caller_ok boolean;
  v_holders int;
begin
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role::text = 'admin' or p.is_portal_owner = true)
  ) into v_caller_ok;
  if not v_caller_ok then
    raise exception 'Only admin or Portal Owner can deactivate roles';
  end if;

  if p_key in ('admin') then
    raise exception 'Cannot deactivate the admin role';
  end if;

  select count(*) into v_holders
  from public.profiles
  where role::text = p_key and is_active = true;
  if v_holders > 0 then
    raise exception 'Cannot deactivate "%": % active user(s) still hold this role. Reassign them first.', p_key, v_holders;
  end if;

  update public.role_labels set is_active = false where role::text = p_key;
  return jsonb_build_object('ok', true, 'key', p_key);
end $$;

create or replace function public.admin_reactivate_role(p_key text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role::text = 'admin' or p.is_portal_owner = true)
  ) then
    raise exception 'Only admin or Portal Owner can reactivate roles';
  end if;
  update public.role_labels set is_active = true where role::text = p_key;
  return jsonb_build_object('ok', true);
end $$;
