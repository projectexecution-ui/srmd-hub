-- Rollback for 20260716_cc_release_request.
drop function if exists public.cc_request_release(uuid, text);
