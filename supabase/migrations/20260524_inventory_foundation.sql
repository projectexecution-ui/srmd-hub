-- ============================================================
-- Inventory module — foundation
-- ============================================================
-- Adapted from the standalone SRMD Inventory App spec to live in the
-- hub. Key changes from the spec:
--   - Spec's `users` table is replaced by reusing public.profiles.
--   - Spec's `projects` table is replaced by reusing public.projects
--     (already extended with Area Statement fields).
--   - New approval-flow roles are added to public.user_role in a
--     separate migration (must run first).
--   - Access still gated by hub-wide role_permissions (slug = 'inventory')
--     and per-table RLS as defense in depth.
-- ============================================================

-- ============ ENUMS (new — none clash with existing) =========

do $$ begin
  create type public.inv_request_status as enum (
    'DRAFT',
    'PENDING_BACKOFFICE',
    'PENDING_HOP',
    'APPROVED',
    'ISSUED',
    'CLOSED',
    'REJECTED_BACKOFFICE',
    'REJECTED_HOP',
    'CANCELLED_BY_ENGINEER',
    'EMERGENCY_ISSUED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inv_urgency as enum ('normal', 'urgent', 'emergency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inv_stock_movement_type as enum (
    'receipt',
    'issue',
    'return_good',
    'return_damaged',
    'damage',
    'transfer_in',
    'transfer_out',
    'adjustment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.inv_return_condition as enum ('good', 'damaged');
exception when duplicate_object then null; end $$;

-- ============ TABLES =========================================

-- Warehouses (physical stores)
create table if not exists public.inv_warehouses (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,
  name              text not null,
  location          text,
  store_manager_id  uuid references public.profiles(id) on delete set null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Engineer ↔ Project mapping (engineers can be on multiple projects)
create table if not exists public.inv_engineer_projects (
  id           uuid primary key default gen_random_uuid(),
  engineer_id  uuid not null references public.profiles(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (engineer_id, project_id)
);

-- Project ↔ HoP + primary warehouse (kept separate so we don't touch
-- public.projects schema — inventory-specific assignment)
create table if not exists public.inv_project_setup (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  hop_id                uuid not null references public.profiles(id) on delete restrict,
  primary_warehouse_id  uuid not null references public.inv_warehouses(id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Item master (admin/backoffice maintained)
create table if not exists public.inv_items (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  description  text,
  unit         text not null,
  category     text,
  image_url    text,
  hsn_code     text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);
create index if not exists inv_items_active_idx   on public.inv_items(is_active);
create index if not exists inv_items_category_idx on public.inv_items(category);

-- Stock per warehouse
create table if not exists public.inv_stock (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.inv_items(id) on delete restrict,
  warehouse_id  uuid not null references public.inv_warehouses(id) on delete restrict,
  physical_qty  numeric(14,3) not null default 0 check (physical_qty >= 0),
  reserved_qty  numeric(14,3) not null default 0 check (reserved_qty >= 0),
  damaged_qty   numeric(14,3) not null default 0 check (damaged_qty  >= 0),
  min_threshold numeric(14,3) default 0,
  last_updated  timestamptz not null default now(),
  unique (item_id, warehouse_id)
);
create index if not exists inv_stock_warehouse_idx on public.inv_stock(warehouse_id);
create index if not exists inv_stock_item_idx      on public.inv_stock(item_id);

-- Convenience view: available qty (engineers only ever see this)
create or replace view public.inv_stock_available as
select
  s.id,
  s.item_id,
  s.warehouse_id,
  i.code         as item_code,
  i.name         as item_name,
  i.unit,
  i.image_url,
  i.category,
  s.physical_qty,
  s.reserved_qty,
  s.damaged_qty,
  (s.physical_qty - s.reserved_qty - s.damaged_qty) as available_qty,
  s.min_threshold,
  ((s.physical_qty - s.reserved_qty - s.damaged_qty) <= coalesce(s.min_threshold, 0)) as is_low_stock
from public.inv_stock s
join public.inv_items i on i.id = s.item_id
where i.is_active = true;

-- Requests (engineer raises, flows through approval chain)
create table if not exists public.inv_requests (
  id                       uuid primary key default gen_random_uuid(),
  request_no               text unique not null,
  engineer_id              uuid not null references public.profiles(id) on delete restrict,
  project_id               uuid not null references public.projects(id) on delete restrict,
  warehouse_id             uuid not null references public.inv_warehouses(id) on delete restrict,
  status                   public.inv_request_status not null default 'DRAFT',
  urgency                  public.inv_urgency not null default 'normal',
  purpose                  text,
  required_by_date         date,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  backoffice_actor_id      uuid references public.profiles(id) on delete set null,
  backoffice_action_at     timestamptz,
  backoffice_remarks       text,
  hop_actor_id             uuid references public.profiles(id) on delete set null,
  hop_action_at            timestamptz,
  hop_remarks              text,
  store_actor_id           uuid references public.profiles(id) on delete set null,
  store_action_at          timestamptz,
  store_remarks            text,
  is_emergency             boolean not null default false,
  emergency_authorized_by  uuid references public.profiles(id) on delete set null
);
create index if not exists inv_requests_status_idx    on public.inv_requests(status);
create index if not exists inv_requests_engineer_idx  on public.inv_requests(engineer_id);
create index if not exists inv_requests_warehouse_idx on public.inv_requests(warehouse_id);
create index if not exists inv_requests_project_idx   on public.inv_requests(project_id);

create table if not exists public.inv_request_items (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references public.inv_requests(id) on delete cascade,
  item_id               uuid not null references public.inv_items(id)  on delete restrict,
  requested_qty         numeric(14,3) not null check (requested_qty > 0),
  approved_qty          numeric(14,3),
  issued_qty            numeric(14,3) not null default 0,
  returned_good_qty     numeric(14,3) not null default 0,
  returned_damaged_qty  numeric(14,3) not null default 0,
  remarks               text,
  created_at            timestamptz not null default now()
);
create index if not exists inv_request_items_request_idx on public.inv_request_items(request_id);

-- Append-only audit
create table if not exists public.inv_request_status_log (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.inv_requests(id) on delete cascade,
  from_status public.inv_request_status,
  to_status   public.inv_request_status not null,
  actor_id    uuid not null references public.profiles(id) on delete set null,
  action_at   timestamptz not null default now(),
  remarks     text,
  metadata    jsonb
);
create index if not exists inv_request_status_log_request_idx on public.inv_request_status_log(request_id);

-- Returns
create table if not exists public.inv_returns (
  id              uuid primary key default gen_random_uuid(),
  return_no       text unique not null,
  request_id      uuid not null references public.inv_requests(id) on delete restrict,
  request_item_id uuid not null references public.inv_request_items(id) on delete restrict,
  qty             numeric(14,3) not null check (qty > 0),
  condition       public.inv_return_condition not null,
  returned_by     uuid references public.profiles(id) on delete set null,
  received_by     uuid references public.profiles(id) on delete set null,
  received_at     timestamptz not null default now(),
  remarks         text
);

-- Stock movements (every +/-)
create table if not exists public.inv_stock_movements (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.inv_items(id)      on delete restrict,
  warehouse_id   uuid not null references public.inv_warehouses(id) on delete restrict,
  movement_type  public.inv_stock_movement_type not null,
  qty            numeric(14,3) not null,
  ref_table      text,
  ref_id         uuid,
  actor_id       uuid references public.profiles(id) on delete set null,
  remarks        text,
  created_at     timestamptz not null default now()
);
create index if not exists inv_stock_movements_item_wh_idx  on public.inv_stock_movements(item_id, warehouse_id);
create index if not exists inv_stock_movements_created_idx  on public.inv_stock_movements(created_at desc);

-- In-app notifications (inventory-scoped for now; can generalise later)
create table if not exists public.inv_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  message     text not null,
  ref_table   text,
  ref_id      uuid,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists inv_notifications_user_unread_idx on public.inv_notifications(user_id, is_read);

-- ============ SEQUENCES + AUTO-NUMBERING =====================

create sequence if not exists public.inv_request_no_seq start 1;
create sequence if not exists public.inv_return_no_seq  start 1;

create or replace function public.inv_set_request_no()
returns trigger language plpgsql as $$
begin
  if new.request_no is null or new.request_no = '' then
    new.request_no := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.inv_request_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_set_request_no on public.inv_requests;
create trigger trg_inv_set_request_no
  before insert on public.inv_requests
  for each row execute function public.inv_set_request_no();

create or replace function public.inv_set_return_no()
returns trigger language plpgsql as $$
begin
  if new.return_no is null or new.return_no = '' then
    new.return_no := 'RET-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.inv_return_no_seq')::text, 5, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_set_return_no on public.inv_returns;
create trigger trg_inv_set_return_no
  before insert on public.inv_returns
  for each row execute function public.inv_set_return_no();

-- ============ HELPER FNS (reuse hub's current_user_role) =====
-- public.current_user_role() already exists from the hub. We add a
-- convenience to get the engineer's assigned warehouse via the
-- inv_engineer_projects mapping's primary project setup (used for
-- engineer's "my warehouse" filtering). Simpler approach: store
-- assigned warehouse directly on profiles in a future migration if
-- needed; for now we treat warehouse selection as request-time choice.

-- ============ RLS ============================================
-- All reads gated by 'inventory' module's role_permissions.can_view.
-- Writes via SECURITY DEFINER RPCs so RLS just needs to allow reads.

alter table public.inv_warehouses           enable row level security;
alter table public.inv_engineer_projects    enable row level security;
alter table public.inv_project_setup        enable row level security;
alter table public.inv_items                enable row level security;
alter table public.inv_stock                enable row level security;
alter table public.inv_requests             enable row level security;
alter table public.inv_request_items        enable row level security;
alter table public.inv_request_status_log   enable row level security;
alter table public.inv_returns              enable row level security;
alter table public.inv_stock_movements      enable row level security;
alter table public.inv_notifications        enable row level security;

-- Generic: signed-in users with view perm on 'inventory' can read.
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'inv_warehouses','inv_engineer_projects','inv_project_setup','inv_items',
      'inv_stock','inv_requests','inv_request_items','inv_request_status_log',
      'inv_returns','inv_stock_movements'
    ])
  loop
    execute format($f$drop policy if exists "%s_read" on public.%s$f$, t, t);
    execute format($f$
      create policy "%s_read" on public.%s for select to authenticated using (
        exists (
          select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'inventory' and rp.can_view = true
        )
      )
    $f$, t, t);

    execute format($f$drop policy if exists "%s_write_editor" on public.%s$f$, t, t);
    execute format($f$
      create policy "%s_write_editor" on public.%s for all to authenticated using (
        exists (
          select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'inventory' and rp.can_edit = true
        )
      ) with check (
        exists (
          select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'inventory' and rp.can_edit = true
        )
      )
    $f$, t, t);
  end loop;
end $$;

-- Notifications: each user sees only their own
drop policy if exists "inv_notifications_own" on public.inv_notifications;
create policy "inv_notifications_own"
  on public.inv_notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============ REGISTER MODULE IN role_permissions ============
-- Seed sensible defaults so admin + portal owner can see immediately.
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values
  ('admin',        'inventory', true,  true,  true),
  ('founder',      'inventory', true,  false, false),
  ('head',         'inventory', true,  true,  false),
  ('engineer',     'inventory', true,  true,  false),
  ('uploader',     'inventory', true,  true,  false),
  ('viewer',       'inventory', true,  false, false),
  ('site_staff',   'inventory', true,  false, false),
  ('contractor',   'inventory', false, false, false)
on conflict (role, module_slug) do nothing;
