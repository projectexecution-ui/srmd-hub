-- Slice 2 (per-type delivery timing) made notify_user insert email/web_push
-- deliveries with status='deferred' when the recipient's mode is 'daily', but
-- the notification_deliveries status CHECK constraint was never widened to
-- allow 'deferred'. So the first time any non-pinned event resolved to daily
-- (e.g. cc_estimate_approved, now set to Daily digest), notify_user threw a
-- constraint violation. Because notify_user runs inside AFTER-INSERT triggers
-- on approval_events (cc_notify_atm_on_approval / notify_on_approval_event),
-- that exception would roll back the whole transaction — i.e. a Trustee release
-- could fail. Widen the constraint to include 'deferred' (the digest sweep
-- flips it to 'sent'). Purely additive — only broadens the allowed set.
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status = any (array['pending','sent','failed','skipped','deferred']));
