-- ============================================================
-- Smart Blueprint Phase 1: extend approval_rules with two optional
-- columns so the admin matrix can carry SLA thresholds + a default
-- escalation target. Both nullable — existing rules stay unchanged.
--
-- Behaviour wired in this phase:
--   - sla_hours        → drives breach detection in sla_inbox()
--   - escalate_to_role → schema only; Phase 2 wires the cron that
--                        actually notifies that role on breach.
-- ============================================================

alter table public.approval_rules
  add column if not exists sla_hours        integer,
  add column if not exists escalate_to_role text;

comment on column public.approval_rules.sla_hours is
  'If a doc stays in `from_stage` longer than this, the SLA dashboard flags it as breached. Null = no SLA configured.';
comment on column public.approval_rules.escalate_to_role is
  'Role to notify when this transition is breached. Schema-only in Phase 1; cron-driven escalation wires in Phase 2.';
