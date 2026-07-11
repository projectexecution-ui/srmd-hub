-- ============================================================
-- Cost Control 3-stage chain — STAGE 3: cleanup drops (GATED)
-- ============================================================
-- APPLY ONLY after:
--   1. the cleanup + chain code is deployed and verified in prod, AND
--   2. a fresh CC Excel backup has been taken, AND
--   3. a one-off SQL export of the dropped tables has been saved.
-- Everything here is destructive-by-design (aggressive trim, approved).

-- Quantification subsystem — feature removed (engineers upload their own
-- workings; reviewers check with AI). Children first.
drop table if exists public.cc_ws_item_qty_rows;
drop table if exists public.cc_ws_item_qty_sections;
drop table if exists public.cc_qty_templates;
alter table public.cc_working_sheet_items drop column if exists qty_is_auto;

-- Dead tables from the original custom approval/permissions/bills engine —
-- superseded by approval_rules/can_approve + role_permissions + BPH pull.
-- Never referenced by any app code. cc_payments references cc_bills.
drop table if exists public.cc_payments;
drop table if exists public.cc_bills;
drop table if exists public.cc_approvals;
drop table if exists public.cc_approval_thresholds;
drop table if exists public.permission_policies;
drop table if exists public.user_permission_overrides;

-- pgvector duplicate-detection infra — never populated. The live lexical
-- matcher (lib/dup-detect.ts) needs none of this.
drop index if exists public.idx_ws_items_embedding;
alter table public.cc_working_sheet_items
  drop column if exists description_embedding,
  drop column if exists dup_status,
  drop column if exists dup_match_item_id,
  drop column if exists dup_match_score;
drop type if exists public.cc_dup_status;

-- Dead "manual Internal Estimate" columns — zero UI writers ever existed;
-- the real Internal Estimate is the live sum of working-sheet totals.
-- (cc_budget_lines.notes stays — it is live in the backup export.)
alter table public.cc_budget_lines
  drop column if exists internal_estimate_amt,
  drop column if exists internal_estimate_notes;
