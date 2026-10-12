-- When a bill's IN4 figures were last re-read by hand (Aksha, 12 Oct 2026: a
-- one-click "Refresh from IN4" for the desk owners). Shown on the bill as how
-- fresh its IN4 figures are, and used to stop a double-click reading IN4 twice.
alter table public.bb_bills add column if not exists in4_refreshed_at timestamptz;
