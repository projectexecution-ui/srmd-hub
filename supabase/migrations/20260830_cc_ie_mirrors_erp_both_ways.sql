-- Stop the Internal Estimate ratcheting up on an internal IN4 transfer.
--
-- The rule was "only ever raise", so that a downward correction in the ERP
-- could not drag the estimate with it. Right for a number a person set. Wrong
-- for one the machine copied from the ERP budget in the first place: when
-- budget moves from 311 to 317 inside 03 Civil, the receiving line's estimate
-- rose to its new budget while the giving line's stayed at its old one, so the
-- category's estimate grew by the transferred amount though not a rupee of new
-- money entered the project. Repeat that and it inflates every time.
--
-- The distinction is ownership, not direction:
--
--   * An estimate the ERP rule set (notes = 'Follows the budget approved in
--     ERP') is a MIRROR of that line's ERP budget. It now follows the budget
--     both up AND down. A transfer moves both mirrors with both budgets, so the
--     category total is unchanged and there is nothing to ratchet.
--
--   * An estimate anyone or anything else set — a Trustee, the [IB] import, the
--     release-follows-approval rule, the one-time backfill — is a real number
--     with a real author. The ERP rule does not touch it at all, which is what
--     the HOD actually asked for: "if NO IE is established, consider the
--     approved amount in ERP".
--
-- Ownership beats a category-level cap because it needs no knowledge of the
-- other rows: it gives the same answer whichever order the sync writes them in.
-- A cap does not — write the receiving line first and the raise slips through
-- before the giving line has been reduced.
--
-- Nothing needs recomputing: 142 of the 146 categories already have estimate
-- exactly equal to ERP budget, and the four that differ are all owned by the
-- other two rules, so this leaves them alone.
--
-- Known residual: a line zeroed because it dropped out of the IN4 report keeps
-- its estimate rather than being zeroed with it. Erasing an estimate because a
-- report omitted a line once is the worse failure, so the guard stays.
--
-- Verified on live data before shipping (all probes rolled back):
--   • AB · 03 Civil, ₹5,00,000 moved 317 -> 311, receiving line written FIRST:
--     category ERP 87,37,739 -> 87,37,739, category IE 87,37,739 -> 87,37,739.
--     Under the old rule the estimate would have become 92,37,739.
--   • Genuine new budget on a mirrored line: IE followed 22,708 -> 9,22,708.
--   • A backfill-owned line: ERP 1,00,000 -> 8,00,000, IE stayed 1,00,000.

create or replace function public.fn_cc_ie_follow_erp()
returns trigger language plpgsql as $fn$
declare
  v_erp   numeric;
  v_ie    numeric;
  v_mine  boolean;
begin
  v_erp := round(coalesce(new.current_budget_amt, 0));
  -- A line zeroed out of the IN4 report keeps whatever estimate it had.
  if v_erp <= 0 then return new; end if;

  v_ie := round(coalesce(new.internal_estimate_amt, 0));

  -- Does this rule own the value sitting there?
  v_mine := new.internal_estimate_amt is null
         or coalesce(new.internal_estimate_notes, '') = 'Follows the budget approved in ERP';

  if not v_mine then
    -- Somebody established an estimate. Leave it alone.
    return new;
  end if;

  -- Ours: mirror the ERP budget, in whichever direction it moved.
  if v_erp <> v_ie then
    new.internal_estimate_amt    := new.current_budget_amt;
    new.internal_estimate_set_at := now();
    new.internal_estimate_notes  := 'Follows the budget approved in ERP';
  end if;
  return new;
end
$fn$;
