-- Project archive → admin-delete workflow.
--
-- A Coordinator (or other CC setup role) who creates a project by mistake can
-- ARCHIVE it (soft — reversible, hides it from active lists) but CANNOT delete.
-- Only an admin / portal owner restores or permanently deletes it. Delete stays
-- the existing dependency-checked hard delete (/api/projects/[id]), re-gated to
-- admin.
alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

create or replace function public.project_set_archived(p_project uuid, p_archived boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_role text; v_po boolean; v_ccrole text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select role::text, coalesce(is_portal_owner, false) into v_role, v_po
    from public.profiles where id = auth.uid();
  v_ccrole := coalesce(public.effective_user_role(auth.uid(), 'cost-control')::text, '');

  if p_archived then
    -- Archive: CC setup/management roles (coordinator, the approver chain) + admins.
    if not (v_role = 'admin' or v_po or v_ccrole in ('coordinator','head','project_head','founder')) then
      raise exception 'You are not allowed to archive projects';
    end if;
    update public.projects set archived_at = now(), archived_by = auth.uid() where id = p_project;
  else
    -- Restore: admin / portal owner only (it comes to you to decide).
    if not (v_role = 'admin' or v_po) then
      raise exception 'Only an admin can restore a project';
    end if;
    update public.projects set archived_at = null, archived_by = null where id = p_project;
  end if;
end
$function$;

grant execute on function public.project_set_archived(uuid, boolean) to authenticated;
