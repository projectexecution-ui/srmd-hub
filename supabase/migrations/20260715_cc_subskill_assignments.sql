-- Assign ONE engineer to each sub-skill for its budget working, so nothing
-- is missed. Additive: a brand-new table, no change to existing schema.
create table if not exists public.cc_subskill_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sub_skill_id uuid not null references public.cc_sub_skills(id) on delete cascade,
  engineer_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (project_id, sub_skill_id)
);

create index if not exists cc_ssa_project_idx  on public.cc_subskill_assignments(project_id);
create index if not exists cc_ssa_engineer_idx on public.cc_subskill_assignments(engineer_id);

alter table public.cc_subskill_assignments enable row level security;

-- Management (CC reviewer) sees all; an engineer sees only their own rows.
drop policy if exists cc_ssa_select on public.cc_subskill_assignments;
create policy cc_ssa_select on public.cc_subskill_assignments
  for select to authenticated
  using ( public.fn_cc_is_reviewer(auth.uid()) or engineer_id = auth.uid() );

-- No write policies: every write goes through the SECURITY DEFINER RPC
-- below, which is reviewer-gated.

create or replace function public.cc_set_subskill_engineer(
  p_project uuid, p_sub_skill uuid, p_engineer uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_cc_is_reviewer(auth.uid()) then
    raise exception 'Only Cost Control management can assign engineers';
  end if;
  if p_engineer is null then
    delete from public.cc_subskill_assignments
      where project_id = p_project and sub_skill_id = p_sub_skill;
  else
    insert into public.cc_subskill_assignments (project_id, sub_skill_id, engineer_id, assigned_by)
      values (p_project, p_sub_skill, p_engineer, auth.uid())
    on conflict (project_id, sub_skill_id)
      do update set engineer_id = excluded.engineer_id, assigned_by = auth.uid(), assigned_at = now();
  end if;
end $$;

grant execute on function public.cc_set_subskill_engineer(uuid, uuid, uuid) to authenticated;
