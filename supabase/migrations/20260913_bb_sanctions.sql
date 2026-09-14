-- Bills Approval, the write side: the Atm Head's sanction, and the check that
-- IN4 ends up agreeing with it.
--
-- Decided by Aksha on 13 Sep 2026: the Atm Head clicks here and nowhere else,
-- CT Billing keys the approval into IN4 afterwards, and CT Hub compares the two
-- for as long as the bill lives. The consequence, taken with open eyes, is that
-- IN4's trail will name whoever in Billing entered it rather than the Atm Head
-- — so THIS TABLE IS THE RECORD OF WHO SANCTIONED. It has to behave like
-- evidence, not like a working note.
--
-- Three rules follow from that, and they are enforced here rather than trusted
-- to the UI:
--
--   1. The amount is captured at the moment of the click and can never be
--      edited. A sanction you can revise afterwards proves nothing.
--   2. Nothing is ever deleted. A sanction that turns out to be wrong is
--      superseded by a new row on the same certificate, and both stay.
--   3. Only the reconciliation columns move, and only the service role moves
--      them. No human hand touches the verdict.
--
-- Keyed on IN4's certificate id because that is what actually exists on both
-- sides — CT Hub's own bb_bills row may never be created for a bill that was
-- entered straight into IN4, and the sanction still has to be recordable.

create table if not exists public.bb_sanctions (
  id                  uuid primary key default gen_random_uuid(),
  certificate_id      integer not null,
  -- Copied at sanction time, not joined later: if the mirror is re-synced or a
  -- row disappears, the evidence of what was approved must not change with it.
  display_no          text,
  wo_no               text,
  contractor_name     text,
  project_name        text,

  -- What was on the screen when the button was pressed.
  sanctioned_amount   numeric not null check (sanctioned_amount > 0),
  sanctioned_by       uuid references public.profiles(id) on delete set null,
  sanctioned_at       timestamptz not null default now(),
  note                text,

  -- Superseded rather than edited. A later sanction on the same certificate
  -- sets this on the earlier one; the earlier row stays readable forever.
  superseded_by       uuid references public.bb_sanctions(id) on delete set null,

  -- Filled only by the reconciliation sweep, service role only.
  checked_at          timestamptz,
  verdict             text check (verdict in ('matched','amount_differs','awaiting_in4','gone')),
  in4_amount          numeric,
  in4_status          text,
  in4_approved_at     timestamptz,
  in4_approved_by     text,
  notified_at         timestamptz,

  created_at          timestamptz not null default now()
);

-- One live sanction per certificate; superseded ones are unlimited.
create unique index if not exists bb_sanctions_live_cert_idx
  on public.bb_sanctions (certificate_id) where superseded_by is null;
create index if not exists bb_sanctions_verdict_idx
  on public.bb_sanctions (verdict, checked_at);

alter table public.bb_sanctions enable row level security;

-- Admin only, deliberately, matching the rest of the section.
drop policy if exists bb_sanctions_select on public.bb_sanctions;
create policy bb_sanctions_select on public.bb_sanctions for select to authenticated using (
  exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'bills-booking' and rp.can_admin = true));

-- Insert is allowed for the same people, and ONLY insert. There is deliberately
-- no update or delete policy: a signed-in user, however senior, cannot alter a
-- sanctioned amount, mark something matched, or make a sanction disappear.
-- The sweep runs as the service role, which bypasses RLS.
drop policy if exists bb_sanctions_insert on public.bb_sanctions;
create policy bb_sanctions_insert on public.bb_sanctions for insert to authenticated with check (
  sanctioned_by = auth.uid()
  and exists (select 1 from public.role_permissions rp, public.profiles p
              where p.id = auth.uid() and rp.role = p.role
                and rp.module_slug = 'bills-booking' and rp.can_admin = true));

comment on table public.bb_sanctions is
  'The Atm Head''s sanction — the record of who approved what, now that IN4''s trail names CT Billing instead. Append-only: no update or delete policy exists for users.';
comment on column public.bb_sanctions.sanctioned_amount is
  'Locked at the click. Never edited — a later decision is a new row with superseded_by set on the old one.';
