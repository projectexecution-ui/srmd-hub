-- Performance: fix Supabase "auth_rls_initplan" on all Cost Control tables.
-- Every RLS policy that called auth.uid()/auth.role()/auth.jwt() was
-- re-evaluating it FOR EVERY ROW. Wrapping the call in a scalar subquery
-- ( SELECT auth.uid() ) makes Postgres evaluate it ONCE per query (an
-- InitPlan). Semantically identical — no change to who can see or do what;
-- lists just stop getting slower as rows grow.
--
-- Applied as an idempotent sweep so it stays correct if policies are added
-- later: it only rewrites policies on cost-control tables (+ project_assignments)
-- that still have a bare auth.*() call. Re-running is a no-op.
do $$
declare r record; stmt text;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (tablename like 'cc\_%' or tablename = 'project_assignments')
      and (coalesce(qual,'')       ~ 'auth\.(uid|role|jwt)\(\)'
        or coalesce(with_check,'') ~ 'auth\.(uid|role|jwt)\(\)')
      and coalesce(qual,'') || coalesce(with_check,'') not ilike '%(select auth.%'
  loop
    stmt := 'alter policy ' || quote_ident(r.policyname) || ' on public.' || quote_ident(r.tablename);
    if r.qual is not null then
      stmt := stmt || ' using (' || regexp_replace(r.qual, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')';
    end if;
    if r.with_check is not null then
      stmt := stmt || ' with check (' || regexp_replace(r.with_check, 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g') || ')';
    end if;
    execute stmt;
  end loop;
end $$;
