-- ============================================================
-- Bills Pipeline — per-bill pre-approval checklist
-- ============================================================
-- Backs the "Stuck Bills" tab: the user ticks MS Sheet / Abstract
-- Sheet / PO-WO / Drawing per bill before approving. Keyed by the
-- Zoho task id so ticks persist across weekly snapshot refreshes.
-- ============================================================

create table if not exists public.bp_bill_checklist (
  bill_id        text primary key,
  ms_sheet       boolean not null default false,
  abstract_sheet boolean not null default false,
  po_wo          boolean not null default false,
  drawing        boolean not null default false,
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

comment on table public.bp_bill_checklist is
  'Pre-approval document checklist per SRA bill (Zoho task id). Ticked in the Bills Pipeline Stuck-Bills tab.';

alter table public.bp_bill_checklist enable row level security;

-- Read/write for any user whose role has bills-pipeline can_edit.
drop policy if exists "bp_checklist_rw" on public.bp_bill_checklist;
create policy "bp_checklist_rw" on public.bp_bill_checklist
  for all to authenticated
  using (
    exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role::text = rp.role::text
      where p.id = auth.uid()
        and rp.module_slug = 'bills-pipeline'
        and rp.can_edit = true
    )
  )
  with check (
    exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role::text = rp.role::text
      where p.id = auth.uid()
        and rp.module_slug = 'bills-pipeline'
        and rp.can_edit = true
    )
  );
