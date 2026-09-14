-- Bills Approval, slice 2: IN4's approval trail, mirrored.
--
-- ENGG_WO_PAYMENT_AUDIT_TRAIL is the only place that records who moved a
-- certificate, when, to what, and why. 15,946 rows today. Nothing in CT Hub
-- can currently see any of it, which is why an approval in IN4 has to be
-- re-typed here to be known about.
--
-- Mirroring it is the foundation for three things that cannot be built
-- without it:
--   * the match / not-matched notice, which fires when a certificate reaches
--     Approved in IN4 and compares it to what was sanctioned here;
--   * how long a bill actually sat at each desk, which is the only number
--     that makes anybody move;
--   * the audit record itself — IN4 never deletes a trail row, and neither
--     does this.
--
-- One row per movement, keyed on IN4's own event id so a re-run is idempotent
-- and a row can never be counted twice.

create table if not exists public.in4_cert_events (
  event_id        integer primary key,          -- ENGG_WO_PAYMENT_AUDIT_TRAIL.ID
  certificate_id  integer not null,             -- AUTHORISATION_ID
  display_no      text,                         -- ENP/... — the number people read
  at              timestamptz not null,         -- MODIFIED_DT, to the second
  status          integer not null,
  status_name     text,                         -- Submitted/Verify/Approved/Processed/Paid/…
  actor_id        integer,
  actor_name      text,
  -- Free text in IN4 and often empty: 40% of ReSubmits, 25% of Approvals and
  -- 24% of Cancellations carry no reason at all. Stored as it is rather than
  -- defaulted, so the gap stays visible instead of being papered over.
  remark          text,
  synced_at       timestamptz not null default now()
);

-- "What happened to this bill" — the timeline on a bill screen.
create index if not exists in4_cert_events_cert_idx
  on public.in4_cert_events (certificate_id, at);

-- "What was approved today, and by whom" — the notification sweep and the
-- reconciliation both start from the most recent movements of one status.
create index if not exists in4_cert_events_status_at_idx
  on public.in4_cert_events (status_name, at desc);

alter table public.in4_cert_events enable row level security;

-- Read-only to signed-in users; only the service role writes, and only the
-- sync does that. This is IN4's record, not ours — nothing in the app should
-- ever be able to edit or remove a row.
drop policy if exists in4_cert_events_select on public.in4_cert_events;
create policy in4_cert_events_select on public.in4_cert_events
  for select to authenticated using (true);

comment on table public.in4_cert_events is
  'Mirror of IN4 ENGG_WO_PAYMENT_AUDIT_TRAIL. Append-only in practice: IN4 never edits a trail row. Never write from the app.';
