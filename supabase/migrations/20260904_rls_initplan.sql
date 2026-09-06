-- Row-security policies that call auth.uid() / auth.role() / auth.jwt() directly
-- re-evaluate the function for EVERY ROW the query touches. Wrapping the call
-- as (select auth.uid()) makes Postgres evaluate it once per statement (an
-- "InitPlan"). Supabase's performance advisor flagged 132 such policies on
-- 4 Sept 2026 — on tables the hub reads on every page (profiles, permissions,
-- module_visibility, working sheets), so this is CPU on every request.
--
-- Self-applying and idempotent: it rewrites whatever is still unwrapped at the
-- time it runs, so re-running it (the merge-time Action does) is a no-op. The
-- policy text is taken from pg_policies and only the auth.*() calls change;
-- roles, commands and everything else stay exactly as they were.
do $$
declare
  r record;
  q text;
  c text;
  n int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    q := regexp_replace(
           regexp_replace(coalesce(r.qual, ''), '(?<![(\s]select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi'),
           '\(\s*select\s+\(select auth\.(uid|role|jwt)\(\)\)\s*(as \w+)?\)', '(select auth.\1())', 'gi');
    c := regexp_replace(
           regexp_replace(coalesce(r.with_check, ''), '(?<![(\s]select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi'),
           '\(\s*select\s+\(select auth\.(uid|role|jwt)\(\)\)\s*(as \w+)?\)', '(select auth.\1())', 'gi');
    if (r.qual is not null and q <> r.qual) or (r.with_check is not null and c <> r.with_check) then
      execute format('alter policy %I on public.%I%s%s',
        r.policyname, r.tablename,
        case when r.qual is not null then ' using (' || q || ')' else '' end,
        case when r.with_check is not null then ' with check (' || c || ')' else '' end);
      n := n + 1;
    end if;
  end loop;
  raise notice 'rls_initplan: rewrote % policies', n;
end $$;
