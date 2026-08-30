-- Aksha: "that Sub Category IE amt should follow ERP data na?" — yes, and it
-- was not. The mirror only recognised estimates IT had written
-- ('Follows the budget approved in ERP'). The other 39 were written by the
-- one-time backfill and by the release rule, so the mirror treated them as
-- somebody's considered estimate and froze them.
--
-- Nobody considered them. Every fixed note string in this table is
-- machine-written; cc_set_internal_estimate — the Trustee / IE-revision path —
-- stores whatever note the person types, so free text is the signal for a real
-- estimate and our own three fixed strings are the signal for a derived one.
-- internal_estimate_set_by is no help: the backfill ran as a user, so it is
-- stamped on 39 lines nobody looked at.
--
-- On ABGF · 12 Finishes this is the difference between the estimate on 1201
-- Doors sitting at ₹10,11,024 while ERP holds ₹7,11,024 forever, and it
-- following the budget down where it belongs.
--
-- The mirror follows ERP exactly, never max(ERP, approved): taking the higher
-- of the two would hold the giving line's estimate up after a transfer and
-- bring the ratchet straight back.
--
-- Verified on ABGF · 12 Finishes, ₹3,00,000 moved 1201 -> 1209 (rolled back):
--   Doors    ERP 7,11,024  IE 7,11,024   (followed down)
--   Painting ERP 6,15,945  IE 6,15,945   (followed up)
--   Category ERP 30,12,587 IE 30,12,587 -> 30,12,587 (still neutral)

create or replace function public.fn_cc_ie_follow_erp()
returns trigger language plpgsql as $fn$
declare
  v_erp   numeric;
  v_ie    numeric;
  v_note  text;
  v_mine  boolean;
begin
  v_erp := round(coalesce(new.current_budget_amt, 0));
  -- A line zeroed out of the IN4 report keeps whatever estimate it had.
  if v_erp <= 0 then return new; end if;

  v_ie   := round(coalesce(new.internal_estimate_amt, 0));
  v_note := coalesce(new.internal_estimate_notes, '');

  -- Every estimate this system derived for itself. Anything else — including
  -- an empty note — was typed by a person through cc_set_internal_estimate and
  -- is left alone.
  v_mine := new.internal_estimate_amt is null
         or v_note = 'Follows the budget approved in ERP'
         or v_note like 'Backfilled to the approved amount%'
         or v_note like 'Auto-updated to the approved amount on release of %';

  if not v_mine then
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
