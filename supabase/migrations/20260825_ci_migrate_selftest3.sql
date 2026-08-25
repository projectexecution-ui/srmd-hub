-- CI self-test (round 3) for the auto-apply GitHub Action.
-- Harmless no-op — confirms the workflow connects to the live database using the
-- SUPABASE_DB_URL secret.
do $$
begin
  raise notice 'CT Hub auto-migrate self-test #3 OK at %', now();
end
$$;
