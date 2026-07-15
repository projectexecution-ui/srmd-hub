-- Rollback for 20260717_cc_summary_screenshot.
alter table public.cc_working_sheets
  drop column if exists summary_image_url,
  drop column if exists summary_image_name;
