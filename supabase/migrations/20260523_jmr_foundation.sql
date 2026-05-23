-- ============================================================
-- JMR / Machinery Tracker — foundation migration
-- ============================================================
-- Adds tables + RLS for the JMR (Joint Measurement Record) module:
-- daily machinery/manpower entries, contractor bills with variance
-- check, rate cards, project access lists, and audit logs.
--
-- REUSES the hub's existing infrastructure:
--   * public.profiles (auth/role)
--   * public.projects (parent_project_id models sub-projects)
--   * public.role_permissions (module-level gating)
--   * public.app_settings (settings as key/value rows)
--   * helpers: current_user_role(), is_writer(), set_updated_at()
--
-- Roles used by JMR (existing public.user_role values):
--   admin       -> full
--   head        -> PM (full on JMR)
--   founder     -> management view (read-only)
--   engineer    -> Site Engineer (entry on assigned projects)
--   contractor  -> NEW: sees only own bills + entries
-- ============================================================

-- ------------------------------------------------------------
-- 0. Extensions
-- ------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- NOTE: The 'contractor' value is added to public.user_role in a SEPARATE
-- earlier migration (20260523_jmr_role_contractor.sql). Postgres forbids
-- using a new enum value in the same transaction it's added, so the role
-- extension must be its own migration.

-- ------------------------------------------------------------
-- 2. JMR-specific enums
-- ------------------------------------------------------------
do $$ begin
  create type public.jmr_item_category as enum ('equipment', 'manpower');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.jmr_item_unit as enum ('hr', 'day', 'nos', 'cu_m');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.jmr_entry_status as enum ('submitted', 'pm_approved', 'flagged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.jmr_bill_status as enum ('submitted', 'pm_review', 'approved', 'paid', 'rejected');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 3. Tables
-- ------------------------------------------------------------

-- 3a. Contractors (master, separate from public.vendors which is for materials)
create table if not exists public.jmr_contractors (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  gst_number      text,
  contact_person  text,
  phone           text,
  email           text,
  -- Optional link to a profiles row, so a contractor user sees only own data.
  profile_id      uuid references public.profiles(id) on delete set null,
  status          text not null default 'active',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists jmr_contractors_profile_idx on public.jmr_contractors(profile_id);

-- 3b. Items catalog (Equipment + Manpower)
create table if not exists public.jmr_items (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  category    public.jmr_item_category not null,
  unit        public.jmr_item_unit not null,
  is_active   boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (name, category)
);

-- 3c. Rate cards. project_id NULL = contractor's default; non-null = project override.
create table if not exists public.jmr_rate_cards (
  id              uuid primary key default uuid_generate_v4(),
  contractor_id   uuid not null references public.jmr_contractors(id) on delete cascade,
  item_id         uuid not null references public.jmr_items(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  rate_per_unit   numeric(14, 2) not null check (rate_per_unit >= 0),
  valid_from      date not null,
  valid_till      date,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  check (valid_till is null or valid_till >= valid_from)
);
create index if not exists jmr_rate_cards_lookup_idx
  on public.jmr_rate_cards(contractor_id, item_id, project_id, valid_from);

-- 3d. Per-user project access (which projects can a site engineer see)
create table if not exists public.jmr_user_project_access (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  granted_at  timestamptz default now(),
  granted_by  uuid references public.profiles(id),
  primary key (user_id, project_id)
);

-- 3e. Daily entries (Site Engineer logs)
create table if not exists public.jmr_daily_entries (
  id                  uuid primary key default uuid_generate_v4(),
  project_id          uuid not null references public.projects(id) on delete restrict,
  sub_project_id      uuid references public.projects(id) on delete restrict,
  contractor_id       uuid not null references public.jmr_contractors(id) on delete restrict,
  item_id             uuid not null references public.jmr_items(id) on delete restrict,
  entry_date          date not null,
  start_meter         numeric(14, 2),
  end_meter           numeric(14, 2),
  quantity            numeric(14, 2) not null check (quantity > 0),
  rate_snapshot       numeric(14, 2) not null check (rate_snapshot >= 0),
  amount              numeric(14, 2) not null check (amount >= 0),
  work_description    text,
  log_sheet_photo_url text,
  logged_by_user_id   uuid references public.profiles(id),
  status              public.jmr_entry_status not null default 'submitted',
  approved_by_user_id uuid references public.profiles(id),
  approved_at         timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  check (end_meter is null or start_meter is null or end_meter > start_meter)
  -- Note: "hours <= 24" rule is enforced at the app layer (form validation)
  -- because Postgres CHECK constraints can't reference other tables.
);
create index if not exists jmr_daily_entries_project_idx on public.jmr_daily_entries(project_id, entry_date);
create index if not exists jmr_daily_entries_contractor_idx on public.jmr_daily_entries(contractor_id, entry_date);
create index if not exists jmr_daily_entries_logger_idx on public.jmr_daily_entries(logged_by_user_id);

-- 3f. Bills (header)
create table if not exists public.jmr_bills (
  id                  uuid primary key default uuid_generate_v4(),
  bill_number         text not null,
  contractor_id       uuid not null references public.jmr_contractors(id) on delete restrict,
  project_id          uuid not null references public.projects(id) on delete restrict,
  bill_date           date not null,
  period_from         date not null,
  period_to           date not null,
  subtotal            numeric(14, 2) not null default 0,
  gst_rate            numeric(5, 2) not null default 18,
  gst_amount          numeric(14, 2) not null default 0,
  total_amount        numeric(14, 2) not null default 0,
  bill_photo_url      text,
  status              public.jmr_bill_status not null default 'submitted',
  variance_flag       boolean not null default false,
  variance_notes      text,
  submitted_by_user_id uuid references public.profiles(id),
  approved_by_user_id  uuid references public.profiles(id),
  approved_at          timestamptz,
  paid_on             date,
  payment_ref         text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (contractor_id, bill_number),
  check (period_to >= period_from)
);
create index if not exists jmr_bills_status_idx on public.jmr_bills(status, bill_date);
create index if not exists jmr_bills_project_idx on public.jmr_bills(project_id);

-- 3g. Bill line items
create table if not exists public.jmr_bill_line_items (
  id                uuid primary key default uuid_generate_v4(),
  bill_id           uuid not null references public.jmr_bills(id) on delete cascade,
  item_id           uuid not null references public.jmr_items(id) on delete restrict,
  sub_project_id    uuid references public.projects(id) on delete set null,
  billed_quantity   numeric(14, 2) not null check (billed_quantity >= 0),
  jmr_quantity      numeric(14, 2) not null default 0,
  rate              numeric(14, 2) not null check (rate >= 0),
  amount            numeric(14, 2) not null check (amount >= 0),
  variance          numeric(14, 2) not null default 0,
  variance_pct      numeric(7, 2),
  created_at        timestamptz default now()
);
create index if not exists jmr_bill_line_items_bill_idx on public.jmr_bill_line_items(bill_id);

-- 3h. Rate change log
create table if not exists public.jmr_rate_change_log (
  id              uuid primary key default uuid_generate_v4(),
  rate_card_id    uuid references public.jmr_rate_cards(id) on delete set null,
  contractor_id   uuid references public.jmr_contractors(id),
  item_id         uuid references public.jmr_items(id),
  project_id      uuid references public.projects(id),
  old_rate        numeric(14, 2),
  new_rate        numeric(14, 2),
  changed_by      uuid references public.profiles(id),
  reason          text,
  changed_at      timestamptz default now()
);

-- 3i. Activity log (entry + bill events)
create table if not exists public.jmr_activity_log (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references public.profiles(id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  before_data  jsonb,
  after_data   jsonb,
  occurred_at  timestamptz default now()
);
create index if not exists jmr_activity_log_entity_idx on public.jmr_activity_log(entity_type, entity_id);

-- ------------------------------------------------------------
-- 4. updated_at triggers
-- ------------------------------------------------------------
do $$ begin
  create trigger jmr_contractors_set_updated_at
    before update on public.jmr_contractors
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger jmr_items_set_updated_at
    before update on public.jmr_items
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger jmr_rate_cards_set_updated_at
    before update on public.jmr_rate_cards
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger jmr_daily_entries_set_updated_at
    before update on public.jmr_daily_entries
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger jmr_bills_set_updated_at
    before update on public.jmr_bills
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 5. Helper functions
-- ------------------------------------------------------------

-- Returns the contractor_id linked to the current auth user, or null.
create or replace function public.jmr_my_contractor_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.jmr_contractors where profile_id = auth.uid() limit 1;
$$;

-- True if the current user can see a given project_id.
-- admin/head/founder/uploader/viewer see all. engineer/site_staff see only
-- projects they have an explicit row in jmr_user_project_access for, OR
-- projects with no access rows at all (so the table is opt-in restriction).
-- contractor sees only projects where they have at least one bill/entry.
create or replace function public.jmr_can_see_project(p_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (select public.current_user_role() as r, auth.uid() as uid)
  select case
    when (select r from me) in ('admin','head','founder','uploader','viewer') then true
    when (select r from me) in ('engineer','site_staff') then
      not exists (select 1 from public.jmr_user_project_access where user_id = (select uid from me))
      or exists (
        select 1 from public.jmr_user_project_access
        where user_id = (select uid from me) and project_id = p_id
      )
    when (select r from me) = 'contractor' then
      exists (
        select 1 from public.jmr_daily_entries e
        join public.jmr_contractors c on c.id = e.contractor_id
        where e.project_id = p_id and c.profile_id = (select uid from me)
      ) or exists (
        select 1 from public.jmr_bills b
        join public.jmr_contractors c on c.id = b.contractor_id
        where b.project_id = p_id and c.profile_id = (select uid from me)
      )
    else false
  end;
$$;

-- ------------------------------------------------------------
-- 6. Enable RLS + policies
-- ------------------------------------------------------------

alter table public.jmr_contractors        enable row level security;
alter table public.jmr_items              enable row level security;
alter table public.jmr_rate_cards         enable row level security;
alter table public.jmr_user_project_access enable row level security;
alter table public.jmr_daily_entries      enable row level security;
alter table public.jmr_bills              enable row level security;
alter table public.jmr_bill_line_items    enable row level security;
alter table public.jmr_rate_change_log    enable row level security;
alter table public.jmr_activity_log       enable row level security;

-- Helper: who's a JMR writer (PM-ish or above)
-- We reuse the existing is_writer() but augment with 'head' (PM).
-- Most policies use current_user_role() directly for clarity.

-- 6a. jmr_contractors
drop policy if exists jmr_contractors_select on public.jmr_contractors;
create policy jmr_contractors_select on public.jmr_contractors
  for select using (
    public.current_user_role() in ('admin','head','founder','uploader','viewer','engineer','site_staff')
    or (public.current_user_role() = 'contractor' and profile_id = auth.uid())
  );

drop policy if exists jmr_contractors_write on public.jmr_contractors;
create policy jmr_contractors_write on public.jmr_contractors
  for all using (public.current_user_role() in ('admin','head'))
  with check (public.current_user_role() in ('admin','head'));

-- 6b. jmr_items (catalog — readable by all logged-in users)
drop policy if exists jmr_items_select on public.jmr_items;
create policy jmr_items_select on public.jmr_items
  for select using (auth.uid() is not null);

drop policy if exists jmr_items_write on public.jmr_items;
create policy jmr_items_write on public.jmr_items
  for all using (public.current_user_role() in ('admin','head'))
  with check (public.current_user_role() in ('admin','head'));

-- 6c. jmr_rate_cards (read by all logged-in; write by PM+)
drop policy if exists jmr_rate_cards_select on public.jmr_rate_cards;
create policy jmr_rate_cards_select on public.jmr_rate_cards
  for select using (auth.uid() is not null);

drop policy if exists jmr_rate_cards_write on public.jmr_rate_cards;
create policy jmr_rate_cards_write on public.jmr_rate_cards
  for all using (public.current_user_role() in ('admin','head'))
  with check (public.current_user_role() in ('admin','head'));

-- 6d. jmr_user_project_access (admin/head manage)
drop policy if exists jmr_upa_select on public.jmr_user_project_access;
create policy jmr_upa_select on public.jmr_user_project_access
  for select using (
    public.current_user_role() in ('admin','head','founder') or user_id = auth.uid()
  );

drop policy if exists jmr_upa_write on public.jmr_user_project_access;
create policy jmr_upa_write on public.jmr_user_project_access
  for all using (public.current_user_role() in ('admin','head'))
  with check (public.current_user_role() in ('admin','head'));

-- 6e. jmr_daily_entries
drop policy if exists jmr_entries_select on public.jmr_daily_entries;
create policy jmr_entries_select on public.jmr_daily_entries
  for select using (
    public.jmr_can_see_project(project_id)
  );

drop policy if exists jmr_entries_insert on public.jmr_daily_entries;
create policy jmr_entries_insert on public.jmr_daily_entries
  for insert with check (
    public.current_user_role() in ('admin','head','engineer','site_staff','uploader')
    and public.jmr_can_see_project(project_id)
  );

drop policy if exists jmr_entries_update on public.jmr_daily_entries;
create policy jmr_entries_update on public.jmr_daily_entries
  for update using (
    public.current_user_role() in ('admin','head')
    or (
      public.current_user_role() in ('engineer','site_staff','uploader')
      and logged_by_user_id = auth.uid()
      and created_at > now() - interval '12 hours'
    )
  );

drop policy if exists jmr_entries_delete on public.jmr_daily_entries;
create policy jmr_entries_delete on public.jmr_daily_entries
  for delete using (public.current_user_role() in ('admin','head'));

-- 6f. jmr_bills
drop policy if exists jmr_bills_select on public.jmr_bills;
create policy jmr_bills_select on public.jmr_bills
  for select using (
    public.current_user_role() in ('admin','head','founder','uploader','viewer')
    or (public.current_user_role() in ('engineer','site_staff') and public.jmr_can_see_project(project_id))
    or (public.current_user_role() = 'contractor' and contractor_id = public.jmr_my_contractor_id())
  );

drop policy if exists jmr_bills_insert on public.jmr_bills;
create policy jmr_bills_insert on public.jmr_bills
  for insert with check (
    public.current_user_role() in ('admin','head','engineer','site_staff','uploader')
    and public.jmr_can_see_project(project_id)
  );

drop policy if exists jmr_bills_update on public.jmr_bills;
create policy jmr_bills_update on public.jmr_bills
  for update using (public.current_user_role() in ('admin','head'));

drop policy if exists jmr_bills_delete on public.jmr_bills;
create policy jmr_bills_delete on public.jmr_bills
  for delete using (public.current_user_role() in ('admin','head'));

-- 6g. jmr_bill_line_items — read inherits from parent bill
drop policy if exists jmr_bill_lines_select on public.jmr_bill_line_items;
create policy jmr_bill_lines_select on public.jmr_bill_line_items
  for select using (
    exists (select 1 from public.jmr_bills b where b.id = bill_id)
  );

drop policy if exists jmr_bill_lines_write on public.jmr_bill_line_items;
create policy jmr_bill_lines_write on public.jmr_bill_line_items
  for all using (
    public.current_user_role() in ('admin','head','engineer','site_staff','uploader')
  ) with check (
    public.current_user_role() in ('admin','head','engineer','site_staff','uploader')
  );

-- 6h. logs are PM+/admin read-only
drop policy if exists jmr_rate_log_select on public.jmr_rate_change_log;
create policy jmr_rate_log_select on public.jmr_rate_change_log
  for select using (public.current_user_role() in ('admin','head','founder'));

drop policy if exists jmr_rate_log_insert on public.jmr_rate_change_log;
create policy jmr_rate_log_insert on public.jmr_rate_change_log
  for insert with check (public.current_user_role() in ('admin','head'));

drop policy if exists jmr_activity_select on public.jmr_activity_log;
create policy jmr_activity_select on public.jmr_activity_log
  for select using (public.current_user_role() in ('admin','head','founder'));

drop policy if exists jmr_activity_insert on public.jmr_activity_log;
create policy jmr_activity_insert on public.jmr_activity_log
  for insert with check (auth.uid() is not null);

-- ------------------------------------------------------------
-- 7. New module slugs in role_permissions
-- ------------------------------------------------------------
-- Existing slug 'jmr' is the umbrella. We add 'jmr-admin' (admin panel,
-- PM+ only) and 'jmr-bills' (bill review, PM+ only). The Site Eng entry
-- screen lives under 'jmr' with edit perm.

insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin',      'jmr-admin', true,  true,  true),
  ('head',       'jmr-admin', true,  true,  false),
  ('founder',    'jmr-admin', false, false, false),
  ('uploader',   'jmr-admin', false, false, false),
  ('viewer',     'jmr-admin', false, false, false),
  ('engineer',   'jmr-admin', false, false, false),
  ('site_staff', 'jmr-admin', false, false, false),
  ('contractor', 'jmr-admin', false, false, false),
  ('admin',      'jmr-bills', true,  true,  true),
  ('head',       'jmr-bills', true,  true,  false),
  ('founder',    'jmr-bills', true,  false, false),
  ('uploader',   'jmr-bills', true,  false, false),
  ('viewer',     'jmr-bills', true,  false, false),
  ('engineer',   'jmr-bills', true,  true,  false),
  ('site_staff', 'jmr-bills', true,  true,  false),
  ('contractor', 'jmr-bills', true,  false, false),
  ('admin',      'jmr', true,  true,  true),
  ('head',       'jmr', true,  true,  false),
  ('founder',    'jmr', true,  false, false),
  ('uploader',   'jmr', true,  true,  false),
  ('viewer',     'jmr', true,  false, false),
  ('engineer',   'jmr', true,  true,  false),
  ('site_staff', 'jmr', true,  true,  false),
  ('contractor', 'jmr', true,  false, false)
on conflict (role, module_slug) do nothing;

-- ------------------------------------------------------------
-- 8. Role labels for 'contractor'
-- ------------------------------------------------------------
insert into public.role_labels (role, label, description)
values ('contractor', 'Contractor', 'External contractor — sees only own bills and entries')
on conflict (role) do nothing;

-- ------------------------------------------------------------
-- 9. app_settings defaults for JMR module
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('jmr_gst_rate_pct',                '18'),
  ('jmr_variance_tolerance_pct',      '5'),
  ('jmr_variance_tolerance_min_hours','4'),
  ('jmr_entry_edit_window_hours',     '12'),
  ('jmr_weekly_report_day',           'monday'),
  ('jmr_weekly_report_hour_ist',      '9'),
  ('jmr_weekly_report_recipients',    '[]')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 10. Storage bucket for log sheet + bill photos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('jmr-photos', 'jmr-photos', false)
on conflict (id) do nothing;

drop policy if exists jmr_photos_select on storage.objects;
create policy jmr_photos_select on storage.objects
  for select to authenticated using (bucket_id = 'jmr-photos');

drop policy if exists jmr_photos_insert on storage.objects;
create policy jmr_photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'jmr-photos');

drop policy if exists jmr_photos_update on storage.objects;
create policy jmr_photos_update on storage.objects
  for update to authenticated using (
    bucket_id = 'jmr-photos'
    and (public.current_user_role() in ('admin','head') or owner = auth.uid())
  );

drop policy if exists jmr_photos_delete on storage.objects;
create policy jmr_photos_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'jmr-photos'
    and public.current_user_role() in ('admin','head')
  );
