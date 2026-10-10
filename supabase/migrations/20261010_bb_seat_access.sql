-- A desk seat, or owning a bill, is enough to SEE the Bills Approval data.
--
-- Aksha, 10 Oct 2026: "can u check if any other are stuck somewhere like
-- this". They were. The row policies on bb_bills, bb_bill_lines and
-- bb_desk_members all required can_view on the permissions matrix, so a
-- person seated on a desk whose role has no matrix row (Parimal — uploader;
-- the Billing Head account — CT OFC) passed every page gate and then read an
-- EMPTY register; a bill they had just entered came back "not found". The
-- events and documents policies hang off bb_bills, so those vanished too.
-- bb_rpc_add_doc still resolved the desk without the bill, so a Site Head
-- named as owner could not attach the stamped bill. And bb_rpc_my_desks did
-- not count owned bills, so an owner with no seat and no matrix row had no
-- lane, no access and no rows.
--
-- One rule, in one function, used everywhere: matrix view, OR a seat on any
-- desk, OR the owner of a live bill, OR an Atm Head named on a project.

create or replace function public.bb_can_see(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_uid is not null and (
       exists (select 1 from public.role_permissions rp join public.profiles pr on pr.role = rp.role
                where pr.id = p_uid and rp.module_slug = 'bills-booking' and (rp.can_view or rp.can_edit or rp.can_admin))
    or exists (select 1 from public.bb_desk_members m where m.user_id = p_uid)
    or exists (select 1 from public.bb_bills b where b.owner_id = p_uid)
    or exists (select 1 from public.bb_project_desks d where d.atm_head_id = p_uid)
    or exists (select 1 from public.cc_project_approvers a where a.user_id = p_uid and a.role = 'head')
  )
$$;
grant execute on function public.bb_can_see(uuid) to authenticated;

drop policy if exists bb_bills_select on public.bb_bills;
create policy bb_bills_select on public.bb_bills for select to authenticated using (public.bb_can_see());

drop policy if exists bb_bill_lines_select on public.bb_bill_lines;
create policy bb_bill_lines_select on public.bb_bill_lines for select to authenticated using (public.bb_can_see());

drop policy if exists bb_dm_select on public.bb_desk_members;
create policy bb_dm_select on public.bb_desk_members for select to authenticated using (public.bb_can_see());

-- Documents: the desk for THIS bill, owner included.
create or replace function public.bb_rpc_add_doc(p_bill uuid, p_path text, p_name text, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_member boolean;
  v_from public.bb_stage; v_project uuid; v_disc text; v_sub integer;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id into v_from, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill;
  if v_from is null then raise exception 'Bill not found'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and (rp.can_edit or rp.can_admin)) into v_edit;
  select exists (select 1 from public.bb_stage_members(v_from, v_project, v_disc, v_sub, p_bill) m where m = v_actor)
      or exists (select 1 from public.bb_desk_members d where d.user_id = v_actor and d.desk = 'erp')
    into v_member;
  if not (v_edit or v_member) then raise exception 'You do not have permission to attach documents to this bill'; end if;
  if coalesce(btrim(p_path),'') = '' then raise exception 'File is required'; end if;
  insert into public.bb_bill_docs(bill_id, path, name, kind, uploaded_by)
  values (p_bill, p_path, nullif(btrim(p_name),''), nullif(btrim(p_kind),''), v_actor);
  return jsonb_build_object('status','ok');
end $function$;

-- What the app asks about the signed-in person: seats, Atm projects, and now
-- the bills they own.
create or replace function public.bb_rpc_my_desks()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'desks', coalesce((select jsonb_agg(jsonb_build_object(
                 'desk', desk, 'project_id', project_id, 'in4_subproject_id', in4_subproject_id))
               from public.bb_desk_members where user_id = auth.uid()), '[]'::jsonb),
    'atm_subprojects', coalesce((select jsonb_agg(subproject_id)
               from public.bb_project_desks where atm_head_id = auth.uid()), '[]'::jsonb),
    'atm_projects', coalesce((select jsonb_agg(project_id)
               from public.cc_project_approvers where user_id = auth.uid() and role = 'head'), '[]'::jsonb),
    'owned_bills', (select count(*) from public.bb_bills where owner_id = auth.uid()
                     and current_stage not in ('paid', 'rejected'))
  );
$function$;
