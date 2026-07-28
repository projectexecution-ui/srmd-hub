-- Auto-enable a discipline + sub-skill for a project when a Budget Request is
-- raised against them — so the Raise Budget Request dropdowns can offer the FULL
-- catalogue and "just work" without a separate per-project setup step.
-- SECURITY DEFINER because cc_project_disciplines / cc_project_sub_skills writes
-- are admin/PM-only; here we authorize by "is a Cost Control editor" (the same
-- people who can raise a request). Idempotent: re-enables a disabled row,
-- no-ops an already-enabled one.
create or replace function public.cc_ensure_project_scope(
  p_project uuid, p_discipline uuid, p_sub_skill uuid
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.fn_cc_can_edit(auth.uid()) then
    raise exception 'You do not have edit access to Cost Control';
  end if;
  if p_project is null or p_discipline is null then
    return;
  end if;

  insert into public.cc_project_disciplines (project_id, discipline_id, is_enabled, enabled_by)
  values (p_project, p_discipline, true, auth.uid())
  on conflict (project_id, discipline_id) do update set is_enabled = true;

  if p_sub_skill is not null then
    insert into public.cc_project_sub_skills (project_id, sub_skill_id, is_enabled, enabled_by)
    values (p_project, p_sub_skill, true, auth.uid())
    on conflict (project_id, sub_skill_id) do update set is_enabled = true;
  end if;
end $function$;
