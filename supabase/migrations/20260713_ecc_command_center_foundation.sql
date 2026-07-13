-- ============================================================
-- Email Command Centre (ecc_) — per-user inbox triage module
-- ============================================================
-- Each row is scoped to ONE user (user_id = auth.uid()). RLS is strictly
-- per-user so "respective people see respective emails" is enforced by the
-- database, not just the UI. Prefix ecc_ stays clear of cc_ (Cost Control).
-- Additive only. Idempotent (safe to re-run).
-- ============================================================

create table if not exists public.ecc_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  email_address text not null,
  provider      text not null default 'gmail',
  status        text not null default 'seed'
                  check (status in ('seed','connected','disconnected','error')),
  connected_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, email_address)
);

create table if not exists public.ecc_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  account_id       uuid references public.ecc_accounts(id) on delete set null,
  thread_id        text,
  message_id       text,
  category         text not null
                     check (category in ('do_today','this_week','monitor','draft_pending','just_know','delete')),
  subject          text,
  sender           text,
  snippet          text,
  received_at      timestamptz,
  age_days         int,
  amount_inr       numeric,
  tags             text[] not null default '{}',
  suggested_action text,
  chase_on         date,
  status           text not null default 'open'
                     check (status in ('open','done','snoozed')),
  source           text not null default 'seed',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.ecc_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  ran_at       timestamptz not null default now(),
  window_days  int,
  source       text,
  counts       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists ecc_items_user_cat_idx   on public.ecc_items(user_id, category, status);
create index if not exists ecc_items_user_chase_idx on public.ecc_items(user_id, chase_on);
create index if not exists ecc_accounts_user_idx     on public.ecc_accounts(user_id);
create index if not exists ecc_runs_user_idx         on public.ecc_runs(user_id, ran_at desc);

drop trigger if exists trg_ecc_items_updated on public.ecc_items;
create trigger trg_ecc_items_updated
  before update on public.ecc_items
  for each row execute function public.set_updated_at();

alter table public.ecc_accounts enable row level security;
alter table public.ecc_items    enable row level security;
alter table public.ecc_runs     enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['ecc_accounts','ecc_items','ecc_runs'])
  loop
    execute format($f$drop policy if exists "%s_own_select" on public.%s$f$, t, t);
    execute format($f$create policy "%s_own_select" on public.%s
      for select to authenticated using (user_id = auth.uid())$f$, t, t);
    execute format($f$drop policy if exists "%s_own_insert" on public.%s$f$, t, t);
    execute format($f$create policy "%s_own_insert" on public.%s
      for insert to authenticated with check (user_id = auth.uid())$f$, t, t);
    execute format($f$drop policy if exists "%s_own_update" on public.%s$f$, t, t);
    execute format($f$create policy "%s_own_update" on public.%s
      for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())$f$, t, t);
    execute format($f$drop policy if exists "%s_own_delete" on public.%s$f$, t, t);
    execute format($f$create policy "%s_own_delete" on public.%s
      for delete to authenticated using (user_id = auth.uid())$f$, t, t);
  end loop;
end $$;

insert into public.role_permissions(role, module_slug, can_view, can_edit, can_admin)
values
  ('admin'::public.user_role,        'ecc', true,  true,  true),
  ('founder'::public.user_role,      'ecc', true,  false, false),
  ('head'::public.user_role,         'ecc', true,  true,  false),
  ('uploader'::public.user_role,     'ecc', false, false, false),
  ('engineer'::public.user_role,     'ecc', false, false, false),
  ('backoffice'::public.user_role,   'ecc', false, false, false),
  ('store_manager'::public.user_role,'ecc', false, false, false),
  ('site_staff'::public.user_role,   'ecc', false, false, false),
  ('viewer'::public.user_role,       'ecc', false, false, false),
  ('contractor'::public.user_role,   'ecc', false, false, false)
on conflict (role, module_slug) do nothing;
