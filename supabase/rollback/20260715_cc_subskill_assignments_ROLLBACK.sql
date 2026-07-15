-- Rollback for 20260715_cc_subskill_assignments.
drop function if exists public.cc_set_subskill_engineer(uuid, uuid, uuid);
drop table if exists public.cc_subskill_assignments;
