-- The Accounts lane: money across the whole hub, not one project.
--
-- Trustwise, Party wise Ledger and FY Wise are all questions whose answer spans
-- every project, which is why they get their own section rather than a tab
-- inside one. Desai Construction alone runs across 14 projects.
--
-- Aggregated here rather than in the app for one plain reason: there are 6,331
-- certificates and PostgREST returns 1,000 rows by default. Summing them in the
-- page would have silently reported a fraction of the money — the same trap the
-- warehouse sync hit. Three small result sets come back instead.
--
-- The source is the two IN4 certificate mirrors. Certified, paid, outstanding
-- and retention are taken AS IN4 HOLDS THEM and never recomputed: IN4 nets
-- recoveries, deductions and advance recovery in its own way, and a total this
-- screen invented would disagree with the ERP the moment anyone checked.

-- Who may open Accounts: the named list Aksha set on 10 Sep 2026, plus admins
-- and the Portal Owner. Mirrors lib/revamp/accounts-access.ts exactly, so the
-- screen and the data agree about who is allowed.
create or replace function public.fn_cc_can_open_accounts(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select exists (
    select 1 from profiles p
     where p.id = p_user
       and (p.role::text = 'admin' or p.is_portal_owner
            or position(p.id::text in coalesce(
                 (select s.value from app_settings s where s.key = 'cc_accounts_users'), '')) > 0)
  );
$fn$;

-- Every certificate, contractor and supplier alike, in one shape. The two
-- tables name the same columns differently; this is the only place that
-- difference is spelled out.
create or replace view public.cc_accounts_certificates as
  select 'contractor'::text                as kind,
         c.certificate_id                  as certificate_id,
         c.contractor_id                   as party_id,
         c.contractor_name                 as party_name,
         c.project_id                      as project_id,
         c.subproject_id                   as subproject_id,
         c.wo_no                           as order_no,
         c.invoice_no                      as ref_no,
         -- Both sources hold a plain calendar date. Cast explicitly so the union
         -- cannot settle on another type, and nothing shifts a certificate across a
         -- day boundary on its way to the screen.
         coalesce(c.invoice_date, c.creation_dt)::date as doc_date,
         coalesce(c.certified_amt, 0)      as certified,
         coalesce(c.paid_amt, 0)           as paid,
         coalesce(c.outstanding_amt, 0)    as outstanding,
         coalesce(c.retention_amt, 0)      as retention
    from in4_wo_certificates c
  union all
  select 'supplier',
         s.certificate_id,
         s.supplier_id,
         s.supplier_name,
         s.project_id,
         s.subproject_id,
         null,
         s.certificate_no,
         coalesce(s.invoice_date, s.certificate_date)::date,
         coalesce(s.certified_amt, 0),
         coalesce(s.paid, 0),
         coalesce(s.outstanding, 0),
         coalesce(s.retention, 0)
    from in4_supplier_certificates s;

-- Trustwise — grouped by the trust that certifies the project's work.
create or replace function public.cc_accounts_by_trust()
returns table (
  trust_id int, trust_code text, trust_name text,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric
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
         round(sum(x.outstanding)), round(sum(x.retention))
    from cc_accounts_certificates x
    left join in4_projects  p  on p.id = x.project_id
    left join in4_companies co on co.id = p.cert_company_id
   group by co.id, co.code, co.name
   order by round(sum(x.certified)) desc nulls last;
end $fn$;

-- Party wise — one row per contractor or supplier, across every project.
-- Ordered by what is still outstanding, because that is what a ledger is read
-- for. Kind is part of the identity: IN4 numbers contractors and suppliers in
-- separate series, so 41 can be both.
create or replace function public.cc_accounts_by_party()
returns table (
  kind text, party_id bigint, party_name text,
  projects bigint, certificates bigint,
  certified numeric, paid numeric, outstanding numeric, retention numeric
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.kind, x.party_id::bigint, x.party_name,
         count(distinct x.project_id)::bigint, count(*)::bigint,
         round(sum(x.certified)), round(sum(x.paid)),
         round(sum(x.outstanding)), round(sum(x.retention))
    from cc_accounts_certificates x
   where coalesce(btrim(x.party_name), '') <> ''
   group by x.kind, x.party_id, x.party_name
   order by round(sum(x.outstanding)) desc nulls last, round(sum(x.certified)) desc;
end $fn$;

-- FY Wise — Indian financial years, April to March. A certificate with no date
-- cannot be placed in a year, so it gets its own row rather than being dropped
-- or quietly folded into the current year: on 11 Sep 2026 that was 245
-- certificates carrying 9.93 crore, and a report that loses it silently is
-- worse than one that shows where the gap is.
create or replace function public.cc_accounts_by_fy()
returns table (
  fy text, fy_start int,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  with y as (
    select x.*,
           case when x.doc_date is null then null
                else extract(year from (x.doc_date - interval '3 months'))::int end as ystart
      from cc_accounts_certificates x
  )
  select case when y.ystart is null then 'No date in IN4'
              else 'FY ' || y.ystart || '-' || lpad(((y.ystart + 1) % 100)::text, 2, '0') end,
         y.ystart,
         count(*)::bigint,
         round(sum(y.certified)), round(sum(y.paid)),
         round(sum(y.outstanding)), round(sum(y.retention))
    from y
   group by y.ystart
   order by y.ystart desc nulls last;
end $fn$;

-- One party's ledger: every certificate, newest first. The drill-down behind a
-- row on the Party wise list.
drop function if exists public.cc_accounts_party_ledger(text, bigint);
create or replace function public.cc_accounts_party_ledger(p_kind text, p_party_id bigint)
returns table (
  certificate_id bigint, ref_no text, order_no text, doc_date date,
  project_code text, project_name text,
  certified numeric, paid numeric, outstanding numeric, retention numeric
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.certificate_id::bigint, x.ref_no, x.order_no, x.doc_date,
         coalesce(hub.code, ip.ex_code), coalesce(hub.name, ip.name),
         x.certified, x.paid, x.outstanding, x.retention
    from cc_accounts_certificates x
    left join in4_projects ip on ip.id = x.project_id
    -- The CT Hub name where the sub-project is linked, IN4's own otherwise.
    left join in4_subproject_links sl on sl.subproject_id = x.subproject_id
    left join cc_bph_project_links bl on bl.bph_project_id = sl.bph_project_id
    left join projects hub on hub.id = bl.cc_project_id
   where x.kind = p_kind and x.party_id = p_party_id
   order by x.doc_date desc nulls last, x.certificate_id desc;
end $fn$;

grant execute on function public.fn_cc_can_open_accounts(uuid) to authenticated;
grant execute on function public.cc_accounts_by_trust() to authenticated;
grant execute on function public.cc_accounts_by_party() to authenticated;
grant execute on function public.cc_accounts_by_fy() to authenticated;
grant execute on function public.cc_accounts_party_ledger(text, bigint) to authenticated;
