-- Bills Approval: stop asking for what the work order already says.
--
-- Aksha, 14 Sep 2026: the whole "Where it books" step should map itself. The
-- work order carries the project, the scope and the category; making somebody
-- pick them again is both slower and a chance to pick wrong.
--
-- It maps for 285 of the 1,082 work orders that have been billed. The chain is
-- in4_subproject_links → cc_bph_project_links → projects. The other 797 belong
-- to IN4 sub-projects that have no CT Hub project at all — Raj Uphaar,
-- Warehouse, Staff Facilities Block, Common Facility Block and DN Extension
-- among them, which is most of the money. Forcing a dropdown for those means
-- either filing the bill against the wrong building or not filing it.
--
-- So Bills Approval keeps its own desk for an IN4 sub-project: optionally
-- pointed at a CT Hub project once one exists, and carrying the Atm Head who
-- approves bills on it. Set once per sub-project, by an admin, and every bill
-- after that resolves without a question.

alter table public.in4_work_orders
  add column if not exists work_description text;

comment on column public.in4_work_orders.work_description is
  'ENGG_WORK_ORDER.WORK_DESCRIPTION — present on 2,176 of 2,181 work orders, so the scope is read, never typed.';

create table if not exists public.bb_project_desks (
  -- IN4's sub-project is the key, not the project: a report''s top-level
  -- project is an IN4 grouping. "Raj Uphaar" contains Raj Saurabh and Common
  -- Facility Block, and keying on it would put ~₹25 Cr on the wrong building.
  subproject_id   integer primary key,
  -- Copied at the moment the desk is created, so the record of what was
  -- decided does not change if IN4 renames the sub-project later.
  in4_name        text not null,
  -- Set only when a real CT Hub project exists for it. Null is the normal
  -- state for the 797, and is not an error.
  cc_project_id   uuid references public.projects(id) on delete set null,
  -- Who sanctions bills on this sub-project. Without it a bill can still be
  -- entered and checked; it simply has nobody to go to at the Atm desk, and
  -- the screens say so rather than hiding the bill.
  atm_head_id     uuid references public.profiles(id) on delete set null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists bb_project_desks_cc_idx on public.bb_project_desks (cc_project_id);
create index if not exists bb_project_desks_atm_idx on public.bb_project_desks (atm_head_id);

-- A bill remembers which IN4 sub-project it came from regardless of whether a
-- CT Hub project was ever attached, so the link survives the project being
-- created later.
alter table public.bb_bills
  add column if not exists in4_subproject_id integer;
create index if not exists bb_bills_in4_subproject_idx on public.bb_bills (in4_subproject_id);

alter table public.bb_project_desks enable row level security;

-- Admin only, like the rest of the section. Unlike bb_sanctions this one IS
-- editable: it is a setting, not evidence — a project gets created in CT Hub,
-- or an Atm Head changes, and the desk has to follow.
drop policy if exists bb_project_desks_all on public.bb_project_desks;
create policy bb_project_desks_all on public.bb_project_desks for all to authenticated
using (
  exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'bills-booking' and rp.can_admin = true))
with check (
  exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'bills-booking' and rp.can_admin = true));

comment on table public.bb_project_desks is
  'Where an IN4 sub-project books, and who approves it, when CT Hub has no project for it. Keyed on sub-project because IN4 project names are groupings.';
