-- Internal Estimate revision governance. The Internal Estimate is a locked
-- baseline; to change it, Atm Head / Project Head request a reopen, the
-- Trustee approves, they upload a revised Internal Budget Excel, and the
-- Trustee reviews + approves — only then does a re-import replace the numbers.
-- Applied to prod via MCP on 2026-07-14.

create table if not exists public.cc_ie_revisions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  status        text not null default 'reopen_requested',
  request_note  text,
  requested_by  uuid,
  requested_at  timestamptz not null default now(),
  reopen_by     uuid,
  reopen_at     timestamptz,
  reopen_note   text,
  revised_excel_url  text,
  revised_excel_name text,
  submitted_by  uuid,
  submitted_at  timestamptz,
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  reimport_summary jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists cc_ie_revisions_project_status_idx
  on public.cc_ie_revisions (project_id, status);

alter table public.cc_ie_revisions enable row level security;

drop policy if exists cc_ie_revisions_read on public.cc_ie_revisions;
create policy cc_ie_revisions_read on public.cc_ie_revisions
  for select to authenticated
  using (exists (
    select 1 from public.role_permissions rp, public.profiles p
    where p.id = auth.uid() and rp.role = p.role
      and rp.module_slug = 'cost-control' and rp.can_view = true));

create or replace function public.cc_ie_lock_state(p_project uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case r.status
       when 'reopen_requested'   then 'reopen_requested'
       when 'reopen_approved'    then 'unlocked'
       when 'revision_submitted' then 'revision_submitted'
       else 'locked' end
     from public.cc_ie_revisions r
     where r.project_id = p_project
     order by r.created_at desc limit 1),
    'locked');
$$;

create or replace function public.cc_ie_request_reopen(p_project uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid; v_state text;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'head', 'project_head') then
    raise exception 'Only the Atm Head, Project Head or an Admin can request a revision';
  end if;
  v_state := public.cc_ie_lock_state(p_project);
  if v_state <> 'locked' then raise exception 'A revision is already in progress for this project'; end if;
  insert into public.cc_ie_revisions (project_id, status, request_note, requested_by)
  values (p_project, 'reopen_requested', p_note, auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cc_ie_decide_reopen(p_revision uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'founder') then
    raise exception 'Only the Trustee or an Admin can approve reopening the Internal Estimate';
  end if;
  update public.cc_ie_revisions
     set status = case when p_approve then 'reopen_approved' else 'reopen_denied' end,
         reopen_by = auth.uid(), reopen_at = now(), reopen_note = p_note
   where id = p_revision and status = 'reopen_requested';
  if not found then raise exception 'Request is not awaiting a reopen decision'; end if;
  return jsonb_build_object('ok', true, 'approved', p_approve);
end $$;

create or replace function public.cc_ie_submit_revision(p_revision uuid, p_url text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'head', 'project_head') then
    raise exception 'Only the Atm Head, Project Head or an Admin can submit the revised sheet';
  end if;
  update public.cc_ie_revisions
     set status = 'revision_submitted', revised_excel_url = p_url,
         revised_excel_name = p_name, submitted_by = auth.uid(), submitted_at = now()
   where id = p_revision and status = 'reopen_approved';
  if not found then raise exception 'Reopen must be approved before submitting the revised sheet'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_ie_decide_revision(p_revision uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'founder') then raise exception 'Only the Trustee or an Admin can reject the revision'; end if;
  update public.cc_ie_revisions
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_revision and status = 'revision_submitted';
  if not found then raise exception 'No submitted revision to reject'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_ie_finalize(p_revision uuid, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  if v_role not in ('admin', 'founder') then raise exception 'Only the Trustee or an Admin can approve the revision'; end if;
  update public.cc_ie_revisions
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), reimport_summary = p_summary
   where id = p_revision and status = 'revision_submitted';
  if not found then raise exception 'No submitted revision to approve'; end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.cc_ie_lock_state(uuid) to authenticated;
grant execute on function public.cc_ie_request_reopen(uuid, text) to authenticated;
grant execute on function public.cc_ie_decide_reopen(uuid, boolean, text) to authenticated;
grant execute on function public.cc_ie_submit_revision(uuid, text, text) to authenticated;
grant execute on function public.cc_ie_decide_revision(uuid, text) to authenticated;
grant execute on function public.cc_ie_finalize(uuid, jsonb) to authenticated;
