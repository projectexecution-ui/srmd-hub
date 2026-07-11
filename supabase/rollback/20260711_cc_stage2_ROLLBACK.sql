-- ============================================================
-- ROLLBACK for 20260711_cc_stage2_approval_chain.sql
-- ============================================================
-- Restores the pre-chain approval behaviour in one shot. The old rules
-- were only DEACTIVATED (never deleted), so this re-activates them,
-- deactivates the new chain rules, and restores the old
-- cc_approve_release from-status guard.
--
-- Pre-migration snapshot (2026-07-11, prod): 11 active cost-control rules —
-- ids 33879db4 (estimate_set, deleted by stage2 — dead feature, not restored),
-- bb99b9d6 (deadline_set head/admin), 6a1b4917, bf8f38f3, 64c69e44,
-- 86fee6d1, 8761271b, 25e90bbc, c96b29d5, 6e49700b (transition rules).

-- 1. Deactivate every rule the chain migration introduced.
update public.approval_rules set is_active = false
 where module_slug = 'cost-control'
   and doc_type = 'cc_working_sheet'
   and (
     approver_role = 'project_head'
     or (from_stage, to_stage) in (
       ('ph_approved','atm_approved'), ('ph_approved','returned'),
       ('atm_approved','partially_approved'), ('atm_approved','approved'), ('atm_approved','returned'),
       ('submitted','atm_approved'),
       ('ph_approved','approved'), ('ph_approved','partially_approved'),
       ('draft','ph_approved'), ('draft','atm_approved'), ('draft','partially_approved'), ('draft','approved'),
       ('returned','ph_approved'), ('returned','atm_approved'), ('returned','partially_approved'), ('returned','approved')
     )
     -- blocker rows on old pairs are handled in step 2 (re-activation wins)
   );

-- 2. Re-activate the original pre-chain rule set (exact tuples from the
--    snapshot; admin blocker rows on the same pairs get deactivated).
update public.approval_rules set is_active = false
 where module_slug = 'cost-control' and doc_type = 'cc_working_sheet'
   and approver_role = 'admin' and notes like 'BLOCKED:%';

update public.approval_rules set is_active = true
 where id in (
   'bb99b9d6-3c9a-4e4f-9648-3f06cef53fe2',  -- any → deadline_set (head / admin)
   '6a1b4917-b9e2-4776-9892-c709ffa6268b',  -- partially_approved → approved (founder / admin)
   'bf8f38f3-99bb-48e7-8d8d-4f78be50521b',  -- partially_approved → approved (head ≤2L)
   '64c69e44-30b3-430c-981b-ff4f245c539b',  -- partially_approved → partially_approved (founder / admin)
   '86fee6d1-eab1-452f-89c2-621c4870ce88',  -- submitted → approved (founder / admin)
   '8761271b-bd12-4472-937f-d7eab2e774e2',  -- submitted → approved (head ≤2L)
   '25e90bbc-21ba-481b-9499-b42190bf648b',  -- submitted → partially_approved (founder / admin)
   '1d8737e0-199e-40b0-b588-292475280d62',  -- submitted → partially_approved (head ≤2L)
   'c96b29d5-0e51-47e6-a5e1-0e0f7a6fd0b6',  -- submitted → returned (admin)
   '6e49700b-fe69-44cc-baf8-7e3eaaa57fcf'   -- submitted → returned (head / founder)
 );

-- Restore the deadline rule's original override.
update public.approval_rules set override_role = 'admin'
 where id = 'bb99b9d6-3c9a-4e4f-9648-3f06cef53fe2';

-- 3. Restore the old cc_approve_release from-status guard: re-run the
--    body from 20260611_cc_review_hardening.sql lines 365-467 (guard:
--    status in ('submitted','partially_approved')). Kept verbatim there.
