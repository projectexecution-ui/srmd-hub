-- Accounts reads IN4 the way IN4 reads itself.
--
-- Aksha, 21 Sep 2026: "lot of overlapping of data — recheck with IN4". The lane
-- summed every certificate row in the mirror as it stood, so it reported
-- ₹11.92 Cr outstanding where IN4's live bills carry ₹5.13 Cr:
--   • 98 CANCELLED certificates (status 6) keep their outstanding amount —
--     ₹4.75 Cr. 52 of them are the dead first copy of a bill that was cancelled
--     and re-raised, so the same bill sat on the screen twice.
--   • ADVANCES are counted beside the bills that recover them — ₹2.04 Cr of
--     "outstanding" on advance rows whose recovery already shows on the RA bills.
--   • RETENTION-RELEASE certificates were added to work certified (₹1.21 Cr),
--     and advances to certified too (₹35.89 Cr) — neither is work.
--   • 249 supplier advances carry no date at all; every one has a PO with one.
--
-- So: one view that spells out, per certificate, whether it is live, whether it
-- is an advance, whether it is a retention release, and the best date it can be
-- aged by (invoice → certificate → PO). Every Accounts function reads that view
-- and takes p_raw: false (the default) is the true picture, true is IN4 exactly
-- as it is — the same rule the project-level Accounts tab has followed since
-- 11 Sep (lib/accounts/payments.ts), so both screens finally agree.
--
-- Nothing here writes to IN4 or changes a figure IN4 holds. Certified, paid,
-- outstanding and retention are still IN4's own numbers; the view only decides
-- which rows a total may include.

-- ── The ledger view ─────────────────────────────────────────────────────────
drop view if exists public.cc_accounts_ledger;
create view public.cc_accounts_ledger as
  select 'contractor'::text                               as kind,
         c.certificate_id                                 as certificate_id,
         c.kind                                           as cert_kind,        -- wo | advance | misc
         c.certificate_type                               as cert_type,        -- Running | Final | Advance | Misc | Retention | SalesTax
         c.status                                         as status_code,
         c.status_name                                    as status_name,
         (c.status = 6 or c.status_name = 'Cancelled')    as is_cancelled,
         (c.kind = 'advance')                             as is_advance,
         (c.certificate_type = 'Retention')               as is_retention_release,
         c.contractor_id::bigint                          as party_id,
         c.contractor_name                                as party_name,
         -- One key for one firm, however IN4 spells or numbers it: 31 parties
         -- are a contractor in one series and a supplier in another, 14 more
         -- carry two ids on the same side.
         regexp_replace(lower(coalesce(c.contractor_name, '')), '[^a-z0-9]', '', 'g') as party_key,
         c.project_id, c.subproject_id,
         c.wo_id, null::int                               as po_id,
         c.wo_no                                          as order_no,
         c.invoice_no                                     as ref_no,
         c.display_no,
         coalesce(c.invoice_date, c.creation_dt)::date    as doc_date,
         case when c.invoice_date is not null then 'invoice'
              when c.creation_dt  is not null then 'certificate' end as date_source,
         coalesce(c.gross_bill_amt, 0)                    as gross,
         coalesce(c.certified_amt, 0)                     as certified,
         coalesce(c.paid_amt, 0)                          as paid,
         coalesce(c.outstanding_amt, 0)                   as outstanding,
         coalesce(c.retention_amt, 0)                     as retention,
         coalesce(c.deductions, 0) + coalesce(c.recoveries, 0) as deductions,
         coalesce(c.advance_recovery_amt, 0)              as adv_recovery
    from in4_wo_certificates c
  union all
  select 'supplier',
         s.certificate_id,
         s.kind,                                                                -- payment | advance
         case when s.kind = 'advance' then 'Advance' else 'Supplier' end,
         s.status,
         -- IN4's status codes, as in4_cert_events spells them.
         case s.status when 1 then 'Submitted' when 2 then 'Approved' when 6 then 'Cancelled'
                       when 8 then 'Processed' when 15 then 'Paid' when 60 then 'ReSubmit'
                       when 75 then 'Partially Paid' when 84 then 'Reversed' when 113 then 'Verify'
                       when 121 then 'Hold' else s.status::text end,
         (s.status = 6),
         (s.kind = 'advance'),
         false,
         s.supplier_id::bigint,
         s.supplier_name,
         regexp_replace(lower(coalesce(s.supplier_name, '')), '[^a-z0-9]', '', 'g'),
         s.project_id, s.subproject_id,
         null::int, s.po_id,
         coalesce(po.po_no, 'PO #' || s.po_id::text),
         s.certificate_no,
         null::text,
         -- A supplier advance has no invoice and no certificate date in IN4, but
         -- it always has the purchase order it was paid against.
         coalesce(s.invoice_date, s.certificate_date, po.po_dt)::date,
         case when s.invoice_date     is not null then 'invoice'
              when s.certificate_date is not null then 'certificate'
              when po.po_dt           is not null then 'po' end,
         coalesce(nullif(s.landed_cost, 0), s.certified_amt, 0),
         coalesce(s.certified_amt, 0),
         coalesce(s.paid, 0),
         coalesce(s.outstanding, 0),
         coalesce(s.retention, 0),
         coalesce(s.tax_deduction, 0) + coalesce(s.debit_note_adj, 0),
         coalesce(s.adv_recovery, 0)
    from in4_supplier_certificates s
    left join in4_purchase_orders po on po.po_id = s.po_id;

grant select on public.cc_accounts_ledger to authenticated;

-- ── Which rows a total may include ──────────────────────────────────────────
-- true figures (p_raw = false):
--   certified   — live bills only; not advances, not retention releases
--   outstanding — live bills only; not advances (their recovery is on the bills)
--   paid        — every live row, advances included: cash that left is cash that left
--   retention   — every live row
-- raw (p_raw = true): every row, exactly as the mirror holds it.
create or replace function public.cc_accounts_rows(p_raw boolean default false)
returns table (
  kind text, certificate_id int, cert_kind text, cert_type text, status_code int, status_name text,
  is_cancelled boolean, is_advance boolean, is_retention_release boolean,
  party_id bigint, party_name text, party_key text,
  project_id int, subproject_id int, wo_id int, po_id int,
  order_no text, ref_no text, display_no text, doc_date date, date_source text,
  gross numeric, certified numeric, paid numeric, outstanding numeric, retention numeric,
  deductions numeric, adv_recovery numeric,
  in_certified boolean, in_outstanding boolean, in_paid boolean
) language sql stable set search_path to 'public' as $fn$
  select l.kind, l.certificate_id, l.cert_kind, l.cert_type, l.status_code, l.status_name,
         l.is_cancelled, l.is_advance, l.is_retention_release,
         l.party_id, l.party_name, l.party_key,
         l.project_id, l.subproject_id, l.wo_id, l.po_id,
         l.order_no, l.ref_no, l.display_no, l.doc_date, l.date_source,
         l.gross, l.certified, l.paid, l.outstanding, l.retention, l.deductions, l.adv_recovery,
         (p_raw or (not l.is_cancelled and not l.is_advance and not l.is_retention_release)) as in_certified,
         (p_raw or (not l.is_cancelled and not l.is_advance))                                as in_outstanding,
         (p_raw or  not l.is_cancelled)                                                       as in_paid
    from cc_accounts_ledger l
   where p_raw or not l.is_cancelled;
$fn$;

-- ── Headline numbers ────────────────────────────────────────────────────────
create or replace function public.cc_accounts_summary(p_raw boolean default false)
returns table (
  owed numeric, over90 numeric, n_over90 bigint, parties_open bigint, parties_over90 bigint,
  retention_held numeric, releases_pending bigint, releases_pending_amt numeric,
  paid_30d numeric, paid_prev_30d numeric,
  hidden_cancelled numeric, hidden_advances numeric, hidden_rows bigint,
  certified numeric, paid numeric, certificates bigint
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  with r as (select * from cc_accounts_rows(p_raw)),
  parties as (
    select party_key, sum(outstanding) filter (where in_outstanding) as o,
           max(current_date - doc_date) filter (where in_outstanding and outstanding > 0) as oldest
      from r where coalesce(party_key, '') <> '' group by party_key
  )
  select round(coalesce(sum(r.outstanding) filter (where r.in_outstanding), 0)),
         round(coalesce(sum(r.outstanding) filter (where r.in_outstanding and r.outstanding > 0 and current_date - r.doc_date > 90), 0)),
         count(*) filter (where r.in_outstanding and r.outstanding > 0 and current_date - r.doc_date > 90)::bigint,
         (select count(*) from parties where o > 0)::bigint,
         (select count(*) from parties where o > 0 and oldest > 90)::bigint,
         round(coalesce(sum(r.retention) filter (where r.in_paid), 0)),
         count(*) filter (where r.is_retention_release and r.status_name not in ('Paid', 'Cancelled'))::bigint,
         round(coalesce(sum(r.outstanding) filter (where r.is_retention_release and r.status_name not in ('Paid', 'Cancelled')), 0)),
         round(coalesce(sum(r.paid) filter (where r.in_paid and r.doc_date >  current_date - 30), 0)),
         round(coalesce(sum(r.paid) filter (where r.in_paid and r.doc_date <= current_date - 30 and r.doc_date > current_date - 60), 0)),
         -- What the true view leaves out, so the screen can say so in one line.
         (select round(coalesce(sum(l.outstanding), 0)) from cc_accounts_ledger l where l.is_cancelled),
         (select round(coalesce(sum(l.outstanding), 0)) from cc_accounts_ledger l where not l.is_cancelled and l.is_advance),
         (select count(*) from cc_accounts_ledger l where l.is_cancelled)::bigint,
         round(coalesce(sum(r.certified) filter (where r.in_certified), 0)),
         round(coalesce(sum(r.paid) filter (where r.in_paid), 0)),
         count(*)::bigint
    from r;
end $fn$;

-- ── Trustwise ───────────────────────────────────────────────────────────────
drop function if exists public.cc_accounts_by_trust();
create or replace function public.cc_accounts_by_trust(p_raw boolean default false)
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
         round(coalesce(sum(x.certified)   filter (where x.in_certified), 0)),
         round(coalesce(sum(x.paid)        filter (where x.in_paid), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)),
         round(coalesce(sum(x.retention)   filter (where x.in_paid), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.outstanding > 0 and current_date - x.doc_date <= 30), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.outstanding > 0 and current_date - x.doc_date between 31 and 90), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.outstanding > 0 and current_date - x.doc_date > 90), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.outstanding > 0 and x.doc_date is null), 0)),
         count(*) filter (where x.in_outstanding and x.outstanding > 0 and current_date - x.doc_date > 90)::bigint,
         count(*) filter (where x.in_outstanding and x.outstanding > 0 and x.doc_date is null)::bigint,
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.kind = 'contractor'), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding and x.kind = 'supplier'), 0)),
         count(distinct x.project_id)::bigint,
         count(distinct x.party_key) filter (where coalesce(x.party_key, '') <> '')::bigint
    from cc_accounts_rows(p_raw) x
    left join in4_projects  p  on p.id = x.project_id
    left join in4_companies co on co.id = p.cert_company_id
   group by co.id, co.code, co.name
   order by round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)) desc nulls last;
end $fn$;

drop function if exists public.cc_accounts_trust_projects(int);
create or replace function public.cc_accounts_trust_projects(p_trust int, p_raw boolean default false)
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
      from cc_accounts_rows(p_raw) x
  )
  select coalesce(ip.ex_code, ip.name),
         string_agg(distinct cert.hub_code, ', '),
         (array_agg(cert.hub_id) filter (where cert.hub_id is not null))[1],
         count(*)::bigint,
         round(coalesce(sum(cert.certified)   filter (where cert.in_certified), 0)),
         round(coalesce(sum(cert.paid)        filter (where cert.in_paid), 0)),
         round(coalesce(sum(cert.outstanding) filter (where cert.in_outstanding), 0)),
         round(coalesce(sum(cert.retention)   filter (where cert.in_paid), 0)),
         round(coalesce(sum(cert.outstanding) filter (where cert.in_outstanding and cert.outstanding > 0 and current_date - cert.doc_date > 90), 0))
    from cert
    join in4_projects ip on ip.id = cert.project_id
   where ip.cert_company_id = p_trust
   group by ip.id, coalesce(ip.ex_code, ip.name)
   order by round(coalesce(sum(cert.outstanding) filter (where cert.in_outstanding), 0)) desc nulls last,
            round(coalesce(sum(cert.certified) filter (where cert.in_certified), 0)) desc;
end $fn$;

drop function if exists public.cc_accounts_trust_parties(int);
create or replace function public.cc_accounts_trust_parties(p_trust int, p_raw boolean default false)
returns table (
  party_key text, party_name text, kinds text,
  certificates bigint, certified numeric, paid numeric, outstanding numeric, retention numeric,
  oldest_unpaid_days int
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.party_key, min(x.party_name),
         string_agg(distinct x.kind, ' · ' order by x.kind),
         count(*)::bigint,
         round(coalesce(sum(x.certified)   filter (where x.in_certified), 0)),
         round(coalesce(sum(x.paid)        filter (where x.in_paid), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)),
         round(coalesce(sum(x.retention)   filter (where x.in_paid), 0)),
         max(current_date - x.doc_date) filter (where x.in_outstanding and x.outstanding > 0)::int
    from cc_accounts_rows(p_raw) x
    join in4_projects ip on ip.id = x.project_id
   where ip.cert_company_id = p_trust
     and coalesce(x.party_key, '') <> ''
   group by x.party_key
   order by round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)) desc nulls last,
            round(coalesce(sum(x.certified) filter (where x.in_certified), 0)) desc;
end $fn$;

-- ── Party wise ──────────────────────────────────────────────────────────────
-- One row per FIRM (party_key), not per IN4 id: the 31 firms IN4 lists once as a
-- contractor and again as a supplier become one line, with the trusts it works
-- under and the money each trust owes it — the "same party under three trusts"
-- that read as double-counting when it was three separate rows.
--   p_open_only  — only firms with money outstanding (the default list)
--   p_q          — a search over the name; settled firms are reached this way
drop function if exists public.cc_accounts_by_party();
create or replace function public.cc_accounts_by_party(p_raw boolean default false, p_open_only boolean default true, p_q text default null)
returns table (
  party_key text, party_name text, kinds text, party_ids text,
  projects bigint, certificates bigint,
  certified numeric, paid numeric, outstanding numeric, retention numeric,
  oldest_unpaid_days int, trusts jsonb
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
declare q text := nullif(regexp_replace(lower(coalesce(p_q, '')), '[^a-z0-9]', '', 'g'), '');
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  with x as (
    select r.*, co.code as trust_code
      from cc_accounts_rows(p_raw) r
      left join in4_projects p  on p.id = r.project_id
      left join in4_companies co on co.id = p.cert_company_id
     where coalesce(r.party_key, '') <> ''
       and (q is null or r.party_key like '%' || q || '%')
  ),
  by_trust as (
    select party_key, trust_code, round(coalesce(sum(outstanding) filter (where in_outstanding), 0)) as o
      from x group by party_key, trust_code
  )
  select x.party_key, min(x.party_name),
         string_agg(distinct x.kind, ' · ' order by x.kind),
         string_agg(distinct x.kind || ':' || x.party_id::text, ', '),
         count(distinct x.project_id)::bigint, count(*)::bigint,
         round(coalesce(sum(x.certified)   filter (where x.in_certified), 0)),
         round(coalesce(sum(x.paid)        filter (where x.in_paid), 0)),
         round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)),
         round(coalesce(sum(x.retention)   filter (where x.in_paid), 0)),
         max(current_date - x.doc_date) filter (where x.in_outstanding and x.outstanding > 0)::int,
         (select jsonb_agg(jsonb_build_object('trust', bt.trust_code, 'outstanding', bt.o) order by bt.o desc)
            from by_trust bt where bt.party_key = x.party_key and bt.trust_code is not null)
    from x
   group by x.party_key
  having (not p_open_only) or round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)) > 0
   order by round(coalesce(sum(x.outstanding) filter (where x.in_outstanding), 0)) desc nulls last,
            round(coalesce(sum(x.certified) filter (where x.in_certified), 0)) desc;
end $fn$;

-- One firm's ledger, every certificate under every id IN4 gave it, newest first.
-- Carries what a row can open: the CT Hub project, and the Bills desk when the
-- same bill number is moving there.
drop function if exists public.cc_accounts_party_ledger(text, bigint);
create or replace function public.cc_accounts_party_ledger(p_party_key text, p_raw boolean default false)
returns table (
  kind text, certificate_id int, cert_type text, status_name text,
  is_cancelled boolean, is_advance boolean, is_retention_release boolean,
  ref_no text, order_no text, doc_date date, date_source text,
  project_code text, project_name text, hub_project_id uuid, trust_code text,
  certified numeric, paid numeric, outstanding numeric, retention numeric,
  wo_id int, po_id int, bill_id uuid
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.kind, x.certificate_id, x.cert_type, x.status_name,
         x.is_cancelled, x.is_advance, x.is_retention_release,
         x.ref_no, x.order_no, x.doc_date, x.date_source,
         coalesce(hub.code, ip.ex_code), coalesce(hub.name, ip.name), hub.id, co.code,
         case when x.in_certified   then x.certified   else 0 end,
         case when x.in_paid        then x.paid        else 0 end,
         case when x.in_outstanding then x.outstanding else 0 end,
         case when x.in_paid        then x.retention   else 0 end,
         x.wo_id, x.po_id, bb.id
    from cc_accounts_rows(p_raw) x
    left join in4_projects  ip on ip.id = x.project_id
    left join in4_companies co on co.id = ip.cert_company_id
    left join lateral (
      select bl.cc_project_id
        from in4_subproject_links sl
        join cc_bph_project_links bl on bl.bph_project_id = sl.bph_project_id
       where sl.subproject_id = x.subproject_id
       order by bl.cc_project_id limit 1) lk on true
    left join projects hub on hub.id = lk.cc_project_id
    left join lateral (
      select b.id from bb_bills b
       where b.in4_subproject_id = x.subproject_id
         and b.is_example is not true
         and x.ref_no is not null
         and regexp_replace(lower(coalesce(b.bill_no, '')), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(x.ref_no), '[^a-z0-9]', '', 'g')
       limit 1) bb on true
   where x.party_key = p_party_key
   order by x.doc_date desc nulls last, x.certificate_id desc;
end $fn$;

-- ── FY Wise ─────────────────────────────────────────────────────────────────
drop function if exists public.cc_accounts_by_fy();
create or replace function public.cc_accounts_by_fy(p_raw boolean default false)
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
      from cc_accounts_rows(p_raw) x
  )
  select case when y.ystart is null then 'No date in IN4'
              else 'FY ' || y.ystart || '-' || lpad(((y.ystart + 1) % 100)::text, 2, '0') end,
         y.ystart,
         count(*)::bigint,
         round(coalesce(sum(y.certified)   filter (where y.in_certified), 0)),
         round(coalesce(sum(y.paid)        filter (where y.in_paid), 0)),
         round(coalesce(sum(y.outstanding) filter (where y.in_outstanding), 0)),
         round(coalesce(sum(y.retention)   filter (where y.in_paid), 0))
    from y
   group by y.ystart
   order by y.ystart desc nulls last;
end $fn$;

-- ── Retention ───────────────────────────────────────────────────────────────
-- Held per trust, releases IN4 is still processing, and released to date. Today
-- retention is a column nobody can act on; this is the lane behind it.
create or replace function public.cc_accounts_retention_by_trust(p_raw boolean default false)
returns table (
  trust_id int, trust_code text, trust_name text,
  held numeric, bills_with_retention bigint, parties bigint,
  releases_pending bigint, releases_pending_amt numeric, released_so_far numeric
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select co.id, co.code, co.name,
         round(coalesce(sum(x.retention) filter (where x.in_paid and not x.is_retention_release), 0)),
         count(*) filter (where x.in_paid and x.retention > 0 and not x.is_retention_release)::bigint,
         count(distinct x.party_key) filter (where x.in_paid and x.retention > 0)::bigint,
         count(*) filter (where x.is_retention_release and x.status_name not in ('Paid', 'Cancelled'))::bigint,
         round(coalesce(sum(x.outstanding) filter (where x.is_retention_release and x.status_name not in ('Paid', 'Cancelled')), 0)),
         round(coalesce(sum(x.certified) filter (where x.is_retention_release and x.status_name = 'Paid'), 0))
    from cc_accounts_rows(p_raw) x
    left join in4_projects  p  on p.id = x.project_id
    left join in4_companies co on co.id = p.cert_company_id
   group by co.id, co.code, co.name
   order by 4 desc nulls last;
end $fn$;

create or replace function public.cc_accounts_retention_by_party(p_raw boolean default false)
returns table (
  party_key text, party_name text, kinds text, trusts text,
  held numeric, bills bigint, oldest_bill_days int, projects text
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
begin
  if not fn_cc_can_open_accounts((select auth.uid())) then
    raise exception 'Accounts is limited to the people named in Cost Control settings';
  end if;
  return query
  select x.party_key, min(x.party_name),
         string_agg(distinct x.kind, ' · ' order by x.kind),
         string_agg(distinct co.code, ', ' order by co.code),
         round(coalesce(sum(x.retention), 0)),
         count(*)::bigint,
         max(current_date - x.doc_date)::int,
         string_agg(distinct coalesce(p.ex_code, p.name), ', ' order by coalesce(p.ex_code, p.name))
    from cc_accounts_rows(p_raw) x
    left join in4_projects  p  on p.id = x.project_id
    left join in4_companies co on co.id = p.cert_company_id
   where x.in_paid and x.retention > 0 and not x.is_retention_release
     and coalesce(x.party_key, '') <> ''
   group by x.party_key
   order by 5 desc;
end $fn$;

grant execute on function public.cc_accounts_rows(boolean) to authenticated;
grant execute on function public.cc_accounts_summary(boolean) to authenticated;
grant execute on function public.cc_accounts_by_trust(boolean) to authenticated;
grant execute on function public.cc_accounts_trust_projects(int, boolean) to authenticated;
grant execute on function public.cc_accounts_trust_parties(int, boolean) to authenticated;
grant execute on function public.cc_accounts_by_party(boolean, boolean, text) to authenticated;
grant execute on function public.cc_accounts_party_ledger(text, boolean) to authenticated;
grant execute on function public.cc_accounts_by_fy(boolean) to authenticated;
grant execute on function public.cc_accounts_retention_by_trust(boolean) to authenticated;
grant execute on function public.cc_accounts_retention_by_party(boolean) to authenticated;
