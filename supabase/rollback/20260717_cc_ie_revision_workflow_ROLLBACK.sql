-- Rollback for 20260717_cc_ie_revision_workflow.sql
drop function if exists public.cc_ie_finalize(uuid, jsonb);
drop function if exists public.cc_ie_decide_revision(uuid, text);
drop function if exists public.cc_ie_submit_revision(uuid, text, text);
drop function if exists public.cc_ie_decide_reopen(uuid, boolean, text);
drop function if exists public.cc_ie_request_reopen(uuid, text);
drop function if exists public.cc_ie_lock_state(uuid);
drop table if exists public.cc_ie_revisions;
