-- ============================================================
-- JMR — extend public.user_role enum with 'contractor'
-- ============================================================
-- Must run BEFORE 20260523_jmr_foundation.sql because Postgres
-- forbids using a newly-added enum value in the same transaction
-- it's added. Splitting into two migrations gives each its own
-- transaction.
-- ============================================================

alter type public.user_role add value if not exists 'contractor';
