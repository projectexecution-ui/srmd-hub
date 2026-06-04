-- Snapshot migration: brings the repo migrations in line with columns
-- that already exist in prod but had no migration file. Found during
-- the BEAST MODE bug audit — these columns are read/written by the code
-- and would silently break a fresh `supabase db reset`.
--
-- Idempotent (IF NOT EXISTS) so re-running is safe.

-- cc_excel_rows — quick-mode Excel WS breakdowns (per-cell formula trace).
alter table public.cc_excel_rows
  add column if not exists rate_breakdown   jsonb,
  add column if not exists amount_breakdown jsonb;

-- cc_working_sheets — deadline tracking + ERP-approved budget snapshot.
alter table public.cc_working_sheets
  add column if not exists deadline_date         date,
  add column if not exists deadline_notes        text,
  add column if not exists approved_for_erp_amt  numeric;

-- cc_budget_lines — internal estimate (kept separate from current_budget_amt
-- which mirrors the ERP). Used by the CC dashboard tiles.
alter table public.cc_budget_lines
  add column if not exists internal_estimate_amt   numeric,
  add column if not exists internal_estimate_notes text;
