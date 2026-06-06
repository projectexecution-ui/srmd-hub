-- Seed role_permissions for the new 'contractor-report' module so it's
-- visible to the right roles out of the box. Mirrors procurement-tracker
-- (admin full; uploader/head can use; viewer/founder/engineer/store_manager
-- view-only; site_staff/contractor/backoffice no access). Additive data
-- only — admins can change it from /admin/permissions afterwards.
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values
  ('admin',         'contractor-report', true,  true,  true),
  ('uploader',      'contractor-report', true,  true,  false),
  ('viewer',        'contractor-report', true,  false, false),
  ('founder',       'contractor-report', true,  false, false),
  ('head',          'contractor-report', true,  true,  false),
  ('engineer',      'contractor-report', true,  false, false),
  ('store_manager', 'contractor-report', true,  false, false),
  ('site_staff',    'contractor-report', false, false, false),
  ('contractor',    'contractor-report', false, false, false),
  ('backoffice',    'contractor-report', false, false, false)
on conflict (role, module_slug) do nothing;
