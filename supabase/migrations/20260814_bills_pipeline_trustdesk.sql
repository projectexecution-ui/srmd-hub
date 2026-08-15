-- ============================================================
-- Bills Pipeline — per-bill "trust desk" entry
-- ============================================================
-- Backs the auto Daily Bills Report. Zoho gives vendor / project /
-- invoice / amount / account / payment-date automatically; backoffice
-- only fills the few things Zoho doesn't carry, once per bill:
--   • submission_date / courier_date — when it went to the Trust A/c
--   • remark — picked from a preset list ("Cheque Received" …)
--   • account — override for the SRET/SRAH/SRASSK split when the IN4
--     GRN reference is missing (else derived automatically)
--   • is_adjust_advance — mark a bill as an Adjust-Against-Advance entry
-- Keyed by the Zoho task id so it survives snapshot refreshes.
-- ============================================================

create table if not exists public.bp_bill_trustdesk (
  bill_id           text primary key,
  submission_date   date,
  courier_date      date,
  remark            text,
  account           text,     -- SRET / SRAH / SRASSK / SRA override; null = auto from IN4 ref
  is_adjust_advance boolean not null default false,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null
);

comment on table public.bp_bill_trustdesk is
  'Backoffice-entered fields per SRA bill (Zoho task id) for the auto Daily Bills Report: submission/courier date, remark, account override, adjust-advance flag.';

alter table public.bp_bill_trustdesk enable row level security;

-- Read/write for any user whose role has bills-pipeline OR stuck-bills can_edit
-- (mirrors bp_bill_checklist so limited billing staff can fill it too).
drop policy if exists "bp_trustdesk_rw" on public.bp_bill_trustdesk;
create policy "bp_trustdesk_rw" on public.bp_bill_trustdesk
  for all to authenticated
  using (
    exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role::text = rp.role::text
      where p.id = auth.uid()
        and rp.module_slug in ('bills-pipeline', 'stuck-bills')
        and rp.can_edit = true
    )
  )
  with check (
    exists (
      select 1 from public.role_permissions rp
      join public.profiles p on p.role::text = rp.role::text
      where p.id = auth.uid()
        and rp.module_slug in ('bills-pipeline', 'stuck-bills')
        and rp.can_edit = true
    )
  );
