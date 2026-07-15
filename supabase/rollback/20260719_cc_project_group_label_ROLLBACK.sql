-- Rollback for 20260719_cc_project_group_label.
alter table public.projects
  drop column if exists group_label;
