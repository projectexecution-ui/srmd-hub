-- Additive: a sub-category for the item master so the catalogue report can group
-- Category → Sub-category (industry-standard stock register). Nullable, free text,
-- mirrors the existing free-text `category`. Inert until surfaced in the UI.
alter table public.inv_items add column if not exists subcategory text;
comment on column public.inv_items.subcategory is 'Optional sub-category under category, for catalogue grouping.';
