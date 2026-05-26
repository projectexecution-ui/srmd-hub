-- JMR — let a single bill split an item into multiple lines when the
-- rate changed mid-period (e.g. JCB @ ₹500 before 31-Mar, ₹600 after).
-- Each line carries the date range it covers so the report can show
-- A (before) + B (after) = grand total.
alter table public.jmr_bill_line_items
  add column if not exists effective_from date,
  add column if not exists effective_to   date;

comment on column public.jmr_bill_line_items.effective_from is
  'Earliest entry date this bill line covers — used when an item has multiple rate periods inside one bill (rate escalation / devaluation).';
comment on column public.jmr_bill_line_items.effective_to is
  'Latest entry date this bill line covers.';
