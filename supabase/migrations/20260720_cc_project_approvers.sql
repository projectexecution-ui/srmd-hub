-- Per-project approvers: who is the Project Head / Atm Head / Trustee FOR
-- THIS project. Today approvals are role-global (any 'head' approves every
-- project); this table lets management name approvers per project so Phase 2
-- can scope queues + approve rights to them. Additive + non-breaking.
create table if not exists public.cc_project_approvers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Which chain stage this person covers on this project.
  role text not null check (role in ('project_head','head','founder')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (project_id, role, user_id)
);
create index if not exists cc_pa_project_idx on public.cc_project_approvers(project_id);
create index if not exists cc_pa_user_idx on public.cc_project_approvers(user_id);

alter table public.cc_project_approvers enable row level security;

-- Management sees the whole roster; an approver can see their own rows.
drop policy if exists cc_pa_select on public.cc_project_approvers;
create policy cc_pa_select on public.cc_project_approvers
  for select to authenticated
  using ( public.fn_cc_is_reviewer(auth.uid()) or user_id = auth.uid() );

-- Writes only through the reviewer-gated RPC (no direct write policies).
create or replace function public.cc_set_project_approver(
  p_project uuid, p_role text, p_user uuid, p_add boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_cc_is_reviewer(auth.uid()) then
    raise exception 'Only Cost Control management can set project approvers';
  end if;
  if p_role not in ('project_head','head','founder') then
    raise exception 'Unknown approver role';
  end if;
  if p_add then
    insert into public.cc_project_approvers (project_id, role, user_id, assigned_by)
      values (p_project, p_role, p_user, auth.uid())
    on conflict (project_id, role, user_id) do nothing;
  else
    delete from public.cc_project_approvers
      where project_id = p_project and role = p_role and user_id = p_user;
  end if;
end $$;

grant execute on function public.cc_set_project_approver(uuid, text, uuid, boolean) to authenticated;
