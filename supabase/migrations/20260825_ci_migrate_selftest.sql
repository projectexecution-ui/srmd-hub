-- CI self-test for the auto-apply GitHub Action.
-- Proves the workflow can connect to the live database with the SUPABASE_DB_URL
-- secret and run a migration. Completely harmless: a no-op that changes nothing
-- and leaves nothing behind.
do $$
begin
  raise notice 'CT Hub auto-migrate self-test OK at %', now();
end
$$;
