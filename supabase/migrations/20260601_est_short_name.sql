-- Add a concise display label to est_subcategories. Long IN4 descriptions
-- (200+ chars) are unreadable in the rate library — short_name keeps the
-- table scannable while the full name is preserved for tooltips.
alter table public.est_subcategories
  add column if not exists short_name text;
comment on column public.est_subcategories.short_name is
  'Concise label (≤60 chars) shown in tables. Auto-derived from name on IN4 import; editable in taxonomy editor.';
