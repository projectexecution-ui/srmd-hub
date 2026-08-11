-- Bills Booking — WO/PO bill tracker to replace Zoho. Phase 1a: record + stage
-- spine + audit + create/move RPCs. Applied live 2026-08-08. Additive only.
create extension if not exists "uuid-ossp";

do $$ begin
  create type public.bb_stage as enum (
    'submitted','site_head','disc_head','ct_head','atm_approval',
    'ct_billing','atm_in4','trust','paid','on_hold','rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.bb_bills (
  id uuid primary key default uuid_generate_v4(),
  order_type text not null default 'WO' check (order_type in ('WO','PO')),
  order_no text, project_id uuid references public.projects(id),
  vendor_id uuid references public.vendors(id), vendor_text text,
  discipline text check (discipline in ('Civil','MEP') or discipline is null),
  work text, bill_no text, ra_no text, bill_date date,
  submitted_on date default (now() at time zone 'Asia/Kolkata')::date,
  claimed_amount numeric not null default 0, certified_amount numeric, net_amount numeric,
  trust text, current_stage public.bb_stage not null default 'submitted',
  stage_since timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists bb_bills_stage_idx on public.bb_bills(current_stage, stage_since);
create index if not exists bb_bills_project_idx on public.bb_bills(project_id);

create table if not exists public.bb_bill_events (
  id uuid primary key default uuid_generate_v4(),
  bill_id uuid not null references public.bb_bills(id) on delete cascade,
  from_stage public.bb_stage, to_stage public.bb_stage, action text not null,
  comment text, amount_snapshot numeric,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
create index if not exists bb_bill_events_bill_idx on public.bb_bill_events(bill_id, created_at);

alter table public.bb_bills enable row level security;
alter table public.bb_bill_events enable row level security;
drop policy if exists bb_bills_select on public.bb_bills;
create policy bb_bills_select on public.bb_bills for select to authenticated using (
  exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id=auth.uid() and rp.role=p.role and rp.module_slug='bills-booking' and rp.can_view=true));
drop policy if exists bb_events_select on public.bb_bill_events;
create policy bb_events_select on public.bb_bill_events for select to authenticated using (
  exists (select 1 from public.bb_bills b where b.id=bill_id));

insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin','bills-booking',true,true,true),('billing','bills-booking',true,true,false),
  ('backoffice','bills-booking',true,true,false),('head','bills-booking',true,true,false),
  ('project_head','bills-booking',true,true,false),('founder','bills-booking',true,false,false)
on conflict do nothing;

-- RPCs: create (ERP entry) + move (with mandatory reason on send-back/hold/reject).
-- Full source lives in the applied migrations bills_booking_foundation / _rpcs.
