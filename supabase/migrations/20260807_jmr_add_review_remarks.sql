-- Approver's comment on a JMR daily entry, captured when a Head/PM approves
-- or flags the day. Stored separately from work_description (the engineer's
-- own note) so neither field mutates the other. Nullable: a plain approve
-- carries no comment; a flag always does (enforced in the API).
alter table public.jmr_daily_entries
  add column if not exists review_remarks text;

comment on column public.jmr_daily_entries.review_remarks is
  'Approver note left on approve/flag (Head/PM). Distinct from work_description (engineer''s note).';
