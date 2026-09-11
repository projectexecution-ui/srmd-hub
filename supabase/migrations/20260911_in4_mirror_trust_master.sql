-- Trust Master, off live IN4 and onto the mirror.
--
-- The screen made three round trips to us-east-1 on every load to fetch 4
-- trusts, 2 GST registrations and 36 projects. About half a second each of
-- pure network, for 42 rows.
--
-- in4_companies already mirrored the trusts, but only id, name, code and print
-- name — so the fallback rendered address, PAN, e-mail, phone and GST blank,
-- which is why the live path stayed primary. The rest of TBLCOMMONCOMPANY
-- comes across now, and the GST registrations get a table of their own, since
-- a trust may hold several (one per registered address).
--
-- in4_projects already carries the site address and IN4's status name — that
-- landed with the Project Master move.

alter table public.in4_companies
  add column if not exists address       text,
  add column if not exists print_address text,
  add column if not exists pin           text,
  add column if not exists print_pin     text,
  add column if not exists email         text,
  add column if not exists phone         text,
  add column if not exists pan           text,
  add column if not exists city          text,
  add column if not exists state         text,
  add column if not exists is_active     boolean not null default true;

-- FIN_COMPANY_GSTIN_LOOKUP: one row per registration, keyed by its own ID
-- rather than the company, because a trust can hold more than one. Two rows
-- today (SRET and SRJT); SRASSK and SRMD Fixed Assets hold none, and the
-- screen says so in words rather than showing an empty box.
create table if not exists public.in4_company_gstins (
  id          integer primary key,
  company_id  integer not null,
  gstin       text not null,
  address     text,
  pincode     text,
  synced_at   timestamptz not null default now()
);
create index if not exists in4_company_gstins_company_idx on public.in4_company_gstins (company_id);

alter table public.in4_company_gstins enable row level security;
drop policy if exists in4_company_gstins_read on public.in4_company_gstins;
create policy in4_company_gstins_read on public.in4_company_gstins
  for select to authenticated using ((select auth.uid()) is not null);
