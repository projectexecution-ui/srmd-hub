-- Comparison Maker — vendor quotation comparison tool.
-- One comparison = one BOQ scope, multiple vendors quoting it.
-- Each (item × vendor) cell = one row in cmp_quotes.

create table if not exists public.cmp_comparisons (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete set null,
  title         text not null,
  scope         text,
  status        text not null default 'draft' check (status in ('draft','active','awarded','closed')),
  awarded_vendor_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null
);

create table if not exists public.cmp_vendors (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.cmp_comparisons(id) on delete cascade,
  name          text not null,
  contact       text,
  vendor_id     uuid references public.vendors(id) on delete set null,
  quoted_on     date,
  validity_days int,
  notes         text,
  sequence      int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.cmp_comparisons
  add constraint cmp_awarded_vendor_fk
  foreign key (awarded_vendor_id) references public.cmp_vendors(id) on delete set null;

create table if not exists public.cmp_items (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.cmp_comparisons(id) on delete cascade,
  sequence      int not null,
  code          text,
  description   text not null,
  uom           text,
  quantity      numeric,
  notes         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.cmp_quotes (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.cmp_comparisons(id) on delete cascade,
  item_id       uuid not null references public.cmp_items(id) on delete cascade,
  vendor_id     uuid not null references public.cmp_vendors(id) on delete cascade,
  rate          numeric,
  amount        numeric,
  not_quoted    boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_id, vendor_id)
);

create index if not exists cmp_quotes_cmp_idx    on public.cmp_quotes(comparison_id);
create index if not exists cmp_items_cmp_idx     on public.cmp_items(comparison_id, sequence);
create index if not exists cmp_vendors_cmp_idx   on public.cmp_vendors(comparison_id, sequence);

alter table public.cmp_comparisons enable row level security;
alter table public.cmp_vendors     enable row level security;
alter table public.cmp_items       enable row level security;
alter table public.cmp_quotes      enable row level security;

-- RLS: gated by role_permissions on the 'comparison' module slug, with the
-- usual admin / Portal Owner bypass.
do $$
declare t text;
begin
  for t in select unnest(array['cmp_comparisons','cmp_vendors','cmp_items','cmp_quotes'])
  loop
    execute format($f$drop policy if exists "%s_read" on public.%s$f$, t, t);
    execute format($f$create policy "%s_read" on public.%s for select to authenticated using (
      exists (select 1 from public.role_permissions rp
              where rp.module_slug='comparison' and rp.can_view=true
                and rp.role::text = public.effective_user_role(auth.uid(),'comparison')::text)
      or exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin' or p.is_portal_owner=true))
    )$f$, t, t);
    execute format($f$drop policy if exists "%s_write" on public.%s$f$, t, t);
    execute format($f$create policy "%s_write" on public.%s for all to authenticated using (
      exists (select 1 from public.role_permissions rp
              where rp.module_slug='comparison' and rp.can_edit=true
                and rp.role::text = public.effective_user_role(auth.uid(),'comparison')::text)
      or exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin' or p.is_portal_owner=true))
    ) with check (
      exists (select 1 from public.role_permissions rp
              where rp.module_slug='comparison' and rp.can_edit=true
                and rp.role::text = public.effective_user_role(auth.uid(),'comparison')::text)
      or exists (select 1 from public.profiles p where p.id=auth.uid() and (p.role='admin' or p.is_portal_owner=true))
    )$f$, t, t);
  end loop;
end $$;

-- Default role permissions for the comparison module
insert into public.role_permissions(role, module_slug, can_view, can_edit, can_admin)
values
  ('admin'::public.user_role,        'comparison', true, true,  true),
  ('founder'::public.user_role,      'comparison', true, false, false),
  ('head'::public.user_role,         'comparison', true, true,  false),
  ('uploader'::public.user_role,     'comparison', true, true,  false),
  ('engineer'::public.user_role,     'comparison', true, true,  false),
  ('backoffice'::public.user_role,   'comparison', true, true,  false),
  ('store_manager'::public.user_role,'comparison', true, false, false),
  ('site_staff'::public.user_role,   'comparison', false,false, false),
  ('viewer'::public.user_role,       'comparison', true, false, false),
  ('contractor'::public.user_role,   'comparison', false,false, false)
on conflict (role, module_slug) do nothing;
