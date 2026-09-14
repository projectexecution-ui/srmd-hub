-- Bills Approval, slice 1.
--
-- Two columns the mirror was missing, both needed before any bill screen can
-- name a certificate the way a person does.
--
-- display_no is the number printed on the document and read out loud —
-- "ENP/SRASSK/SQ/2026-27/237". It lives in ENGG_WO_PAYMENT_AUTHORISATION.
-- DISPLAY_NO. What the mirror already had, certificate_id, is IN4's internal
-- serial (3107); the two are NOT the same field even though they sit side by
-- side on IN4's own screen, and quoting the serial downstream is how the wrong
-- certificate gets discussed in a meeting.
--
-- status_name is COMMON_STATUS_LOOKUP.NAME for the status integer already
-- stored. Ten of them are in real use on work-order payments: Submitted,
-- Verify, Approved, Processed, Paid, Partially Paid, ReSubmit, Cancelled,
-- Hold, Reversed. Resolving the name here rather than in the app keeps one
-- lookup table out of every query that has to group by it.
--
-- Additive only. Both nullable: the next sync fills them, and nothing reads
-- them until it has.

alter table public.in4_wo_certificates
  add column if not exists display_no  text,
  add column if not exists status_name text;

-- The org view groups open money by project and ages it; every one of those
-- queries filters on a live status and orders by creation. Without this it is
-- a full scan of the certificate mirror on every page load.
create index if not exists in4_wo_certificates_status_idx
  on public.in4_wo_certificates (status_name, creation_dt);

comment on column public.in4_wo_certificates.display_no is
  'IN4 ENGG_WO_PAYMENT_AUTHORISATION.DISPLAY_NO — the ENP/... number on the document. Show this, never certificate_id.';
comment on column public.in4_wo_certificates.status_name is
  'COMMON_STATUS_LOOKUP.NAME for status. Submitted/Verify/Approved/Processed/Paid/Partially Paid/ReSubmit/Cancelled/Hold/Reversed.';
