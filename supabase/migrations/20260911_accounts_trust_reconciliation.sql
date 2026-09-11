-- Accounts tab (Aksha, 11 Sep 2026): reconcile with Trust accounts.
--
-- CT Hub prepares a statement of IN4 payments for the Trust's accounts team;
-- they fill in bank date, reference, amount in their books and a status, and
-- the reply is read back. These two tables hold what was sent and what came
-- back. IN4 stays read-only — nothing here touches it.
--
-- Applied to live via Supabase MCP on 11 Sep 2026.

create table if not exists public.accounts_statements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  range_label text not null,
  row_count integer not null default 0,
  file_name text not null
);

create table if not exists public.accounts_payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null check (source in ('wo','supplier')),
  certificate_id bigint not null,
  statement_id uuid references public.accounts_statements(id) on delete set null,
  bank_date date,
  bank_ref text,
  amount_in_books numeric,
  status text not null check (status in ('confirmed','not_found','differs','explained')),
  remark text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (source, certificate_id)
);
create index if not exists accounts_payment_confirmations_project_idx on public.accounts_payment_confirmations(project_id);

alter table public.accounts_statements enable row level security;
alter table public.accounts_payment_confirmations enable row level security;

-- Cost Control management (the same test the approver RPC uses) reads and
-- writes; the app narrows further to the named Accounts list.
drop policy if exists accounts_statements_mgmt on public.accounts_statements;
create policy accounts_statements_mgmt on public.accounts_statements for all to authenticated
  using (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()))
  with check (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()));

drop policy if exists accounts_payment_confirmations_mgmt on public.accounts_payment_confirmations;
create policy accounts_payment_confirmations_mgmt on public.accounts_payment_confirmations for all to authenticated
  using (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()))
  with check (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()));
