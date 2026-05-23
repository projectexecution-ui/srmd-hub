-- ============================================================
-- Cost Control module — foundation migration
-- ============================================================
-- This adds tables for the SRASSK Cost Control module while
-- REUSING the hub's existing public.profiles and public.projects.
-- Existing tables are extended (not replaced).
--
-- Reviewable before apply. Run via Supabase MCP or SQL editor.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Extensions
-- ------------------------------------------------------------
create extension if not exists "uuid-ossp";
-- pgvector is needed later for duplicate detection. Safe to enable now.
create extension if not exists vector;

-- ------------------------------------------------------------
-- 1. Enums new to Cost Control
-- ------------------------------------------------------------
do $$ begin
  create type cc_project_status as enum ('setup_incomplete', 'active', 'on_hold', 'completed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_line_type as enum ('work', 'material');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_ws_status as enum ('draft', 'draft_blocked', 'submitted', 'approved', 'returned', 'wo_issued', 'paid', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_event_type as enum (
    'budget_add', 'budget_remove', 'budget_shift_in', 'budget_shift_out',
    'ws_created', 'ws_submitted', 'ws_edited', 'ws_approved', 'ws_returned',
    'wo_issued', 'bill_received', 'payment_made',
    'duplicate_flagged', 'duplicate_overridden',
    'revision_label', 'reclassification', 'category_added', 'category_disabled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_approval_status as enum ('pending', 'approved', 'rejected', 'returned', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_approval_channel as enum ('web', 'telegram', 'whatsapp', 'email', 'excel_import');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cc_dup_status as enum ('none', 'low', 'medium', 'high', 'overridden', 'continuation');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2. Extend public.projects (reuse, don't fork)
-- ------------------------------------------------------------
alter table public.projects
  add column if not exists parent_project_id uuid references public.projects(id),
  add column if not exists built_up_sft numeric,
  add column if not exists pm_user_id uuid references public.profiles(id),
  add column if not exists setup_progress_pct int default 0,
  add column if not exists cc_status cc_project_status default 'setup_incomplete',
  add column if not exists start_date date,
  add column if not exists target_completion date;

create index if not exists idx_projects_parent on public.projects(parent_project_id);
create index if not exists idx_projects_pm on public.projects(pm_user_id);

-- ------------------------------------------------------------
-- 3. Master data — disciplines & sub-skills
-- ------------------------------------------------------------
create table if not exists public.cc_disciplines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  display_order int not null default 0,
  is_archived boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.cc_sub_skills (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references public.cc_disciplines(id) on delete cascade,
  code text not null,
  name text not null,
  default_uom text,
  is_archived boolean default false,
  created_at timestamptz default now(),
  unique(discipline_id, code)
);

create index if not exists idx_sub_skills_discipline on public.cc_sub_skills(discipline_id);

-- ------------------------------------------------------------
-- 4. Per-project enabled disciplines & sub-skills
-- ------------------------------------------------------------
create table if not exists public.cc_project_disciplines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  discipline_id uuid not null references public.cc_disciplines(id),
  is_enabled boolean default true,
  enabled_at timestamptz default now(),
  enabled_by uuid references public.profiles(id),
  unique(project_id, discipline_id)
);

create table if not exists public.cc_project_sub_skills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sub_skill_id uuid not null references public.cc_sub_skills(id),
  is_enabled boolean default true,
  enabled_at timestamptz default now(),
  enabled_by uuid references public.profiles(id),
  unique(project_id, sub_skill_id)
);

-- ------------------------------------------------------------
-- 5. Vendors (Cost Control uses its own — hub has public.vendors but
--    that one is tied to indents/POs. Keep separate for now; we can
--    unify later if Mayank confirms the columns are interchangeable.)
-- ------------------------------------------------------------
-- NOTE: reusing public.vendors. Cost Control reads from same table.
-- No new vendors table here. If Cost Control needs extra columns
-- (e.g. construction category), we'll add them to public.vendors.

-- ------------------------------------------------------------
-- 6. Project assignments — who works on which project + disciplines
-- ------------------------------------------------------------
-- A user can have different roles in different projects, with specific
-- disciplines assigned. Shared concept across modules.
create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null,                       -- 'pm', 'engineer', 'head', 'accounts', etc. Free-form so other modules can use their own labels.
  assigned_disciplines uuid[] default '{}', -- specific cc_disciplines.id this user owns on this project
  assigned_at timestamptz default now(),
  assigned_by uuid references public.profiles(id),
  unique(user_id, project_id, role)
);

create index if not exists idx_project_assignments_user on public.project_assignments(user_id);
create index if not exists idx_project_assignments_project on public.project_assignments(project_id);

-- ------------------------------------------------------------
-- 7. Finer-grained permission matrix (opt-in, per module)
-- ------------------------------------------------------------
-- The hub already has public.role_permissions (3 flags per module).
-- This new table layers granular per-resource permissions on top,
-- which any module can opt into. Cost Control uses it; other modules
-- can stay on the 3-flag model.
create table if not exists public.permission_policies (
  id uuid primary key default gen_random_uuid(),
  role text not null,                       -- matches the hub's role enum
  resource_type text not null,              -- 'cc_working_sheet', 'cc_budget_event', 'cc_approval', ...
  flag_name text not null,                  -- 'can_view', 'can_create', 'can_edit_draft', etc.
  is_allowed boolean default false,
  scope text default 'assigned',            -- 'all' | 'assigned' | 'own' | 'discipline'
  updated_at timestamptz default now(),
  updated_by uuid references public.profiles(id),
  unique(role, resource_type, flag_name)
);

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource_type text not null,
  flag_name text not null,
  is_allowed boolean not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists idx_user_overrides_user on public.user_permission_overrides(user_id);

-- ------------------------------------------------------------
-- 8. Approval thresholds & discipline-level approvers
-- ------------------------------------------------------------
create table if not exists public.cc_approval_thresholds (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid references public.cc_disciplines(id),  -- null = applies to all disciplines
  role_required text not null,                              -- 'head' or 'founder'
  amount_max numeric not null,
  applies_to text not null,                                 -- 'working_sheet', 'budget_shift', 'wo'
  created_at timestamptz default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.cc_discipline_approvers (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references public.cc_disciplines(id) on delete cascade,
  approver_user_id uuid not null references public.profiles(id),
  approval_level int not null,              -- 1 = Head, 2 = Founder
  is_active boolean default true,
  unique(discipline_id, approver_user_id, approval_level)
);

-- ------------------------------------------------------------
-- 9. Budget lines + immutable event log
-- ------------------------------------------------------------
create table if not exists public.cc_budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  discipline_id uuid not null references public.cc_disciplines(id),
  sub_skill_id uuid references public.cc_sub_skills(id),
  line_type cc_line_type default 'work',
  owner_user_id uuid references public.profiles(id),
  current_budget_amt numeric default 0,
  current_wo_committed_amt numeric default 0,
  current_paid_amt numeric default 0,
  current_advance_amt numeric default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, discipline_id, sub_skill_id, line_type)
);

create index if not exists idx_budget_lines_project on public.cc_budget_lines(project_id);
create index if not exists idx_budget_lines_discipline on public.cc_budget_lines(discipline_id);

create table if not exists public.cc_budget_events (
  id uuid primary key default gen_random_uuid(),
  budget_line_id uuid references public.cc_budget_lines(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type cc_event_type not null,
  delta_amount numeric default 0,
  related_budget_line_id uuid references public.cc_budget_lines(id),
  related_ws_id uuid,
  revision_label text,
  vendor_id uuid references public.vendors(id),
  wo_number text,
  bill_number text,
  payment_ref text,
  remarks text,
  channel cc_approval_channel default 'web',
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approval_status cc_approval_status,
  event_date timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_budget_events_line on public.cc_budget_events(budget_line_id);
create index if not exists idx_budget_events_project on public.cc_budget_events(project_id);
create index if not exists idx_budget_events_type on public.cc_budget_events(event_type);

-- ------------------------------------------------------------
-- 10. Working Sheets
-- ------------------------------------------------------------
create table if not exists public.cc_working_sheets (
  id uuid primary key default gen_random_uuid(),
  ws_code text not null unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  discipline_id uuid not null references public.cc_disciplines(id),
  sub_skill_id uuid not null references public.cc_sub_skills(id),
  line_type cc_line_type default 'work',
  status cc_ws_status default 'draft',
  engineer_id uuid not null references public.profiles(id),
  total_amount numeric default 0,
  past_approved_in_subskill numeric default 0,
  created_at timestamptz default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  returned_at timestamptz,
  returned_by uuid references public.profiles(id),
  return_reason text,
  locked_at timestamptz,
  locked_by uuid references public.profiles(id)
);

create index if not exists idx_ws_project on public.cc_working_sheets(project_id);
create index if not exists idx_ws_status on public.cc_working_sheets(status);
create index if not exists idx_ws_engineer on public.cc_working_sheets(engineer_id);

create table if not exists public.cc_working_sheet_items (
  id uuid primary key default gen_random_uuid(),
  working_sheet_id uuid not null references public.cc_working_sheets(id) on delete cascade,
  sr_no int not null,
  description text not null,
  description_embedding vector(1536),
  uom text not null,
  qty numeric not null,
  rate numeric not null,
  gst_pct numeric default 18,
  base_amount numeric generated always as (qty * rate) stored,
  gst_amount numeric generated always as (qty * rate * gst_pct / 100) stored,
  total_amount numeric generated always as (qty * rate * (1 + gst_pct / 100)) stored,
  vendor_id uuid references public.vendors(id),
  location_tag text,
  remark text,
  dup_status cc_dup_status default 'none',
  dup_match_item_id uuid references public.cc_working_sheet_items(id),
  dup_match_score numeric,
  override_reason_category text,
  override_reason text,
  override_by uuid references public.profiles(id),
  override_at timestamptz,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- pgvector index. ivfflat needs ANALYZE after data lands; safe to create empty.
create index if not exists idx_ws_items_embedding
  on public.cc_working_sheet_items using ivfflat (description_embedding vector_cosine_ops);

create table if not exists public.cc_working_sheet_edits (
  id uuid primary key default gen_random_uuid(),
  working_sheet_id uuid not null references public.cc_working_sheets(id) on delete cascade,
  item_id uuid references public.cc_working_sheet_items(id) on delete cascade,
  edited_by uuid references public.profiles(id),
  field_name text not null,
  old_value text,
  new_value text,
  reason text,
  edited_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 11. Approvals
-- ------------------------------------------------------------
create table if not exists public.cc_approvals (
  id uuid primary key default gen_random_uuid(),
  ap_code text not null unique,
  entity_type text not null,                -- 'working_sheet', 'budget_shift', 'bill', 'wo'
  entity_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  amount numeric not null,
  priority text default 'medium',
  status cc_approval_status default 'pending',
  requested_by uuid references public.profiles(id),
  requested_at timestamptz default now(),
  current_approver uuid references public.profiles(id),
  approval_level int default 1,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_remarks text,
  channel cc_approval_channel default 'web',
  external_message_id text
);

create index if not exists idx_approvals_status on public.cc_approvals(status);
create index if not exists idx_approvals_approver on public.cc_approvals(current_approver);

-- ------------------------------------------------------------
-- 12. Bills & payments (Cost Control flavour — distinct from
--     existing public.invoices/payments which are tied to POs)
-- ------------------------------------------------------------
create table if not exists public.cc_bills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  related_ws_id uuid references public.cc_working_sheets(id),
  bill_number text not null,
  bill_date date not null,
  period text,
  base_amount numeric not null,
  gst_amount numeric default 0,
  retention_amount numeric default 0,
  total_amount numeric not null,
  net_payable numeric not null,
  status text default 'received',
  attachment_url text,
  entered_by uuid references public.profiles(id),
  entered_at timestamptz default now(),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz
);

create table if not exists public.cc_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references public.cc_bills(id) on delete cascade,
  amount numeric not null,
  payment_date date not null,
  payment_ref text,
  mode text,
  entered_by uuid references public.profiles(id),
  entered_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 13. Excel import tracking (Cost Control specific)
-- ------------------------------------------------------------
create table if not exists public.cc_excel_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_url text,
  project_id uuid references public.projects(id) on delete set null,
  detected_format text,
  lines_found int,
  lines_imported int,
  lines_skipped int,
  import_status text default 'preview',
  imported_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  committed_at timestamptz,
  raw_data jsonb
);

-- ------------------------------------------------------------
-- 14. Module registration
-- ------------------------------------------------------------
-- Register the cost-control module so the hub's role_permissions
-- table picks it up. Admin will tune via /admin/permissions.
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values
  ('admin',     'cost-control', true,  true,  true),
  ('founder',   'cost-control', true,  true,  false),
  ('head',      'cost-control', true,  true,  false),
  ('uploader',  'cost-control', true,  true,  false),
  ('engineer',  'cost-control', true,  true,  false),
  ('site_staff','cost-control', true,  false, false),
  ('viewer',    'cost-control', true,  false, false)
on conflict (role, module_slug) do nothing;

-- ============================================================
-- END migration. RLS policies are in the next migration file.
-- ============================================================
