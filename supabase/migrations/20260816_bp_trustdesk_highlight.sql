-- Per-bill highlight for the Daily Bills Report (backoffice can flag a row
-- red / yellow; the flag shows in the on-screen table, the copy-image PNG,
-- and the combined PDF). Empty/NULL = no highlight.
alter table public.bp_bill_trustdesk add column if not exists highlight text;
