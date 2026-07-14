-- Rollback for 20260715_cc_internal_estimate_and_combined.sql
-- NOTE: a Postgres enum value cannot be removed once added; 'combined' stays
-- on cc_line_type harmlessly (unused if the UI option is reverted). This
-- rollback drops the accept/reject function and clears any decisions made.

drop function if exists public.cc_set_internal_estimate(uuid, uuid, uuid, text, numeric);

-- Clear all Internal Estimate accept/reject decisions written by the feature.
update public.cc_budget_lines
   set internal_estimate_amt = null,
       internal_estimate_set_at = null,
       internal_estimate_set_by = null,
       internal_estimate_notes = null
 where internal_estimate_set_at is not null;
