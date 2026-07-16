-- Recycle Bin — module 2: Inventory (items + warehouses).
-- Same pattern as est_rates: soft-delete columns + add tables to the
-- recycle_restore() whitelist. Deletes also set is_active=false (handled in
-- the UI helper) so operational dropdowns that filter is_active exclude them.

alter table public.inv_items
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.inv_warehouses
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create or replace function public.recycle_restore(p_bin_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_row public.recycle_bin;
begin
  v_is_admin := (public.current_user_role() = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner);
  if not v_is_admin then raise exception 'Only an admin can restore items'; end if;

  select * into v_row from public.recycle_bin where id = p_bin_id for update;
  if not found then raise exception 'Recycle item not found'; end if;
  if v_row.restored_at is not null then return jsonb_build_object('ok', true, 'noop', true); end if;

  if v_row.source_table not in ('est_rates', 'inv_items', 'inv_warehouses') then
    raise exception 'Restore not yet supported for %', v_row.source_table;
  end if;

  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', v_row.source_table)
    using v_row.entity_id;

  update public.recycle_bin
     set restored_at = now(), restored_by = auth.uid()
   where id = p_bin_id;

  return jsonb_build_object('ok', true);
end;
$$;
