-- ============================================================
-- Inventory approval rules: rebrand 'hop' → 'head' (Atm Head)
-- ============================================================
-- Bug surfaced during T4 of the test pass: every inventory approval
-- rule was seeded with approver_role='hop' (legacy name from the spec).
-- The workflow now uses 'head' for Atm Head. UI checks BOTH `head` and
-- `hop` for backwards compat, but the server-side can_approve() check
-- only looks at the literal column value, so anyone with role='head'
-- would see the Approve button and then get rejected by the RPC.
--
-- Fix: head is the primary approver, hop kept as a secondary rule for
-- profiles still carrying the legacy role. Admin still passes via the
-- short-circuit inside can_approve().
-- ============================================================

update public.approval_rules
   set approver_role = 'head', override_role = 'admin'
 where module_slug = 'inventory'
   and doc_type    = 'inv_request'
   and approver_role = 'hop'
   and to_stage in ('APPROVED','REJECTED_HOP','EMERGENCY_ISSUED');

insert into public.approval_rules (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, notes) values
  ('inventory','inv_request','PENDING_HOP','APPROVED',                  'hop','admin','Legacy HoP role — backward compat'),
  ('inventory','inv_request','PENDING_HOP','REJECTED_HOP',              'hop','admin','Legacy HoP role — backward compat'),
  ('inventory','inv_request','PENDING_BACKOFFICE','EMERGENCY_ISSUED',   'hop',null,   'Legacy HoP role — emergency bypass')
on conflict do nothing;
