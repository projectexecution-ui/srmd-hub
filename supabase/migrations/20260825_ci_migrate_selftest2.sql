-- CI self-test (round 2) for the auto-apply GitHub Action.
-- Harmless no-op — confirms the workflow connects to the live database with the
-- SUPABASE_DB_PASSWORD secret and the fixed connection settings.
do $$
begin
  raise notice 'CT Hub auto-migrate self-test #2 OK at %', now();
end
$$;
