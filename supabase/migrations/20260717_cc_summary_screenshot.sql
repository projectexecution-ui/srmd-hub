-- Engineer quick-mode uploads carry a screenshot of the Excel summary so
-- anyone opening the Working Sheet can glance the working without opening
-- the file. Stored in the private cc-sheets bucket; these columns hold the
-- storage path + original filename.
alter table public.cc_working_sheets
  add column if not exists summary_image_url text,
  add column if not exists summary_image_name text;
