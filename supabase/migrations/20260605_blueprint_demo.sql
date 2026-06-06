-- ============================================================
-- Blueprint Demo: sandbox module for proving the Smart-Aging UX
-- without touching any production module.
-- ============================================================
-- Mirrors the inventory request pattern in miniature: state machine
-- draft → submitted → review → approved → closed (+ rejected). Used
-- by the approval_rule_stats view + sla_inbox RPC + /blueprint-demo
-- page to demonstrate Before/During/After lifecycle.
-- Deletion path is one DROP TABLE — the entire experiment is
-- self-contained under the `blueprint-demo` slug.

-- ─── Status enum ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'blueprint_demo_status') then
    create type public.blueprint_demo_status as enum
      ('draft', 'submitted', 'review', 'approved', 'closed', 'rejected');
  end if;
end $$;

-- ─── Main table ──────────────────────────────────────────────
create table if not exists public.blueprint_demo_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text unique not null,
  title         text not null,
  project_id    uuid references public.projects(id) on delete set null,
  status        public.blueprint_demo_status not null default 'draft',
  amount        numeric(14, 2) not null default 0,
  remarks       text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists blueprint_demo_requests_status_idx
  on public.blueprint_demo_requests(status);
create index if not exists blueprint_demo_requests_created_at_idx
  on public.blueprint_demo_requests(created_at desc);

-- ─── Per-transition log (mirrors inv_request_status_log) ─────
create table if not exists public.blueprint_demo_request_status_log (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.blueprint_demo_requests(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_id     uuid references public.profiles(id) on delete set null,
  remarks      text,
  created_at   timestamptz not null default now()
);
create index if not exists blueprint_demo_log_req_idx
  on public.blueprint_demo_request_status_log(request_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────
alter table public.blueprint_demo_requests          enable row level security;
alter table public.blueprint_demo_request_status_log enable row level security;

drop policy if exists "bd_req_read" on public.blueprint_demo_requests;
create policy "bd_req_read" on public.blueprint_demo_requests
  for select to authenticated using (true);

drop policy if exists "bd_log_read" on public.blueprint_demo_request_status_log;
create policy "bd_log_read" on public.blueprint_demo_request_status_log
  for select to authenticated using (true);

drop policy if exists "bd_req_write" on public.blueprint_demo_requests;
create policy "bd_req_write" on public.blueprint_demo_requests
  for all to authenticated using (true) with check (true);

drop policy if exists "bd_log_write" on public.blueprint_demo_request_status_log;
create policy "bd_log_write" on public.blueprint_demo_request_status_log
  for insert to authenticated with check (true);

-- ─── Attach the existing matrix-enforcement trigger ──────────
drop trigger if exists trg_blueprint_demo_matrix on public.blueprint_demo_requests;
create trigger trg_blueprint_demo_matrix
  before update of status on public.blueprint_demo_requests
  for each row
  execute function public.enforce_approval_via_matrix(
    'blueprint-demo', 'blueprint_demo_request', 'status'
  );

-- ─── Status-log writer trigger ────────────────────────────────
create or replace function public.blueprint_demo_log_status_change()
returns trigger language plpgsql security definer as $$
begin
  if old.status is distinct from new.status then
    insert into public.blueprint_demo_request_status_log(
      request_id, from_status, to_status, actor_id, remarks
    ) values (
      new.id, old.status::text, new.status::text, auth.uid(), null
    );
  end if;
  return new;
end $$;
drop trigger if exists trg_blueprint_demo_log on public.blueprint_demo_requests;
create trigger trg_blueprint_demo_log
  after update of status on public.blueprint_demo_requests
  for each row
  execute function public.blueprint_demo_log_status_change();

-- ─── Touch trigger ─────────────────────────────────────────────
create or replace function public.blueprint_demo_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_blueprint_demo_touch on public.blueprint_demo_requests;
create trigger trg_blueprint_demo_touch
  before update on public.blueprint_demo_requests
  for each row execute function public.blueprint_demo_touch();

-- ─── Approval rules for the demo module ───────────────────────
insert into public.approval_rules
  (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, notes)
values
  ('blueprint-demo','blueprint_demo_request','draft','submitted',     'engineer','admin', 'Engineer submits the demo request'),
  ('blueprint-demo','blueprint_demo_request','submitted','review',    'head',    'admin', 'Head moves it to review'),
  ('blueprint-demo','blueprint_demo_request','review','approved',     'founder', 'admin', 'Founder approves'),
  ('blueprint-demo','blueprint_demo_request','approved','closed',     'admin',   null,    'Admin closes the loop'),
  ('blueprint-demo','blueprint_demo_request','review','rejected',     'founder', 'admin', 'Rejected during review'),
  ('blueprint-demo','blueprint_demo_request','submitted','rejected',  'head',    'admin', 'Rejected at intake')
on conflict do nothing;
