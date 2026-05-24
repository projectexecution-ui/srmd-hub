-- Quick Mode for Cost Control working sheets — see body in the
-- corresponding Supabase migration. Excel-summary entry mode with
-- parsed rows in cc_excel_rows + flag_summary jsonb on the parent.

alter table public.cc_working_sheets
  add column if not exists entry_mode        text default 'line_items',
  add column if not exists source_excel_url  text,
  add column if not exists source_excel_name text,
  add column if not exists summary_total     numeric,
  add column if not exists summary_notes     text,
  add column if not exists flag_summary      jsonb,
  add column if not exists last_checked_at   timestamptz;

do $$ begin
  alter table public.cc_working_sheets
    add constraint cc_ws_entry_mode_chk
    check (entry_mode in ('line_items','excel_summary'));
exception when duplicate_object then null; end $$;

create table if not exists public.cc_excel_rows (
  id                uuid primary key default gen_random_uuid(),
  working_sheet_id  uuid not null references public.cc_working_sheets(id) on delete cascade,
  row_no            integer not null,
  raw_label         text,
  description       text,
  unit              text,
  qty               numeric,
  rate              numeric,
  amount            numeric,
  formula_in_amount text,
  flag              text,
  flag_reason       text,
  flag_severity     text,
  created_at        timestamptz not null default now()
);
create index if not exists cc_excel_rows_ws_idx on public.cc_excel_rows(working_sheet_id, row_no);

alter table public.cc_excel_rows enable row level security;

drop policy if exists "cc_excel_rows_read"  on public.cc_excel_rows;
create policy "cc_excel_rows_read"
  on public.cc_excel_rows for select to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_view = true)
  );

drop policy if exists "cc_excel_rows_write" on public.cc_excel_rows;
create policy "cc_excel_rows_write"
  on public.cc_excel_rows for all to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
  ) with check (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
  );

-- Storage bucket cc-sheets — private; reads gated by cost-control.can_view.
insert into storage.buckets (id, name, public)
values ('cc-sheets', 'cc-sheets', false)
on conflict (id) do nothing;

drop policy if exists "cc_sheets_read"  on storage.objects;
create policy "cc_sheets_read"
  on storage.objects for select to authenticated using (
    bucket_id = 'cc-sheets' and exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_view = true)
  );

drop policy if exists "cc_sheets_write" on storage.objects;
create policy "cc_sheets_write"
  on storage.objects for all to authenticated using (
    bucket_id = 'cc-sheets' and exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
  ) with check (
    bucket_id = 'cc-sheets' and exists (
      select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
  );
