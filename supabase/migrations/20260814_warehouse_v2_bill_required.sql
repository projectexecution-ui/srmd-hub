-- ===========================================================================
-- WAREHOUSE V2 — the signed and stamped bill is compulsory on every gate entry.
--
-- Aksha's rule, and it applies with a PO or without one: no material is written
-- into stock unless the supplier's own paperwork was photographed, carrying the
-- RECEIVER's signature and stamp and the DELIVERY PERSON's signature.
--
-- That photograph is the only independent record of the handover. Without it a
-- shortage is one person's word against another's months later; with it, both
-- sides signed the same piece of paper and we have the picture.
--
-- Enforced here rather than only in the form, because a rule that lives in one
-- screen is a rule until somebody writes a second screen.
-- ===========================================================================

alter table wh_gate_in drop constraint if exists wh_gate_in_bill_required;
alter table wh_gate_in add constraint wh_gate_in_bill_required
  check (coalesce(array_length(photo_urls, 1), 0) >= 1);

comment on constraint wh_gate_in_bill_required on wh_gate_in is
  'Every gate entry carries at least one page of the signed, stamped bill — with a PO or without.';
