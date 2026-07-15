-- Rollback for 20260720_cc_project_approvers.
drop function if exists public.cc_set_project_approver(uuid, text, uuid, boolean);
drop table if exists public.cc_project_approvers;
