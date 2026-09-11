-- Trustwise was five numbers a row. The number that actually moves anyone is
-- how OLD the unpaid money is: on 11 Sep 2026, 7.39 crore of the 11.59 crore
-- outstanding was already past 90 days — 64% of it. A trust total that does not
-- say that is just a figure.
--
-- So the list carries the ageing, and a trust opens into the two breakdowns
-- behind it: which projects hold the money, and who is owed it.
--
-- One thing worth knowing about the counts. The first cut said "27 projects"
-- and then listed 52 rows: the summary counted IN4 projects while the
-- breakdown grouped by the CT Hub name resolved through sub-project links, and
-- one IN4 project often covers several CT Hub ones. Two numbers for one word is
-- a bug in the reading, so both count IN4's project — the unit the trust
-- certifies against — and the CT Hub names ride along as a label. Parties are
-- counted the same way at both ends too: the identity is (kind, id), because
-- IN4 numbers contractors and suppliers separately and one firm can be both.

drop function if exists public.cc_accounts_by_trust();
create or replace function public.cc_accounts_by_trust()
returns table (
  trust_id int, trust_code text, trust_name text,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric,
  amt_0_30 numeric, amt_31_90 numeric, amt_over90 numeric, amt_undated numeric,
  n_over90 bigint, n_undated bigint,
  outst_contractor numeric, outst_supplier numeric,
  projects bigint, parties bigint
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select co.id, co.code, co.name,
         count(*)::bigint,
         round(sum(x.certified)), round(sum(x.paid)),
         round(sum(x.outstanding)), round(sum(x.retention)),
         round(coalesce(sum(x.outstanding) filter (where x.outstanding > 0 and current_date - x.doc_date <= 30), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.outstanding > 0 and current_date - x.doc_date between 31 and 90), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.outstanding > 0 and current_date - x.doc_date > 90), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.outstanding > 0 and x.doc_date is null), 0)),
         count(*) filter (where x.outstanding > 0 and current_date - x.doc_date > 90)::bigint,
         count(*) filter (where x.outstanding > 0 and x.doc_date is null)::bigint,
         round(coalesce(sum(x.outstanding) filter (where x.kind = 'contractor'), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.kind = 'supplier'), 0)),
         count(distinct x.project_id)::bigint,
         count(distinct (x.kind || ':' || coalesce(x.party_id::text, x.party_name)))::bigint
    from cc_accounts_certificates x
    left join in4_projects  p  on p.id = x.project_id
    left join in4_companies co on co.id = p.cert_company_id
   group by co.id, co.code, co.name
   order by round(sum(x.outstanding)) desc nulls last;
end $fn$;

drop function if exists public.cc_accounts_trust_projects(int);
create or replace function public.cc_accounts_trust_projects(p_trust int)
returns table (
  project_label text, hub_codes text, hub_project_id uuid,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric,
  amt_over90 numeric
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  with cert as (
    select x.*,
           -- Scalar sub-selects, so the link tables can only ever add a NAME to
           -- a certificate, never a second copy of it. uuid has no min(), so
           -- the id is picked with order by / limit rather than aggregated.
           (select string_agg(distinct pr.code, ', ')
              from in4_subproject_links sl
              join cc_bph_project_links bl on bl.bph_project_id = sl.bph_project_id
              join projects pr on pr.id = bl.cc_project_id
             where sl.subproject_id = x.subproject_id) as hub_code,
           (select bl.cc_project_id
              from in4_subproject_links sl
              join cc_bph_project_links bl on bl.bph_project_id = sl.bph_project_id
             where sl.subproject_id = x.subproject_id
             order by bl.cc_project_id limit 1) as hub_id
      from cc_accounts_certificates x
  )
  select coalesce(ip.ex_code, ip.name),
         string_agg(distinct cert.hub_code, ', '),
         (array_agg(cert.hub_id) filter (where cert.hub_id is not null))[1],
         count(*)::bigint,
         round(sum(cert.certified)), round(sum(cert.paid)),
         round(sum(cert.outstanding)), round(sum(cert.retention)),
         round(coalesce(sum(cert.outstanding) filter (where cert.outstanding > 0 and current_date - cert.doc_date > 90), 0))
    from cert
    join in4_projects ip on ip.id = cert.project_id
   where ip.cert_company_id = p_trust
   group by ip.id, coalesce(ip.ex_code, ip.name)
   order by round(sum(cert.outstanding)) desc nulls last, round(sum(cert.certified)) desc;
end $fn$;

-- Who this one trust owes. Ordered by outstanding, with the oldest unpaid
-- certificate's age beside it, because "who" and "how long" are one question.
-- A null age means that certificate has no date in IN4 — unknown, which the
-- screen must not render as "new".
create or replace function public.cc_accounts_trust_parties(p_trust int)
returns table (
  kind text, party_id bigint, party_name text,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric,
  oldest_unpaid_days int
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.kind, x.party_id::bigint, x.party_name,
         count(*)::bigint,
         round(sum(x.certified)), round(sum(x.paid)),
         round(sum(x.outstanding)), round(sum(x.retention)),
         max((current_date - x.doc_date)) filter (where x.outstanding > 0)::int
    from cc_accounts_certificates x
    join in4_projects ip on ip.id = x.project_id
   where ip.cert_company_id = p_trust
     and coalesce(btrim(x.party_name), '') <> ''
   group by x.kind, x.party_id, x.party_name
   order by round(sum(x.outstanding)) desc nulls last, round(sum(x.certified)) desc;
end $fn$;

grant execute on function public.cc_accounts_by_trust() to authenticated;
grant execute on function public.cc_accounts_trust_projects(int) to authenticated;
grant execute on function public.cc_accounts_trust_parties(int) to authenticated;
