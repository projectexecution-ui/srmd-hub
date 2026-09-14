-- Bills Approval gets its own projects, with their own desks.
--
-- Aksha, 14 Sep 2026: "For no Projects in CT Hub — i said u can make one in
-- Bills Approval and i will assign the Eng and Atm head and all desks for
-- those and keep it copyable."
--
-- What was built this morning was half of that: bb_project_desks could hold a
-- CT Hub project and an Atm Head, and nothing else. The whole flow needs every
-- desk — ERP entry, Site Head (the Eng), Civil and MEP, CT Head, Billing — and
-- for 32 of the 54 IN4 sub-projects there is no CT Hub project to hang them
-- off. Those 32 carry 887 of the 1,228 numbered work orders.
--
-- So a desk row can now be keyed on an IN4 sub-project instead of a CT Hub
-- project, and the three-level fallback becomes:
--
--     the sub-project's own desk  →  the CT Hub project's desk  →  the default
--
-- Nothing that exists today changes meaning: every current row has
-- in4_subproject_id null and keeps behaving exactly as before.

alter table public.bb_desk_members
  add column if not exists in4_subproject_id integer;

comment on column public.bb_desk_members.in4_subproject_id is
  'Set when this desk belongs to a Bills Approval project (an IN4 sub-project CT Hub has no project for). Mutually exclusive with project_id.';

-- One person sits at one desk once, per scope. Partial indexes because a null
-- never equals a null and a plain unique would let the same person be added
-- twice to the same global desk.
create unique index if not exists bb_desk_members_sub_idx
  on public.bb_desk_members (desk, in4_subproject_id, user_id)
  where in4_subproject_id is not null;
create unique index if not exists bb_desk_members_proj_idx
  on public.bb_desk_members (desk, project_id, user_id)
  where project_id is not null and in4_subproject_id is null;
create unique index if not exists bb_desk_members_global_idx
  on public.bb_desk_members (desk, user_id)
  where project_id is null and in4_subproject_id is null;

-- A Bills Approval project can be given a short name of its own, because
-- "Staff Facilities Block - Execution" is IN4's mouthful, not ours.
alter table public.bb_project_desks
  add column if not exists short_name text;

-- ── who sits at a desk ────────────────────────────────────────────────────
-- Replaced rather than overloaded: two functions of the same name with
-- different arity make every PostgREST call ambiguous.
drop function if exists public.bb_desk_members_for(text, uuid);

create or replace function public.bb_desk_members_for(
  p_desk text, p_project uuid, p_subproject integer default null)
returns setof uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  -- The sub-project's own desk wins: somebody set it for this building
  -- specifically, which is more deliberate than the project default.
  if p_subproject is not null and exists (
       select 1 from public.bb_desk_members
       where desk = p_desk and in4_subproject_id = p_subproject) then
    return query select user_id from public.bb_desk_members
      where desk = p_desk and in4_subproject_id = p_subproject;
  elsif p_project is not null and exists (
       select 1 from public.bb_desk_members
       where desk = p_desk and project_id = p_project) then
    return query select user_id from public.bb_desk_members
      where desk = p_desk and project_id = p_project;
  else
    return query select user_id from public.bb_desk_members
      where desk = p_desk and project_id is null and in4_subproject_id is null;
  end if;
end $function$;

-- ── which people a stage routes to ────────────────────────────────────────
drop function if exists public.bb_stage_members(bb_stage, uuid, text);

create or replace function public.bb_stage_members(
  p_stage bb_stage, p_project uuid, p_disc text, p_subproject integer default null)
returns setof uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if p_stage = 'submitted' then
    return query select * from public.bb_desk_members_for('erp', p_project, p_subproject);
  elsif p_stage = 'site_head' then
    return query select * from public.bb_desk_members_for('site_head', p_project, p_subproject);
  elsif p_stage = 'disc_head' then
    -- p_disc is still not used to pick a side; both heads get it. Narrowing
    -- that needs a category-to-side map Aksha has not settled.
    return query select * from public.bb_desk_members_for('disc_head_civil', p_project, p_subproject)
                  union select * from public.bb_desk_members_for('disc_head_mep', p_project, p_subproject);
  elsif p_stage = 'ct_head' then
    return query select * from public.bb_desk_members_for('ct_head', p_project, p_subproject);
  elsif p_stage in ('ct_billing','trust') then
    return query select * from public.bb_desk_members_for('ct_billing', p_project, p_subproject);
  elsif p_stage in ('atm_approval','atm_in4') then
    -- The Atm Head named on the Bills Approval project comes first. Before
    -- this, the Atm desk read cc_project_approvers alone, so a bill with no CT
    -- Hub project could never reach anybody however carefully the desk was
    -- filled in — which was most of the money.
    if p_subproject is not null and exists (
         select 1 from public.bb_project_desks
         where subproject_id = p_subproject and atm_head_id is not null) then
      return query select atm_head_id from public.bb_project_desks
        where subproject_id = p_subproject and atm_head_id is not null;
    elsif p_project is not null then
      return query select user_id from public.cc_project_approvers
        where project_id = p_project and role = 'head';
    end if;
  end if;
  return;
end $function$;

-- ── adding and removing a desk member ─────────────────────────────────────
drop function if exists public.bb_rpc_add_desk_member(text, uuid, uuid);
drop function if exists public.bb_rpc_remove_desk_member(text, uuid, uuid);

create or replace function public.bb_rpc_add_desk_member(
  p_desk text, p_project uuid, p_user uuid, p_subproject integer default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = auth.uid() and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can change desks';
  end if;
  -- A desk belongs to a sub-project or to a project, never to both.
  insert into public.bb_desk_members(desk, project_id, in4_subproject_id, user_id, updated_by)
  values (p_desk,
          case when p_subproject is null then p_project else null end,
          p_subproject, p_user, auth.uid())
  on conflict do nothing;
end $function$;

create or replace function public.bb_rpc_remove_desk_member(
  p_desk text, p_project uuid, p_user uuid, p_subproject integer default null)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = auth.uid() and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can change desks';
  end if;
  delete from public.bb_desk_members
  where desk = p_desk and user_id = p_user
    and ((p_subproject is not null and in4_subproject_id = p_subproject)
      or (p_subproject is null and in4_subproject_id is null and project_id is not distinct from p_project));
end $function$;

-- ── copy one Bills Approval project's desks onto another ──────────────────
-- "keep it copyable" — Raj Uphaar alone is five sub-projects that all want the
-- same five people, and typing them five times is how one of them ends up
-- different by accident.
create or replace function public.bb_rpc_copy_desks(
  p_to_subproject integer, p_from_subproject integer default null, p_from_project uuid default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = auth.uid() and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can change desks';
  end if;
  if p_to_subproject is null then raise exception 'No Bills Approval project to copy onto'; end if;
  if p_from_subproject is null and p_from_project is null then
    raise exception 'Nothing to copy from';
  end if;

  -- Replace rather than merge: "copy the desks from Raj Uphaar" means this
  -- ends up looking like Raj Uphaar, not like both.
  delete from public.bb_desk_members where in4_subproject_id = p_to_subproject;

  insert into public.bb_desk_members(desk, in4_subproject_id, user_id, updated_by)
  select m.desk, p_to_subproject, m.user_id, auth.uid()
  from public.bb_desk_members m
  where (p_from_subproject is not null and m.in4_subproject_id = p_from_subproject)
     or (p_from_subproject is null and m.project_id = p_from_project and m.in4_subproject_id is null)
  on conflict do nothing;
  get diagnostics v_n = row_count;

  -- The Atm Head travels with the desks when the source is another Bills
  -- Approval project; a CT Hub project keeps its head in cc_project_approvers
  -- and that is read live, so there is nothing to copy.
  if p_from_subproject is not null then
    update public.bb_project_desks d
       set atm_head_id = src.atm_head_id, updated_at = now()
      from public.bb_project_desks src
     where src.subproject_id = p_from_subproject
       and d.subproject_id = p_to_subproject
       and src.atm_head_id is not null;
  end if;

  return v_n;
end $function$;

grant execute on function public.bb_desk_members_for(text, uuid, integer) to authenticated;
grant execute on function public.bb_stage_members(bb_stage, uuid, text, integer) to authenticated;
grant execute on function public.bb_rpc_add_desk_member(text, uuid, uuid, integer) to authenticated;
grant execute on function public.bb_rpc_remove_desk_member(text, uuid, uuid, integer) to authenticated;
grant execute on function public.bb_rpc_copy_desks(integer, integer, uuid) to authenticated;
