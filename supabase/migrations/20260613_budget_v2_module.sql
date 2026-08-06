-- Budget vs Actual V2 — preview module. Additive only; never touches the
-- original budget/contractor/supplier modules. (Applied live via MCP; this is
-- the durable record.)

create table if not exists public.budget_v2_project_status (
  project_name text primary key,
  status       text not null default 'open' check (status in ('open','closed')),
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table public.budget_v2_project_status enable row level security;
drop policy if exists bv2_status_read on public.budget_v2_project_status;
create policy bv2_status_read on public.budget_v2_project_status for select to authenticated using (true);
drop policy if exists bv2_status_write on public.budget_v2_project_status;
create policy bv2_status_write on public.budget_v2_project_status for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));

create table if not exists public.budget_v2_alias (
  source         text not null check (source in ('contractor','supplier')),
  payment_name   text not null,
  budget_project text,
  confirmed      boolean not null default false,
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  primary key (source, payment_name)
);
alter table public.budget_v2_alias enable row level security;
drop policy if exists bv2_alias_read on public.budget_v2_alias;
create policy bv2_alias_read on public.budget_v2_alias for select to authenticated using (true);
drop policy if exists bv2_alias_write on public.budget_v2_alias;
create policy bv2_alias_write on public.budget_v2_alias for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin'::public.user_role or p.is_portal_owner)));

-- Preview gate: only the admin role sees the module until granted to others.
-- do nothing (not do update): a re-run must never clobber a manual grant.
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values ('admin','budget-vs-actual-v2', true, true, true)
on conflict (role, module_slug) do nothing;
