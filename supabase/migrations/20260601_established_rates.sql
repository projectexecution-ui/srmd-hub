-- ============================================================
-- Established Rates module — schema + RLS + role_permissions
-- ============================================================
-- Master unit-rate catalogue for SRMD. 3-level taxonomy:
--   Discipline → Category → Sub-category (rate-item)
-- Multiple unit rates per sub-category, sourced from either
-- public.vendors (materials) or jmr_contractors (machinery/labour).
-- Primary populator is the IN4 BOQ Abstract Report importer.
-- ============================================================

-- ───── Taxonomy ─────────────────────────────────────────────
create table if not exists public.est_disciplines (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                       -- IN4 numeric prefix, e.g. "03"
  name          text not null,
  display_order int  not null default 0,
  is_archived   bool not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.est_categories (
  id            uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references public.est_disciplines(id) on delete restrict,
  code          text,                              -- IN4 numeric prefix, e.g. "317"
  name          text not null,
  display_order int  not null default 0,
  is_archived   bool not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (discipline_id, code)
);

create table if not exists public.est_subcategories (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.est_categories(id) on delete restrict,
  code          text,
  name          text not null,
  description   text,
  uom           text not null,                      -- 'Per Hr', 'SqM', 'Nos', 'Lump Sum', ...
  display_order int  not null default 0,
  is_archived   bool not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (category_id, name)
);
create index if not exists est_subcategories_name_idx
  on public.est_subcategories using gin (to_tsvector('simple', name));

-- ───── Rates (unit rates, many per sub-category) ────────────
create table if not exists public.est_rates (
  id              uuid primary key default gen_random_uuid(),
  subcategory_id  uuid not null references public.est_subcategories(id) on delete cascade,
  source_type     text not null check (source_type in ('vendor','contractor')),
  vendor_id       uuid references public.vendors(id) on delete set null,
  contractor_id   uuid references public.jmr_contractors(id) on delete set null,
  rate_per_unit   numeric(14,2) not null check (rate_per_unit >= 0),
  gst_pct         numeric(5,2)  default 18,
  valid_from      date not null default current_date,
  valid_till      date,
  project_id      uuid references public.projects(id) on delete set null,
  source_ref      text,                             -- WO number from IN4
  source_doc_url  text,
  source          text not null default 'manual' check (source in ('manual','in4-abstract','in4-wo')),
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null,
  check (
    (source_type = 'vendor'     and vendor_id     is not null and contractor_id is null) or
    (source_type = 'contractor' and contractor_id is not null and vendor_id     is null)
  )
);
create index if not exists est_rates_subcategory_idx on public.est_rates(subcategory_id);
create index if not exists est_rates_vendor_idx      on public.est_rates(vendor_id)     where vendor_id     is not null;
create index if not exists est_rates_contractor_idx  on public.est_rates(contractor_id) where contractor_id is not null;

-- Idempotency dedup: re-importing the same WO + sub-category + rate is a no-op
create unique index if not exists est_rates_dedup_vendor
  on public.est_rates (subcategory_id, vendor_id, source_ref, rate_per_unit)
  where vendor_id is not null and source_ref is not null;
create unique index if not exists est_rates_dedup_contractor
  on public.est_rates (subcategory_id, contractor_id, source_ref, rate_per_unit)
  where contractor_id is not null and source_ref is not null;

-- ───── WO history (lumpsum contracts) ───────────────────────
create table if not exists public.est_wo_history (
  id                    uuid primary key default gen_random_uuid(),
  wo_number             text not null unique,
  project_id            uuid references public.projects(id) on delete set null,
  sub_project_id        uuid references public.projects(id) on delete set null,
  contractor_name       text not null,
  vendor_id             uuid references public.vendors(id) on delete set null,
  contractor_id         uuid references public.jmr_contractors(id) on delete set null,
  work_description      text,
  in4_work_category     text,
  in4_work_sub_category text,
  discipline_id         uuid references public.est_disciplines(id)   on delete set null,
  category_id           uuid references public.est_categories(id)    on delete set null,
  subcategory_id        uuid references public.est_subcategories(id) on delete set null,
  from_date             date,
  to_date               date,
  status                text,
  base_value            numeric(14,2),
  total_tax             numeric(14,2),
  total_value           numeric(14,2),
  scope_of_work         text,
  remarks               text,
  source_file_name      text,
  imported_at           timestamptz not null default now(),
  imported_by           uuid references public.profiles(id) on delete set null
);
create index if not exists est_wo_history_subcategory_idx on public.est_wo_history(subcategory_id);
create index if not exists est_wo_history_category_idx    on public.est_wo_history(category_id);
create index if not exists est_wo_history_contractor_name on public.est_wo_history(contractor_name);

-- ───── Upload audit ─────────────────────────────────────────
create table if not exists public.est_upload_log (
  id             uuid primary key default gen_random_uuid(),
  uploaded_by    uuid references public.profiles(id) on delete set null,
  source         text not null check (source in ('in4-abstract','in4-wo','manual-rate','manual-taxonomy')),
  file_name      text,
  rows_total     int default 0,
  rows_inserted  int default 0,
  rows_skipped   int default 0,
  error_log      jsonb,
  created_at     timestamptz not null default now()
);

-- ───── Touch triggers ───────────────────────────────────────
create or replace function public.est_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_est_disciplines_touch on public.est_disciplines;
create trigger trg_est_disciplines_touch before update on public.est_disciplines
  for each row execute function public.est_touch_updated_at();
drop trigger if exists trg_est_categories_touch on public.est_categories;
create trigger trg_est_categories_touch before update on public.est_categories
  for each row execute function public.est_touch_updated_at();
drop trigger if exists trg_est_subcategories_touch on public.est_subcategories;
create trigger trg_est_subcategories_touch before update on public.est_subcategories
  for each row execute function public.est_touch_updated_at();
drop trigger if exists trg_est_rates_touch on public.est_rates;
create trigger trg_est_rates_touch before update on public.est_rates
  for each row execute function public.est_touch_updated_at();

-- ───── RLS ───────────────────────────────────────────────────
alter table public.est_disciplines   enable row level security;
alter table public.est_categories    enable row level security;
alter table public.est_subcategories enable row level security;
alter table public.est_rates         enable row level security;
alter table public.est_wo_history    enable row level security;
alter table public.est_upload_log    enable row level security;

-- View gated by role_permissions; write only admin or Portal Owner.
do $$
declare t text;
begin
  foreach t in array array[
    'est_disciplines','est_categories','est_subcategories',
    'est_rates','est_wo_history','est_upload_log'
  ] loop
    execute format($f$drop policy if exists "%s_read" on public.%s$f$, t, t);
    execute format($f$create policy "%s_read" on public.%s for select to authenticated using (
      exists (select 1 from public.role_permissions rp, public.profiles p
              where p.id = auth.uid() and rp.role = p.role
                and rp.module_slug = 'established-rates' and rp.can_view = true)
    )$f$, t, t);

    execute format($f$drop policy if exists "%s_write" on public.%s$f$, t, t);
    execute format($f$create policy "%s_write" on public.%s for all to authenticated using (
      exists (select 1 from public.profiles p
              where p.id = auth.uid()
                and (p.is_portal_owner = true or p.role = 'admin'))
    ) with check (
      exists (select 1 from public.profiles p
              where p.id = auth.uid()
                and (p.is_portal_owner = true or p.role = 'admin'))
    )$f$, t, t);
  end loop;
end $$;

-- ───── Module registration in role_permissions ──────────────
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin',              'established-rates', true,  true,  true ),
  ('founder',            'established-rates', true,  false, false),
  ('head',               'established-rates', true,  true,  false),
  ('engineer',           'established-rates', true,  false, false),
  ('uploader',           'established-rates', true,  true,  false),
  ('viewer',             'established-rates', true,  false, false),
  ('site_staff',         'established-rates', false, false, false),
  ('contractor',         'established-rates', false, false, false)
on conflict (role, module_slug) do nothing;
