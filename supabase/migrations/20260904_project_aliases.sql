-- One alias table for "what the other systems call our projects".
--
-- The audit found the same building spelt up to six ways across six places:
-- procurement_known_projects (IN4's spelling), budget_v2_* (keyed by name),
-- cc_bph_project_links, the Bills Pipeline's hardcoded codes, Warehouse's
-- exact-name match, the bills digest assignments. Each importer guessed on its
-- own. From here on there is one place: (source, alias) → projects.id, or
-- project_id NULL with a `why` for names that are deliberately NOT ours.
--
-- Seeded from what is already known for certain — the BPH links, the IN4
-- sub-project links (which came from the upload file names), and the aliases
-- Aksha confirmed on 2026-08-31 (lib/revamp/alias-seed.ts on the trial branch).
-- Nothing is fuzzy-matched. Applied to the live database 4 Sept 2026.

create table if not exists public.project_aliases (
  id            bigserial primary key,
  source        text not null check (source in ('in4', 'bph', 'zoho', 'bills-report', 'procurement', 'manual')),
  alias         text not null,
  alias_norm    text generated always as (btrim(lower(regexp_replace(alias, '[^a-zA-Z0-9]+', ' ', 'g')))) stored,
  project_id    uuid references public.projects(id) on delete cascade,   -- null = deliberately not ours
  confidence    text not null default 'certain' check (confidence in ('certain', 'likely')),
  why           text,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (source, alias_norm)
);
comment on table public.project_aliases is
  'What IN4 / BPH / Zoho / the bills report / the procurement upload call each hub project. project_id NULL = a name that is deliberately not mapped (see why).';

alter table public.project_aliases enable row level security;
drop policy if exists project_aliases_read on public.project_aliases;
create policy project_aliases_read on public.project_aliases for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists project_aliases_admin_write on public.project_aliases;
create policy project_aliases_admin_write on public.project_aliases for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.role = 'admin' or p.is_portal_owner)));

-- ── Seed 1: the Budget-Hub project names, from the confirmed BPH → project links
insert into public.project_aliases (source, alias, project_id, why)
select 'bph', p->>'name', l.cc_project_id, 'From the BPH → project link'
from public.cc_bph_project_links l
join public.budget_hub_state s on s.id = 'global'
join lateral jsonb_array_elements(s.state->'projects') p on p->>'id' = l.bph_project_id
where coalesce(p->>'name', '') <> ''
on conflict (source, alias_norm) do nothing;

-- ── Seed 2: IN4 sub-project names and EX_CODEs, through the IN4 → BPH → project chain
insert into public.project_aliases (source, alias, project_id, why)
select 'in4', sp.name, l.cc_project_id, 'IN4 sub-project name (from the upload file name)'
from public.in4_subproject_links il
join public.in4_subprojects sp on sp.id = il.subproject_id
join public.cc_bph_project_links l on l.bph_project_id = il.bph_project_id
on conflict (source, alias_norm) do nothing;

insert into public.project_aliases (source, alias, project_id, why)
select 'in4', sp.ex_code, l.cc_project_id, 'IN4 sub-project EX_CODE'
from public.in4_subproject_links il
join public.in4_subprojects sp on sp.id = il.subproject_id
join public.cc_bph_project_links l on l.bph_project_id = il.bph_project_id
where coalesce(sp.ex_code, '') <> ''
on conflict (source, alias_norm) do nothing;

-- ── Seed 3: aliases Aksha confirmed (2026-08-31), by hub project code
with seed(source, alias, code, why) as (values
  ('in4',          'New Guest House A',                    'NGH A',   'NGH is the hub''s abbreviation for New Guest House'),
  ('in4',          'New Guest House B',                    'NGH B',   'NGH is the hub''s abbreviation for New Guest House'),
  ('in4',          'New Guest House C',                    'NGH C',   'NGH is the hub''s abbreviation for New Guest House'),
  ('in4',          'New Guest House - Infra Work',         'NGH',     'Same building, same stage — "Infra Work" is the hub''s "Infra"'),
  ('in4',          'New Guest House',                      'NGHG',    'The group holding NGH A, B, C, Infra and Common Expenses'),
  ('in4',          'Vinay Vivek',                          'VVG',     'The group holding VINAY, VIVEK, VV Infra and Common Expenses'),
  ('in4',          'P2 Stepped Terraces',                  'P2G',     'The group holding P2 Infra and the A01–A03 towers'),
  ('in4',          'P2 Infra',                             'P2',      'The hub name carries a double space'),
  ('in4',          'Ekant Kutirs',                         'EK',      'Plural in IN4, singular in the hub'),
  ('in4',          'Admin Block 1st Floor Work',           'AB1F',    'IN4 adds the word "Work"'),
  ('in4',          'P2 Stepped Terraces - Execution A-01', 'P2 A01',  'A-01 is the A01 tower'),
  ('in4',          'P2 Stepped Terraces - Execution A-02', 'P2 A02',  'A-02 is the A02 tower'),
  ('in4',          'P2 Stepped Terraces - Execution A-03', 'P2 A03',  'A-03 is the A03 tower'),
  ('in4',          'SR Animal Hospital',                   'SRAH',    'SRAH is Shrimad Rajchandra Animal Hospital'),
  ('in4',          'Vinay Vivek Infra',                    'VV Infra','Confirmed by Aksha — this is the VV Infra project'),
  ('in4',          'Vinay ST',                             'VINAY',   'Confirmed by Aksha — the VINAY building'),
  ('in4',          'Vivek ST',                             'VIVEK',   'Confirmed by Aksha — the VIVEK building'),
  ('procurement',  'New Guest House',                      'NGHG',    'IN4''s project name in the Indent → PO upload'),
  ('procurement',  'Vinay Vivek',                          'VVG',     'IN4''s project name in the Indent → PO upload'),
  ('procurement',  'P2 Stepped Terraces',                  'P2G',     'IN4''s project name in the Indent → PO upload'),
  ('procurement',  'P2 Infra',                             'P2',      'IN4''s project name in the Indent → PO upload'),
  ('procurement',  'Admin Block',                          'AB',      'IN4''s project name in the Indent → PO upload'),
  ('procurement',  'Ekant Kutirs',                         'EK',      'Plural in IN4, singular in the hub'),
  ('procurement',  'Welcome Centre Extension',             'WCE',     'Same name'),
  ('procurement',  'Civil & MEP Central Warehouse',        'CMCW',    'Same name'),
  ('procurement',  'CVR',                                  'CV4',     'CV Renovation — the upload abbreviates it; CV4 and CV5 are its buildings'),
  ('bills-report', 'NGH Common Expenses',                  'NGHCE',   'The bills report abbreviates New Guest House to NGH'),
  ('bills-report', 'VINAY Building',                       'VINAY',   'The bills report appends "Building"'),
  ('bills-report', 'VIVEK Building',                       'VIVEK',   'The bills report appends "Building"'),
  ('bills-report', 'VV Common Expenses',                   'VVCE',    'The bills report abbreviates Vinay Vivek to VV'),
  ('bills-report', 'P2 A02 Building',                      'P2 A02',  'The bills report appends "Building"'),
  ('bills-report', 'P2 A03 Building',                      'P2 A03',  'The bills report appends "Building"'),
  ('zoho',         'NGH',                                  'NGHG',    'Bills Pipeline project code'),
  ('zoho',         'P2',                                   'P2G',     'Bills Pipeline project code'),
  ('zoho',         'VV',                                   'VVG',     'Bills Pipeline project code'),
  ('zoho',         'EK',                                   'EK',      'Bills Pipeline project code'),
  ('zoho',         'SRAH',                                 'SRAH',    'Bills Pipeline project code')
)
insert into public.project_aliases (source, alias, project_id, why)
select s.source, s.alias, p.id, s.why
from seed s join public.projects p on p.code = s.code
on conflict (source, alias_norm) do nothing;

-- ── Seed 4: names that are deliberately NOT ours (Aksha, 2026-08-31)
with parked(alias, why) as (values
  ('Raj Uphaar',                    'Aksha is creating it — link it here once the project exists'),
  ('RU',                            'RU Infra is its own project, separate from Raj Uphaar. Not in CT Hub yet'),
  ('Raj Saurabh',                   'Aksha is creating it — link it here once the project exists'),
  ('Common Facility Block',         'Parked by Aksha''s decision, 2026-08-31'),
  ('Staff Facilities Block',        'Parked by Aksha''s decision, 2026-08-31'),
  ('Old Swadhyay Hall',             'No such project in CT Hub — one of the four to create'),
  ('Naturopathy',                   'No such project in CT Hub — one of the four to create'),
  ('DN Extension',                  'Parked by Aksha''s decision, 2026-08-31'),
  ('DN Annex Extension',            'Parked by Aksha''s decision, 2026-08-31'),
  ('DN Annex Refurbish',            'Parked by Aksha''s decision, 2026-08-31'),
  ('Prem Parking',                  'No such project in CT Hub'),
  ('AV House',                      'Its own project, not the hub''s Admin Block AV House (Aksha confirmed)'),
  ('P2 Row Houses',                 'A project in its own right under the P2 group — not yet in CT Hub'),
  ('P2 Row Houses - Infra Work',    'Separate from P2 Row Houses itself. Not in CT Hub'),
  ('Raj Uphaar - Infra Work',       'Infra is its own project, not a stage of Raj Uphaar'),
  ('Raj Sabhagruh Museum',          'Parked by Aksha''s decision, 2026-08-31'),
  ('Warehouse',                     'A different warehouse — CT Hub has no such project yet. ₹15.73 Cr parked'),
  ('Vinay Vivek MEP Infra',         'MEP Infra is a separate project, not part of VV'),
  ('Ekant Kutir MEP Infra',         'MEP Infra is a separate project, not part of Ekant Kutir'),
  ('Step Terrace MEP Infra',        'MEP Infra is a separate project, not part of P2'),
  ('Design Admin',                  'A real project, not yet in CT Hub'),
  ('Professional Consultancy (Staff)', 'A real project, not yet in CT Hub'),
  ('MULTIPLE',                      'IN4''s own catch-all — unattributable by design')
)
insert into public.project_aliases (source, alias, project_id, why)
select 'in4', alias, null, why from parked
on conflict (source, alias_norm) do nothing;
