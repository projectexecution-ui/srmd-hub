-- Supplier payments get their dates.
--
-- The supplier mirror (in4_supplier_certificates) had no date column, so
-- ₹1.18 Cr of supplier payments could not be placed in a month or FY
-- (build order §9). IN4 does hold the dates — BI.DIM_PURCHASE_SUPPLIER_PAY
-- carries CERTIFICATE_DT and INVOICE_DT per certificate, the same columns the
-- PO ledger already reads live. The supplier feed now copies them here.
--
-- Applied to live via Supabase MCP on 11 Sep 2026.

alter table public.in4_supplier_certificates
  add column if not exists certificate_date date,
  add column if not exists invoice_date date;
