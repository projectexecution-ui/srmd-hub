-- The Internal Estimate was unwritable by ANYONE except a base-role admin.
--
-- cc_budget_lines carries a BEFORE trigger, cc_bl_gate_estimate, which SILENTLY
-- reverts any change to internal_estimate_* unless
--   can_approve('cost-control','cc_budget_line','any','estimate_set')
-- is true. can_approve auto-passes 'admin' and otherwise needs a matching
-- approval_rules row -- and there was NOT ONE for cc_budget_line. So the
-- Trustee, the only person the app ever offers this decision to, was silently
-- refused: the write "succeeded" and changed nothing. That is why the whole
-- Internal-Estimate accept/reject feature has been inert, and why two earlier
-- backfill migrations reported success while changing zero rows.
--
-- The HOD's rule needs the estimate to rise when the TRUSTEE releases a budget
-- above it, so the Trustee is exactly who this right belongs to. Admin keeps it
-- through the override and can_approve's built-in admin bypass. Everyone else
-- stays blocked, which is the whole point of the gate.

insert into public.approval_rules
  (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, is_active, is_blocking, notes)
select 'cost-control', 'cc_budget_line', 'any', 'estimate_set', 'founder', 'admin', true, false,
       'Trustee (or Admin) may set the Internal Estimate - including the automatic raise when a release exceeds it'
where not exists (
  select 1 from public.approval_rules
  where module_slug = 'cost-control' and doc_type = 'cc_budget_line'
    and from_stage = 'any' and to_stage = 'estimate_set'
);
