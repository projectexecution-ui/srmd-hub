-- ============================================================
-- Phase 2: Delete-with-approval
-- ============================================================
-- role_permissions gains two columns: delete_mode + delete_approver_role.
-- delete_mode: 'none' (cannot delete), 'direct' (immediate), 'request'
-- (must file a request, an approver acts on it).
-- delete_requests holds pending requests for the inbox.
-- ============================================================

do $$ begin
  create type public.delete_mode as enum ('none', 'direct', 'request');
exception when duplicate_object then null;
end $$;

alter table public.role_permissions
  add column if not exists delete_mode public.delete_mode not null default 'none',
  add column if not exists delete_approver_role text;

-- Backfill: roles that already have admin → keep "direct" delete
update public.role_permissions
  set delete_mode = 'direct'
where can_admin = true and delete_mode = 'none';

do $$ begin
  create type public.delete_request_status as enum ('pending','approved','rejected','cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.delete_requests (
  id              uuid primary key default gen_random_uuid(),
  module_slug     text not null,
  doc_table       text not null,
  doc_id          uuid not null,
  doc_label       text,
  requested_by    uuid not null references public.profiles(id) on delete set null,
  reason          text,
  status          public.delete_request_status not null default 'pending',
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now()
);

create index if not exists delete_requests_status_idx on public.delete_requests(status, created_at desc);
create index if not exists delete_requests_module_idx on public.delete_requests(module_slug, status);

alter table public.delete_requests enable row level security;

drop policy if exists delete_requests_read on public.delete_requests;
create policy delete_requests_read on public.delete_requests
  for select to authenticated using (
    requested_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role::text = 'admin' or p.is_portal_owner = true)
    )
    or exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid()
        and rp.role::text = public.effective_user_role(auth.uid(), delete_requests.module_slug)::text
        and rp.module_slug = delete_requests.module_slug
        and rp.delete_approver_role is not null
        and rp.delete_approver_role = p.role::text
    )
  );

drop policy if exists delete_requests_insert on public.delete_requests;
create policy delete_requests_insert on public.delete_requests
  for insert to authenticated
  with check (requested_by = auth.uid());

drop policy if exists delete_requests_update_admin on public.delete_requests;
create policy delete_requests_update_admin on public.delete_requests
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role::text = 'admin' or p.is_portal_owner = true))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.role::text = 'admin' or p.is_portal_owner = true))
  );

create or replace function public.can_delete(p_module_slug text)
returns public.delete_mode
language sql stable security definer
set search_path = public
as $$
  with me as (
    select public.effective_user_role(auth.uid(), p_module_slug)::text as role
  )
  select coalesce(
    case when (select role from me) = 'admin' then 'direct'::public.delete_mode end,
    (select rp.delete_mode from public.role_permissions rp, me
       where rp.module_slug = p_module_slug
         and rp.role::text = me.role
       limit 1),
    'none'::public.delete_mode
  )
$$;

create or replace function public.file_delete_request(
  p_module_slug text,
  p_doc_table   text,
  p_doc_id      uuid,
  p_doc_label   text,
  p_reason      text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_mode public.delete_mode;
  v_id   uuid;
begin
  v_mode := public.can_delete(p_module_slug);
  if v_mode = 'none' then
    raise exception 'You are not allowed to delete in this module';
  end if;
  if v_mode = 'direct' then
    raise exception 'Use direct delete — no approval needed for your role';
  end if;
  insert into public.delete_requests(module_slug, doc_table, doc_id, doc_label, requested_by, reason)
  values (p_module_slug, p_doc_table, p_doc_id, p_doc_label, auth.uid(), p_reason)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end $$;

create or replace function public.act_on_delete_request(
  p_request_id uuid,
  p_decision   text,
  p_reason     text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_request record;
  v_role text;
  v_ok boolean;
begin
  select * into v_request from public.delete_requests where id = p_request_id;
  if v_request.id is null then raise exception 'Request not found'; end if;
  if v_request.status != 'pending' then
    raise exception 'Request already decided (%)', v_request.status;
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  v_role := public.effective_user_role(auth.uid(), v_request.module_slug)::text;
  select (v_role = 'admin')
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner = true)
      or exists (
        select 1 from public.role_permissions rp
        where rp.module_slug = v_request.module_slug
          and rp.role::text = v_role
          and rp.delete_approver_role = v_role
      )
    into v_ok;
  if not v_ok then
    raise exception 'You are not the approver for this delete request';
  end if;
  update public.delete_requests
     set status = p_decision::public.delete_request_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_reason = p_reason
   where id = p_request_id;
  return jsonb_build_object('ok', true, 'status', p_decision);
end $$;
