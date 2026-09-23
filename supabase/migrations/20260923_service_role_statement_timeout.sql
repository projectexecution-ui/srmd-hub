-- ============================================================
-- The service role gets a 30 s statement timeout (was the inherited 8 s).
-- ============================================================
-- From 22 Sep 2026 09:21 IST every run of the Indent → PO tracker feed
-- failed at the same line:
--
--   procurement_tracker_state(global): canceling statement due to statement timeout
--
-- That write is ONE row of ~0.9 MB JSON (the whole tracker state, the blob
-- OLD INDENT TO PO reads). Supabase gives service_role no statement timeout
-- of its own, so PostgREST applies the authenticator's default of 8 s — and
-- with ~20 cron jobs bulk-upserting into the same small instance at once, the
-- write did not make it.
--
-- Only server-side code holds the service key (the IN4 feeds, the crons, the
-- cached readers). Browsers use anon (3 s) and authenticated (8 s), which
-- this does not touch. 30 s is ~4× the room the write needs on a quiet
-- instance and still well inside the function limit (120 s) that would
-- otherwise cut the run off with nothing recorded.
--
-- GUARDED: this only ever RAISES the limit. If someone has already set the
-- role to 30 s or more, or to 0 (unlimited), it is left exactly as it is.
-- Idempotent — safe to re-run.

do $$
declare
  cur text;
  cur_ms bigint;
begin
  select substring(s from '^statement_timeout=(.*)$') into cur
  from pg_db_role_setting r, unnest(r.setconfig) s
  where r.setrole = 'service_role'::regrole
    and r.setdatabase = 0
    and s like 'statement_timeout=%'
  limit 1;

  if cur is null then
    cur_ms := 8000;   -- nothing set on the role → PostgREST uses authenticator's 8 s
  else
    -- Let Postgres itself validate and normalise whatever unit it was written
    -- in ('8000', '8s', '2min' …), then read it back as an interval.
    perform set_config('statement_timeout', cur, true);
    cur_ms := (extract(epoch from current_setting('statement_timeout')::interval) * 1000)::bigint;
  end if;

  if cur_ms = 0 then
    raise notice 'service_role statement_timeout is 0 (unlimited) — left alone';
  elsif cur_ms >= 30000 then
    raise notice 'service_role statement_timeout is already % — left alone', cur;
  else
    execute 'alter role service_role set statement_timeout = ''30s''';
    raise notice 'service_role statement_timeout % -> 30s', coalesce(cur, '(inherited 8s)');
  end if;
end $$;

-- PostgREST caches each role's settings and applies them with SET LOCAL at the
-- start of every request. Without this it would keep using the old 8 s.
notify pgrst, 'reload config';
