-- Inventory module — add the four new approval-flow roles to user_role.
-- Must run in its own transaction before any subsequent migration uses
-- these enum values (Postgres rule).
alter type public.user_role add value if not exists 'backoffice';
alter type public.user_role add value if not exists 'backoffice_backup';
alter type public.user_role add value if not exists 'store_manager';
alter type public.user_role add value if not exists 'hop';
-- 'engineer' already exists in the enum (JMR module).
