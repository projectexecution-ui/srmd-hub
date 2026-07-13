-- CC reshape stage 1: the 'billing' role enum value.
-- ALTER TYPE ... ADD VALUE cannot be used by later statements in the same
-- transaction, so it ships alone (same split as 20260711 stage1/stage2).
alter type public.user_role add value if not exists 'billing';
