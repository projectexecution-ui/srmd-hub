-- ============================================================
-- Inventory — engineer proposes a new item, admin approves
-- ============================================================
-- When the item an engineer needs isn't in the catalogue, they can propose it
-- (name/unit/category). It's created inactive + pending; an admin approves
-- (activates it) or rejects, from Item master. Admins are notified.
-- ============================================================

alter table public.inv_items
  add column if not exists approval_status text not null default 'approved';

do $$ begin
  alter table public.inv_items
    add constraint inv_items_approval_status_chk check (approval_status in ('approved','pending','rejected'));
exception when duplicate_object then null; end $$;

create sequence if not exists public.inv_item_proposal_seq start 1;

-- Engineer/any inventory-edit user proposes a new item (gated by a setting).
create or replace function public.inv_rpc_propose_item(
  p_name text, p_unit text default 'nos', p_category text default null
) returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_allow text; v_code text; v_id uuid; v_r uuid;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles p
                 where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit=true) then
    raise exception 'You do not have permission to request items';
  end if;
  select value into v_allow from public.app_settings where key = 'inv_allow_item_requests';
  if lower(coalesce(nullif(trim(v_allow),''),'true')) not in ('true','1','on') then
    raise exception 'New-item requests are turned off — ask an admin to add it';
  end if;
  if nullif(btrim(coalesce(p_name,'')), '') is null then raise exception 'Enter an item name'; end if;

  v_code := 'NEW-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.inv_item_proposal_seq')::text, 4, '0');
  insert into public.inv_items(code, name, unit, category, is_active, created_by, approval_status)
  values (v_code, btrim(p_name), coalesce(nullif(btrim(p_unit),''),'nos'), nullif(btrim(p_category),''), false, v_actor, 'pending')
  returning id into v_id;

  for v_r in select id from public.profiles where role = 'admin' and is_active = true loop
    perform public.notify_user(v_r, 'inv_item_proposed', 'New item to approve',
      btrim(p_name) || ' was requested — approve it in Item master so it can be used.',
      '/inventory/admin/items', 'inventory', 'inv_items', v_id);
  end loop;

  return jsonb_build_object('status','ok','item_id', v_id, 'code', v_code);
end $$;
grant execute on function public.inv_rpc_propose_item(text,text,text) to authenticated;

-- Admin approves (activates) or rejects a proposed item.
create or replace function public.inv_rpc_review_item(p_item_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer as $$
declare v_actor uuid := auth.uid(); v_ok boolean;
begin
  select (p.role = 'admin') or exists (
    select 1 from public.role_permissions rp where rp.role = p.role and rp.module_slug='inventory' and rp.can_admin=true
  ) into v_ok from public.profiles p where p.id = v_actor;
  if not coalesce(v_ok, false) then raise exception 'Only an admin can review item requests'; end if;

  if p_approve then
    update public.inv_items set approval_status='approved', is_active=true where id = p_item_id;
  else
    update public.inv_items set approval_status='rejected', is_active=false where id = p_item_id;
  end if;
  return jsonb_build_object('status','ok');
end $$;
grant execute on function public.inv_rpc_review_item(uuid,boolean) to authenticated;
