-- Optional custom label for a project GROUP (shown on the Cost Control
-- dashboard group band). Set on the PARENT project; when blank the band
-- falls back to the parent's short code. Additive, nullable.
alter table public.projects
  add column if not exists group_label text;
