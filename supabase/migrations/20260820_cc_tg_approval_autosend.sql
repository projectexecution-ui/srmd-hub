-- Auto-send the interactive Telegram approval card to the current-stage
-- approver the moment a budget reaches them. Tracker prevents duplicates; the
-- resolver mirrors the email trigger's "who approves this stage" logic
-- (advancing transition only, named-approver gate, connected + non-admin).
create table if not exists public.cc_tg_approval_pings (
  id       uuid primary key default gen_random_uuid(),
  ws_id    uuid not null references public.cc_working_sheets(id) on delete cascade,
  stage    text not null,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  sent_at  timestamptz not null default now(),
  unique (ws_id, stage, user_id)
);
alter table public.cc_tg_approval_pings enable row level security;

create or replace function public.cc_tg_stage_approvers(p_ws_id uuid)
returns table(user_id uuid, chat_id text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with w as (
    select id, status::text as st, project_id
    from public.cc_working_sheets
    where id = p_ws_id and archived_at is null
      and coalesce(summary_notes, '') not like '[IB%'
      and status::text in ('submitted','ph_approved','atm_approved','partially_approved')
  )
  select distinct p.id, np.telegram_chat_id
  from w
  join public.approval_rules ar
    on ar.is_active and ar.module_slug = 'cost-control' and ar.doc_type = 'cc_working_sheet'
   and ar.from_stage = w.st
   and ( (w.st = 'submitted'          and ar.to_stage = 'ph_approved')
      or (w.st = 'ph_approved'        and ar.to_stage = 'atm_approved')
      or (w.st = 'atm_approved'       and ar.to_stage in ('approved','partially_approved'))
      or (w.st = 'partially_approved' and ar.to_stage = 'approved') )
  join public.profiles p on p.is_active
  join public.notification_preferences np
    on np.user_id = p.id and np.telegram is true and np.telegram_chat_id is not null
  where (public.effective_user_role(p.id,'cost-control')::text = ar.approver_role
      or public.effective_user_role(p.id,'cost-control')::text = ar.override_role)
    and public.effective_user_role(p.id,'cost-control')::text <> 'admin'
    and ( exists (select 1 from public.cc_project_approvers pa
                   where pa.project_id = w.project_id and pa.role = ar.approver_role and pa.user_id = p.id)
       or not exists (select 1 from public.cc_project_approvers pa2
                       where pa2.project_id = w.project_id and pa2.role = ar.approver_role) );
$$;

revoke all on function public.cc_tg_stage_approvers(uuid) from public;
grant execute on function public.cc_tg_stage_approvers(uuid) to service_role;
