-- ============================================================
-- Approval events: every approve/reject across every module records
-- a row here, with optional comment + attachments. Admin controls
-- per-rule whether the comment or an attachment is REQUIRED.
-- ============================================================

alter table public.approval_rules
  add column if not exists requires_attachment boolean not null default false;
-- requires_remarks already exists from an earlier migration.

create table if not exists public.approval_events (
  id            uuid primary key default gen_random_uuid(),
  module_slug   text not null,
  doc_type      text not null,
  doc_table     text not null,
  doc_id        uuid not null,
  from_stage    text not null,
  to_stage      text not null,
  actor_id      uuid references public.profiles(id) on delete set null,
  decision      text not null check (decision in ('approved','rejected','returned','submitted','cancelled','noted')),
  comment       text,
  attachments   jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists approval_events_doc_idx    on public.approval_events(doc_table, doc_id, created_at desc);
create index if not exists approval_events_module_idx on public.approval_events(module_slug, doc_type, created_at desc);
create index if not exists approval_events_actor_idx  on public.approval_events(actor_id, created_at desc);

alter table public.approval_events enable row level security;

drop policy if exists approval_events_read on public.approval_events;
create policy approval_events_read on public.approval_events
  for select to authenticated using (
    exists (
      select 1 from public.role_permissions rp
      where rp.module_slug = approval_events.module_slug
        and rp.can_view = true
        and rp.role::text = public.effective_user_role(auth.uid(), approval_events.module_slug)::text
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role::text = 'admin' or p.is_portal_owner = true)
    )
  );

drop policy if exists approval_events_insert on public.approval_events;
create policy approval_events_insert on public.approval_events
  for insert to authenticated
  with check (actor_id = auth.uid());

create or replace function public.record_approval_event(
  p_module_slug text,
  p_doc_type    text,
  p_doc_table   text,
  p_doc_id      uuid,
  p_from_stage  text,
  p_to_stage    text,
  p_decision    text,
  p_comment     text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_amount      numeric default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rule record;
  v_id   uuid;
  v_attachment_count int;
begin
  if not public.can_approve(p_module_slug, p_doc_type, p_from_stage, p_to_stage, p_amount) then
    raise exception 'You are not authorised to perform this transition';
  end if;

  select requires_remarks, requires_attachment into v_rule
  from public.approval_rules
  where is_active and module_slug = p_module_slug and doc_type = p_doc_type
    and from_stage = p_from_stage and to_stage = p_to_stage
  limit 1;

  if p_decision in ('approved', 'rejected') then
    if coalesce(v_rule.requires_remarks, false) and (p_comment is null or btrim(p_comment) = '') then
      raise exception 'A comment is required for this approval';
    end if;
    v_attachment_count := coalesce(jsonb_array_length(p_attachments), 0);
    if coalesce(v_rule.requires_attachment, false) and v_attachment_count = 0 then
      raise exception 'An attachment is required for this approval';
    end if;
  end if;

  insert into public.approval_events(
    module_slug, doc_type, doc_table, doc_id, from_stage, to_stage,
    actor_id, decision, comment, attachments
  ) values (
    p_module_slug, p_doc_type, p_doc_table, p_doc_id, p_from_stage, p_to_stage,
    auth.uid(), p_decision, p_comment, coalesce(p_attachments, '[]'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'event_id', v_id);
end $$;

insert into storage.buckets (id, name, public)
values ('approval-attachments', 'approval-attachments', false)
on conflict (id) do nothing;

drop policy if exists "approval_attachments_read" on storage.objects;
create policy "approval_attachments_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'approval-attachments');

drop policy if exists "approval_attachments_write" on storage.objects;
create policy "approval_attachments_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'approval-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "approval_attachments_delete" on storage.objects;
create policy "approval_attachments_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'approval-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and (p.role::text = 'admin' or p.is_portal_owner = true))
    )
  );
