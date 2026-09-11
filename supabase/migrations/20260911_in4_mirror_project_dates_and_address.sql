-- The Project Master screen was reading ENGG_PROJECT and ENGG_SUBPROJECT live
-- on every page load. IN4 is an RDS in us-east-1 and this app runs in Mumbai,
-- so each of those reads crossed the ocean — measured at roughly half a second
-- of pure network, with the query itself taking no measurable time at all.
--
-- Everything that screen shows is reference data that changes rarely, and most
-- of it was already mirrored; the loader even had a mirror fallback already.
-- These are the six fields that were missing, and the only reason the fallback
-- stayed a fallback: the plan dates, the readable status, and the site address.
-- With them the page is served entirely from Supabase, which sits in
-- ap-south-1 — the same city as the app.

alter table public.in4_projects
  add column if not exists estimated_start_dt date,
  add column if not exists estimated_end_dt   date,
  -- COMMON_STATUS_LOOKUP.NAME. The numeric `status` stays as IN4's own value;
  -- this is the word a person reads.
  add column if not exists status_name text,
  -- Resolved from ADDR_ID through COMMON_ADDRESS and COMMON_LOCATION_LOOKUP by
  -- the extractor, so the screen never has to know that chain.
  add column if not exists addr text,
  add column if not exists pin  text,
  add column if not exists city text;

alter table public.in4_subprojects
  add column if not exists estimated_start_dt date,
  add column if not exists estimated_end_dt   date,
  add column if not exists status_name text;
