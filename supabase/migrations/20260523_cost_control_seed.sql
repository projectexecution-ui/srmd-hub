-- ============================================================
-- Cost Control — seed disciplines and sub-skills
-- ============================================================
-- These are placeholder values based on spec section 2's mention
-- of "35 disciplines, 19 commonly used". Mayank will provide the
-- authoritative list as data/disciplines.csv + data/sub_skills.csv.
-- Replace this seed once those CSVs land.
-- ============================================================

insert into public.cc_disciplines (code, name, display_order) values
  ('01', 'Site Pre-lims',              1),
  ('02', 'Earthworks - Building',      2),
  ('03', 'Civil',                      3),
  ('04', 'Waterproofing',              4),
  ('05', 'Structural Steel',           5),
  ('06', 'Masonry & Plaster',          6),
  ('07', 'Electrical',                 7),
  ('08', 'Plumbing',                   8),
  ('09', 'Fire Fighting',              9),
  ('10', 'HVAC',                      10),
  ('11', 'Aluminium & Glass',         11),
  ('12', 'Finishes',                  12),
  ('13', 'Flooring',                  13),
  ('14', 'False Ceiling',             14),
  ('15', 'Doors & Hardware',          15),
  ('16', 'Wood Work',                 16),
  ('17', 'Painting',                  17),
  ('18', 'Lifts',                     18),
  ('19', 'Site Development',          19),
  ('20', 'Solar',                     20),
  ('35', 'Kitchen',                   35)
on conflict (code) do nothing;

-- Minimal seed sub-skills — Mayank to replace with full list.
-- For each discipline, at least one default sub-skill so the UI is exercisable.
insert into public.cc_sub_skills (discipline_id, code, name, default_uom)
select d.id, sub.code, sub.name, sub.uom
from public.cc_disciplines d
join (values
  ('01', '101', 'Site Mobilization',         'Ls'),
  ('02', '201', 'Excavation',                'Cum'),
  ('03', '301', 'Anti Termite Treatment',    'Sft'),
  ('03', '302', 'Steel Works',               'MT'),
  ('03', '303', 'RCC Works',                 'Cum'),
  ('04', '401', 'Roof Waterproofing',        'Sft'),
  ('05', '501', 'Structural Steel Erection', 'MT'),
  ('06', '601', 'Brick Masonry',             'Cum'),
  ('06', '602', 'Internal Plaster',          'Sft'),
  ('07', '701', 'Conduiting',                'Rm'),
  ('07', '702', 'Wiring',                    'Rm'),
  ('08', '801', 'Soil Lines',                'Rm'),
  ('08', '802', 'Water Lines',               'Rm'),
  ('09', '901', 'Fire Hydrant System',       'Ls'),
  ('10', '1001', 'AHU Installation',         'Nos'),
  ('11', '1101', 'Aluminium Windows',        'Sft'),
  ('12', '1201', 'Wall Tiles',               'Sft'),
  ('12', '1209', 'Painting',                 'Sft'),
  ('13', '1301', 'Vitrified Flooring',       'Sft'),
  ('14', '1401', 'Gypsum False Ceiling',     'Sft'),
  ('15', '1501', 'Flush Doors',              'Nos'),
  ('16', '1601', 'Modular Wardrobes',        'Sft'),
  ('17', '1701', 'Internal Painting',        'Sft'),
  ('17', '1702', 'External Painting',        'Sft'),
  ('18', '1801', 'Passenger Lift',           'Nos'),
  ('19', '1901', 'Pavers',                   'Sft'),
  ('20', '2001', 'Solar PV Panels',          'KW'),
  ('35', '3501', 'Kitchen Counter',          'Rm')
) as sub(discipline_code, code, name, uom)
  on sub.discipline_code = d.code
on conflict (discipline_id, code) do nothing;

-- Seed default permission_policies for Cost Control resources.
-- Admin can edit any cell later via /admin/permissions.
insert into public.permission_policies (role, resource_type, flag_name, is_allowed, scope) values
  -- Working Sheets
  ('admin',    'cc_working_sheet', 'can_view',                 true,  'all'),
  ('admin',    'cc_working_sheet', 'can_create',               true,  'all'),
  ('admin',    'cc_working_sheet', 'can_edit_draft',           true,  'all'),
  ('admin',    'cc_working_sheet', 'can_submit_for_approval',  true,  'all'),
  ('admin',    'cc_working_sheet', 'can_approve',              true,  'all'),
  ('admin',    'cc_working_sheet', 'can_reject_return',        true,  'all'),
  ('admin',    'cc_working_sheet', 'can_edit_after_approval',  true,  'all'),
  ('admin',    'cc_working_sheet', 'can_delete',               true,  'all'),
  ('admin',    'cc_working_sheet', 'can_override_duplicate',   true,  'all'),

  ('founder',  'cc_working_sheet', 'can_view',                 true,  'all'),
  ('founder',  'cc_working_sheet', 'can_approve',              true,  'all'),
  ('founder',  'cc_working_sheet', 'can_reject_return',        true,  'all'),
  ('founder',  'cc_working_sheet', 'can_edit_after_approval',  true,  'all'),

  ('head',     'cc_working_sheet', 'can_view',                 true,  'discipline'),
  ('head',     'cc_working_sheet', 'can_approve',              true,  'discipline'),
  ('head',     'cc_working_sheet', 'can_reject_return',        true,  'discipline'),
  ('head',     'cc_working_sheet', 'can_edit_after_approval',  true,  'discipline'),

  ('engineer', 'cc_working_sheet', 'can_view',                 true,  'assigned'),
  ('engineer', 'cc_working_sheet', 'can_create',               true,  'assigned'),
  ('engineer', 'cc_working_sheet', 'can_edit_draft',           true,  'own'),
  ('engineer', 'cc_working_sheet', 'can_submit_for_approval',  true,  'own'),
  ('engineer', 'cc_working_sheet', 'can_override_duplicate',   true,  'own'),

  ('viewer',   'cc_working_sheet', 'can_view',                 true,  'assigned'),

  -- Projects (Cost Control context)
  ('admin',    'cc_project', 'can_view',                  true,  'all'),
  ('admin',    'cc_project', 'can_create',                true,  'all'),
  ('admin',    'cc_project', 'can_configure_categories',  true,  'all'),
  ('admin',    'cc_project', 'can_assign_users',          true,  'all'),

  ('founder',  'cc_project', 'can_view',                  true,  'all'),
  ('founder',  'cc_project', 'can_view_other_projects',   true,  'all'),

  ('head',     'cc_project', 'can_view',                  true,  'assigned'),
  ('head',     'cc_project', 'can_view_other_projects',   true,  'all'),

  ('uploader', 'cc_project', 'can_view',                  true,  'assigned'),
  ('uploader', 'cc_project', 'can_create',                true,  'all'),
  ('uploader', 'cc_project', 'can_configure_categories',  true,  'assigned'),
  ('uploader', 'cc_project', 'can_assign_users',          true,  'assigned'),

  ('engineer', 'cc_project', 'can_view',                  true,  'assigned'),

  ('viewer',   'cc_project', 'can_view',                  true,  'assigned')
on conflict (role, resource_type, flag_name) do nothing;
