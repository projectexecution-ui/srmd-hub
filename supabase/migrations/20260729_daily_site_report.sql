-- ============================================================
-- Daily Site Report — material / supplier deliveries at sites
-- ============================================================
-- Site Engineers log each material/supplier delivery on their phone. Every
-- entry is GATED on a photo of the stamped bill (dsr_reports.stamped_bill_path
-- is NOT NULL) — the stamped copy is the proof the bill reached the CT office.
-- Engineers then advance a status ladder (received -> checked -> bill with CT
-- -> payment started -> GRN done -> paid). Management — especially the Atm Head
-- (role 'head', scoped to their projects via cc_project_approvers) — tracks the
-- whole chain via a smart checklist, and can jot follow-up notes in dsr_tracking
-- WITHOUT touching the engineer's data (no double entry).
--
-- Additive + non-breaking. Reuses hub infra: profiles / projects / vendors /
-- project_assignments / cc_project_approvers / role_permissions and helpers
-- current_user_role() + set_updated_at(). No shared table is altered.
--
-- NOTE: RLS keys off the base profiles.role via current_user_role(), not the
-- per-module effective_user_role() — this module expects no per-user overrides.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 1. dsr_reports — one row per delivery (header)
-- ------------------------------------------------------------
create table if not exists public.dsr_reports (
  id                       uuid primary key default uuid_generate_v4(),
  project_id               uuid not null references public.projects(id) on delete restrict,
  -- Supplier: a linked vendor OR a free-text name (CHECK: at least one).
  vendor_id                uuid references public.vendors(id) on delete set null,
  supplier_name_text       text,
  material_description      text not null,
  quantity                 numeric(14, 3),
  unit                     text,
  amount                   numeric(14, 2),
  bill_number              text not null,
  bill_date                date,
  received_on              date not null default current_date,
  -- The mandatory stamped-bill photo = the entry gate. A row cannot exist
  -- without it, so the "no entry without stamped bill" rule holds even for
  -- writes that bypass the UI.
  stamped_bill_path        text not null,
  -- Status ladder: engineer advances these; each carries a matching *_on date.
  checked_against_bill     boolean not null default false,
  checked_against_bill_on  date,
  bill_submitted_to_ct     boolean not null default false,
  bill_submitted_to_ct_on  date,
  payment_started          boolean not null default false,
  payment_started_on       date,
  grn_done                 boolean not null default false,
  grn_done_on              date,
  paid                     boolean not null default false,
  paid_on                  date,
  notes                    text,
  created_by               uuid not null references public.profiles(id) on delete restrict,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint dsr_reports_supplier_chk
    check (vendor_id is not null or nullif(btrim(supplier_name_text), '') is not null)
);
create index if not exists dsr_reports_project_idx on public.dsr_reports(project_id, received_on desc);
create index if not exists dsr_reports_creator_idx on public.dsr_reports(created_by, received_on desc);
-- Duplicate-bill guard: the same bill number can't be logged twice on a project.
create unique index if not exists dsr_reports_bill_uq
  on public.dsr_reports(project_id, lower(btrim(bill_number)))
  where nullif(btrim(bill_number), '') is not null;

-- ------------------------------------------------------------
-- 2. dsr_attachments — material photos (+ any extra bill pages)
-- ------------------------------------------------------------
-- The REQUIRED stamped bill lives on dsr_reports.stamped_bill_path; this child
-- holds the optional material photos and any additional bill pages.
create table if not exists public.dsr_attachments (
  id           uuid primary key default uuid_generate_v4(),
  report_id    uuid not null references public.dsr_reports(id) on delete cascade,
  path         text not null,
  name         text,
  kind         text not null default 'material' check (kind in ('material', 'bill')),
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists dsr_attachments_report_idx on public.dsr_attachments(report_id);

-- ------------------------------------------------------------
-- 3. dsr_tracking — Atm-Head follow-up state
-- ------------------------------------------------------------
-- Kept OUT of the engineer's report row so a management follow-up note never
-- touches ownership / the source data. Mirrors the bp_bill_checklist split.
create table if not exists public.dsr_tracking (
  report_id    uuid primary key references public.dsr_reports(id) on delete cascade,
  head_note    text,
  follow_up_on date,
  flagged      boolean not null default false,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint dsr_tracking_note_len check (head_note is null or char_length(head_note) <= 500)
);

-- ------------------------------------------------------------
-- 4. updated_at triggers (reuse existing set_updated_at())
-- ------------------------------------------------------------
do $$ begin
  create trigger dsr_reports_set_updated_at
    before update on public.dsr_reports
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger dsr_tracking_set_updated_at
    before update on public.dsr_tracking
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 5. Helper functions
-- ------------------------------------------------------------
create or replace function public.dsr_is_management()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_user_role() in ('admin', 'project_head', 'head', 'founder');
$$;

create or replace function public.dsr_is_assigned(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_assignments
    where user_id = auth.uid() and project_id = p_project
  );
$$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
alter table public.dsr_reports     enable row level security;
alter table public.dsr_attachments enable row level security;
alter table public.dsr_tracking    enable row level security;

-- 6a. dsr_reports: management sees all, engineer sees own; engineer enters on
--     assigned projects only; owner (or admin) advances the ladder; admin deletes.
drop policy if exists dsr_reports_select on public.dsr_reports;
create policy dsr_reports_select on public.dsr_reports
  for select to authenticated using (
    public.dsr_is_management() or created_by = auth.uid()
  );

drop policy if exists dsr_reports_insert on public.dsr_reports;
create policy dsr_reports_insert on public.dsr_reports
  for insert to authenticated with check (
    created_by = auth.uid()
    and public.current_user_role() in ('admin', 'engineer')
    and (public.current_user_role() = 'admin' or public.dsr_is_assigned(project_id))
  );

drop policy if exists dsr_reports_update on public.dsr_reports;
create policy dsr_reports_update on public.dsr_reports
  for update to authenticated
  using (public.current_user_role() = 'admin' or created_by = auth.uid())
  with check (public.current_user_role() = 'admin' or created_by = auth.uid());

drop policy if exists dsr_reports_delete on public.dsr_reports;
create policy dsr_reports_delete on public.dsr_reports
  for delete to authenticated using (public.current_user_role() = 'admin');

-- 6b. dsr_attachments: inherit visibility/ownership from the parent report.
drop policy if exists dsr_attachments_select on public.dsr_attachments;
create policy dsr_attachments_select on public.dsr_attachments
  for select to authenticated using (
    exists (
      select 1 from public.dsr_reports r
      where r.id = report_id
        and (public.dsr_is_management() or r.created_by = auth.uid())
    )
  );

drop policy if exists dsr_attachments_insert on public.dsr_attachments;
create policy dsr_attachments_insert on public.dsr_attachments
  for insert to authenticated with check (
    exists (
      select 1 from public.dsr_reports r
      where r.id = report_id
        and (public.current_user_role() = 'admin' or r.created_by = auth.uid())
    )
  );

drop policy if exists dsr_attachments_delete on public.dsr_attachments;
create policy dsr_attachments_delete on public.dsr_attachments
  for delete to authenticated using (
    public.current_user_role() = 'admin'
    or exists (select 1 from public.dsr_reports r where r.id = report_id and r.created_by = auth.uid())
  );

-- 6c. dsr_tracking: management OR the report owner can read; only management
--     may write the follow-up note/flag (engineers never write here).
drop policy if exists dsr_tracking_select on public.dsr_tracking;
create policy dsr_tracking_select on public.dsr_tracking
  for select to authenticated using (
    public.dsr_is_management()
    or exists (select 1 from public.dsr_reports r where r.id = report_id and r.created_by = auth.uid())
  );

drop policy if exists dsr_tracking_write on public.dsr_tracking;
create policy dsr_tracking_write on public.dsr_tracking
  for all to authenticated
  using (public.dsr_is_management())
  with check (public.dsr_is_management());

-- ------------------------------------------------------------
-- 7. Storage bucket for stamped-bill + material photos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-reports', 'site-reports', false)
on conflict (id) do nothing;

update storage.buckets
  set file_size_limit = 10485760,               -- 10 MB
      allowed_mime_types = array['image/jpeg', 'image/png']
  where id = 'site-reports';

-- Reads are gated server-side by minting signed URLs only after the row RLS
-- check passes (mirrors jmr-photos: any authenticated select on the bucket).
drop policy if exists dsr_photos_select on storage.objects;
create policy dsr_photos_select on storage.objects
  for select to authenticated using (bucket_id = 'site-reports');

drop policy if exists dsr_photos_insert on storage.objects;
create policy dsr_photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'site-reports');

drop policy if exists dsr_photos_update on storage.objects;
create policy dsr_photos_update on storage.objects
  for update to authenticated using (
    bucket_id = 'site-reports'
    and (public.current_user_role() = 'admin' or owner = auth.uid())
  );

drop policy if exists dsr_photos_delete on storage.objects;
create policy dsr_photos_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'site-reports'
    and (public.current_user_role() = 'admin' or owner = auth.uid())
  );

-- ------------------------------------------------------------
-- 8. role_permissions seed (missing row reads as "off")
-- ------------------------------------------------------------
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin) values
  ('admin',        'daily-site-report', true,  true,  true),
  ('engineer',     'daily-site-report', true,  true,  false),
  ('head',         'daily-site-report', true,  true,  false),
  ('project_head', 'daily-site-report', true,  true,  false),
  ('founder',      'daily-site-report', true,  false, false)
on conflict (role, module_slug) do nothing;

-- ------------------------------------------------------------
-- 9. notification rule for the daily Atm-Head email digest — ships OFF
-- ------------------------------------------------------------
insert into public.notification_rules (scope, scope_key, event_type, channel, enabled)
select v.scope, v.scope_key, v.event_type, v.channel, false
from (values
  ('global', '', 'daily_site_report_digest', 'email'),
  ('global', '', 'daily_site_report_digest', 'in_app')
) as v(scope, scope_key, event_type, channel)
where not exists (
  select 1 from public.notification_rules nr
  where nr.scope = v.scope and nr.scope_key = v.scope_key
    and nr.event_type = v.event_type and nr.channel = v.channel
);
