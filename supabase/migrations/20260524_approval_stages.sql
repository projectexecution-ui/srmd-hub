-- ============================================================
-- Stages master per (module, doc_type). Admins manage this list from
-- /admin/approvals; rules then reference stage names from this list.
-- Stage names are still text (and rules still reference them as text)
-- so we don't break the existing RPCs that pass hard-coded strings.
-- ============================================================

create table if not exists public.approval_stages (
  id           uuid primary key default gen_random_uuid(),
  module_slug  text not null,
  doc_type     text not null,
  stage        text not null,
  sequence     int  not null default 0,
  is_initial   boolean not null default false,
  is_terminal  boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  unique (module_slug, doc_type, stage)
);

create index if not exists approval_stages_doc_idx
  on public.approval_stages(module_slug, doc_type, sequence);

alter table public.approval_stages enable row level security;

drop policy if exists approval_stages_read on public.approval_stages;
create policy approval_stages_read on public.approval_stages
  for select to authenticated using (true);

drop policy if exists approval_stages_write on public.approval_stages;
create policy approval_stages_write on public.approval_stages
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and (p.role = 'admin' or p.is_portal_owner = true)))
  with check (exists (select 1 from public.profiles p
                      where p.id = auth.uid()
                        and (p.role = 'admin' or p.is_portal_owner = true)));

create or replace function public.approval_stages_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_approval_stages_touch on public.approval_stages;
create trigger trg_approval_stages_touch
  before insert or update on public.approval_stages
  for each row execute function public.approval_stages_touch();

-- Bootstrap from current approval_rules + known initial/terminal states.
with seed as (
  select module_slug, doc_type, from_stage as stage from public.approval_rules
  union
  select module_slug, doc_type, to_stage as stage from public.approval_rules
  union all
  values
    ('indents'::text,       'indent'::text,           'draft'::text),
    ('inventory'::text,     'inv_request'::text,      'DRAFT'::text),
    ('cost-control'::text,  'cc_working_sheet'::text, 'draft'::text),
    ('inventory'::text,     'inv_request'::text,      'CLOSED'::text),
    ('inventory'::text,     'inv_request'::text,      'CANCELLED_BY_ENGINEER'::text),
    ('cost-control'::text,  'cc_working_sheet'::text, 'cancelled'::text)
)
insert into public.approval_stages (module_slug, doc_type, stage, sequence)
select s.module_slug, s.doc_type, s.stage,
       case
         when lower(s.stage) = 'draft' or s.stage = 'DRAFT' then 0
         when lower(s.stage) like 'pending%' or lower(s.stage) = 'submitted' then 10
         when lower(s.stage) in ('verify','pm_review','flagged') then 20
         when lower(s.stage) in ('approved','pm_approved') or s.stage = 'APPROVED' then 30
         when lower(s.stage) in ('issued','paid','wo_issued') or s.stage in ('ISSUED','EMERGENCY_ISSUED') then 40
         when lower(s.stage) = 'closed' or s.stage = 'CLOSED' then 50
         when lower(s.stage) like 'reject%' or lower(s.stage) like 'cancel%'
              or s.stage = 'CANCELLED_BY_ENGINEER' or s.stage like 'REJECTED_%' then 90
         else 70
       end as sequence
from seed s
on conflict (module_slug, doc_type, stage) do nothing;

update public.approval_stages set is_initial = true
  where (module_slug = 'indents'      and doc_type='indent'            and stage = 'draft')
     or (module_slug = 'inventory'    and doc_type='inv_request'       and stage = 'DRAFT')
     or (module_slug = 'cost-control' and doc_type='cc_working_sheet'  and stage = 'draft')
     or (module_slug = 'jmr'          and doc_type='jmr_entry'         and stage = 'submitted')
     or (module_slug = 'jmr-bills'    and doc_type='jmr_bill'          and stage = 'submitted');

update public.approval_stages set is_terminal = true
  where lower(stage) in ('approved','closed','paid','rejected','cancelled','wo_issued')
     or stage in ('APPROVED','CLOSED','ISSUED','REJECTED_BACKOFFICE','REJECTED_HOP','CANCELLED_BY_ENGINEER','EMERGENCY_ISSUED');
