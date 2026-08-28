-- The Internal Estimate must also follow the ERP figure.
--
-- I implemented the HOD's rule 2 from CT Hub's own released amount, but he said
-- "the Approved amt POST REFLECTING IN ERP". Those are different numbers, and
-- the difference is most of the problem: only 49 lines carry a CT Hub release,
-- while 343 carry an ERP budget. Aksha found it on NGH "1801 Consultant Fees" —
-- ERP 6,490, fully paid, no estimate, no working sheet at all.
--
-- 166 lines had an ERP budget with no estimate and 26 sat below it: 36.66 Cr
-- short between them.
--
-- A BEFORE trigger on the SAME row, so the estimate is set inside the incoming
-- write rather than by a second UPDATE - no recursion, nothing for the BPH sync
-- to race with.
--
-- ORDERING MATTERS. cc_bl_gate_estimate is also a BEFORE row trigger and it
-- reverts internal_estimate_* when can_approve(...'estimate_set') is false,
-- which is always the case for the BPH sync's service-role writes. Postgres
-- fires BEFORE row triggers in NAME order, so this one is deliberately named to
-- sort AFTER 'trg_cc_bl_gate_estimate' ('i' > 'g'): the gate restores the old
-- value first, then this sets the new one and it survives. Renaming either
-- trigger silently breaks this. The bypass is intended - a system rule
-- following ERP is not a person editing an estimate.

create or replace function public.fn_cc_ie_follow_erp()
returns trigger
language plpgsql
as $function$
declare
  v_erp numeric;
  v_ie  numeric;
begin
  v_erp := round(coalesce(new.current_budget_amt, 0));
  if v_erp <= 0 then return new; end if;

  v_ie := round(coalesce(new.internal_estimate_amt, 0));

  -- Only ever RAISE. An ERP budget that drops (a correction, a re-map) must not
  -- drag the estimate down with it.
  if v_erp > v_ie then
    new.internal_estimate_amt    := new.current_budget_amt;
    new.internal_estimate_set_at := now();
    new.internal_estimate_notes  := 'Follows the budget approved in ERP';
  end if;
  return new;
end
$function$;

comment on function public.fn_cc_ie_follow_erp() is
  'Raises internal_estimate_amt to current_budget_amt whenever ERP approves more than the estimate. Never lowers. Must fire AFTER trg_cc_bl_gate_estimate - see the migration.';

drop trigger if exists trg_cc_bl_ie_follow_erp on public.cc_budget_lines;
create trigger trg_cc_bl_ie_follow_erp
  before insert or update of current_budget_amt, internal_estimate_amt on public.cc_budget_lines
  for each row
  execute function public.fn_cc_ie_follow_erp();

-- Backfill the 192 lines already sitting above their estimate. Touching
-- current_budget_amt is enough - the trigger reads it and raises the estimate
-- in the same row. Setting it to itself is a no-op for the ERP figure, which is
-- why it is written this way rather than assigning internal_estimate_amt
-- directly and fighting the gate.
update public.cc_budget_lines
set current_budget_amt = current_budget_amt
where sub_skill_id is not null
  and line_type = 'work'
  and round(coalesce(current_budget_amt, 0)) > 0
  and round(coalesce(current_budget_amt, 0)) > round(coalesce(internal_estimate_amt, 0));
