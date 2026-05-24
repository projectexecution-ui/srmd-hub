-- ============================================================
-- Approval Matrix — one config table for all modules
-- ============================================================
-- Portal Owner / Admin edit "who approves what at which stage" from
-- a single /admin/approvals page. Each module's RPCs call
-- public.can_approve(...) instead of hard-coding role names. Admin is
-- always implicitly allowed.
-- ============================================================

create table if not exists public.approval_rules (
  id              uuid primary key default gen_random_uuid(),
  module_slug     text not null,            -- 'indents','jmr-bills','inventory','cost-control', etc.
  doc_type        text not null,            -- 'indent','jmr_bill','inv_request','cc_working_sheet'
  from_stage      text not null,
  to_stage        text not null,
  approver_role   text not null,            -- references public.user_role value as text
  override_role   text,                     -- optional second role allowed (eg emergency bypass)
  amount_cap_max  numeric,                  -- null = no cap; otherwise only applies when doc total <= cap
  requires_remarks boolean not null default false,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

-- COALESCE in unique constraint is only valid via a unique INDEX.
create unique index if not exists approval_rules_uniq
  on public.approval_rules (
    module_slug, doc_type, from_stage, to_stage, approver_role,
    coalesce(amount_cap_max, -1)
  );

create index if not exists approval_rules_module_doc_idx
  on public.approval_rules(module_slug, doc_type, from_stage, to_stage, is_active);

alter table public.approval_rules enable row level security;

drop policy if exists approval_rules_read on public.approval_rules;
create policy approval_rules_read
  on public.approval_rules for select
  to authenticated using (true);

drop policy if exists approval_rules_write on public.approval_rules;
create policy approval_rules_write
  on public.approval_rules for all
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_portal_owner = true or p.role = 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_portal_owner = true or p.role = 'admin'))
  );

create or replace function public.approval_rules_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_approval_rules_touch on public.approval_rules;
create trigger trg_approval_rules_touch
  before insert or update on public.approval_rules
  for each row execute function public.approval_rules_touch();

-- The one helper every module's RPCs call.
-- Admin is always allowed. amount param lets a module pass doc total so
-- amount_cap_max rules apply (Cost Control style).
create or replace function public.can_approve(
  p_module_slug text,
  p_doc_type    text,
  p_from_stage  text,
  p_to_stage    text,
  p_amount      numeric default null
) returns boolean
language sql stable security definer as $$
  with me as (
    select role::text as role from public.profiles where id = auth.uid()
  )
  select case
    when (select role from me) = 'admin' then true
    when exists (
      select 1 from public.approval_rules ar, me
      where ar.is_active = true
        and ar.module_slug = p_module_slug
        and ar.doc_type    = p_doc_type
        and ar.from_stage  = p_from_stage
        and ar.to_stage    = p_to_stage
        and (me.role = ar.approver_role or me.role = ar.override_role)
        and (ar.amount_cap_max is null or p_amount is null or p_amount <= ar.amount_cap_max)
    ) then true
    else false
  end
$$;

-- Bootstrap rules — encodes current live behaviour so day 1 nothing changes.
insert into public.approval_rules (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, notes) values
  ('indents','indent','submitted','verify',  'head',    'admin', 'Indent verification stage'),
  ('indents','indent','verify','approved',   'founder', 'admin', 'Final indent approval'),
  ('jmr','jmr_entry','submitted','pm_approved','head','admin','PM signs off daily JMR entry'),
  ('jmr','jmr_entry','submitted','flagged',    'head','admin','PM flags a JMR entry for review'),
  ('jmr-bills','jmr_bill','submitted','pm_review',  'head',    'admin', 'Head reviews contractor bill'),
  ('jmr-bills','jmr_bill','pm_review','approved',   'founder', 'admin', 'Founder approves contractor bill'),
  ('jmr-bills','jmr_bill','approved','paid',        'admin',   null,    'Admin marks bill as paid'),
  ('jmr-bills','jmr_bill','pm_review','rejected',   'founder', 'admin', 'Founder can reject after PM review'),
  ('jmr-bills','jmr_bill','submitted','rejected',   'head',    'admin', 'PM can reject directly'),
  ('inventory','inv_request','PENDING_BACKOFFICE','PENDING_HOP',       'backoffice',   'backoffice_backup','Backoffice reserves stock + sends to HoP'),
  ('inventory','inv_request','PENDING_BACKOFFICE','REJECTED_BACKOFFICE','backoffice',  'backoffice_backup','Backoffice rejects'),
  ('inventory','inv_request','PENDING_HOP','APPROVED',                 'hop',          'admin',            'HoP final approval'),
  ('inventory','inv_request','PENDING_HOP','REJECTED_HOP',              'hop',          'admin',            'HoP rejects, releases reservation'),
  ('inventory','inv_request','APPROVED','ISSUED',                       'store_manager','admin',            'Store hands material over'),
  ('inventory','inv_request','EMERGENCY_ISSUED','ISSUED',               'store_manager','admin',            'Store hands material over (post-emergency)'),
  ('inventory','inv_request','PENDING_BACKOFFICE','EMERGENCY_ISSUED',  'hop',          null,               'HoP emergency override — bypass Backoffice')
on conflict do nothing;

insert into public.approval_rules (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, amount_cap_max, notes) values
  ('cost-control','cc_working_sheet','submitted','approved','head',    null,    200000, 'Head approves up to ₹2,00,000'),
  ('cost-control','cc_working_sheet','submitted','approved','founder', 'admin', null,   'Founder approves any amount'),
  ('cost-control','cc_working_sheet','submitted','returned','head',    'founder',null,  'Either Head or Founder can return for changes')
on conflict do nothing;
