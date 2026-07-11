-- ============================================================
-- Cost Control 3-stage chain — STAGE 1: enum values ONLY
-- ============================================================
-- ALTER TYPE ... ADD VALUE cannot be used by other statements inside the
-- same transaction, so this migration contains nothing else. Stage 2
-- (rules + RPC + drift) follows in its own migration.
--
-- partially_approved formalises a value that already exists in prod but
-- was never added by a migration (repo drift fix).

alter type public.cc_ws_status add value if not exists 'partially_approved';
alter type public.cc_ws_status add value if not exists 'ph_approved';
alter type public.cc_ws_status add value if not exists 'atm_approved';

-- New first-stage approver role: Project Head. head = Atm Head (existing),
-- founder = Trustee (existing). Users are assigned via /admin/users.
alter type public.user_role add value if not exists 'project_head';
