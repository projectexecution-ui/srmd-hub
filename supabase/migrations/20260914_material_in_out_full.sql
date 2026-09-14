-- ============================================================
-- Material In & Out — the rest of the mind map
-- ============================================================
-- Aksha, 14 Sep 2026: "start working in the direction to build a full section
-- with my Mindmap". Four additions, each answering a branch the first cut left
-- out. Additive only — nothing existing changes meaning.
--
--  1. UNIT as a master. The map lists Units (Nos · Kgs · Lumsum · Etc)
--     alongside the other lists. Units currently ride on the item, which came
--     from Odoo's own spelling; an admin needs a curated list to pick from.
--
--  2. SUB-PROJECT on an entry. The map's Store Keeper In says
--     "Project Name: And Sub Project Name" — NGH B is a project, but material
--     lands on a block. Nullable, because most entries will not need it.
--
--  3. TO-LOCATION on an entry. On an OUT, `location_id` is where material came
--     FROM. The map's SRM Out ends "Capture where the materials are being
--     stored" — where it went TO on site. Two different questions, so two
--     columns rather than one that means different things by direction.
--
--  4. VIDEO as a photo kind. The map asks for "Video Confirmation" when
--     Security checks a load before it is driven out.
-- ============================================================

-- ── 1. Unit becomes a master kind ───────────────────────────────────────────
alter table public.mio_lists drop constraint if exists mio_lists_kind_check;
alter table public.mio_lists add constraint mio_lists_kind_check
  check (kind in ('entity','delivery_mode','item_category','discipline','location','unit'));

-- Seeded from the map, plus every unit the Odoo load actually brought in, so
-- the list starts as what is really in use rather than as an ideal nobody picked.
insert into public.mio_lists (kind, name, display_order) values
  ('unit','Nos',     10),
  ('unit','Kgs',     20),
  ('unit','Lumsum',  30),
  ('unit','Units',   40),
  ('unit','m',       50),
  ('unit','kg',      60),
  ('unit','Pcs',     70)
on conflict do nothing;

-- ── 2 & 3. Sub-project, and where material went TO ──────────────────────────
alter table public.mio_entries
  add column if not exists sub_project_id  uuid references public.projects(id) on delete set null,
  add column if not exists to_location_id  uuid references public.mio_lists(id) on delete set null;

comment on column public.mio_entries.location_id is
  'Where the material IS, for an IN — and where it came FROM, for an OUT.';
comment on column public.mio_entries.to_location_id is
  'OUT only: where it was put down at the far end. The map''s "capture where the materials are being stored".';

-- ── 4. Video, for the check before loading ──────────────────────────────────
alter table public.mio_photos drop constraint if exists mio_photos_kind_check;
alter table public.mio_photos add constraint mio_photos_kind_check
  check (kind in ('challan','bill','eway','item','location','video','other'));

-- ── 5. A returned line points at the line it answers ────────────────────────
-- The returnables report already nets returns off by matching an OUT entry to
-- the IN it is linked to. That is right at entry level but cannot tell two
-- returnable items on one entry apart, so a partial return of one of them
-- would net against both. Pointing a returned line at its original line makes
-- the netting exact.
alter table public.mio_entry_lines
  add column if not exists returns_line_id uuid references public.mio_entry_lines(id) on delete set null;
create index if not exists mio_entry_lines_returns_idx
  on public.mio_entry_lines(returns_line_id) where returns_line_id is not null;

comment on column public.mio_entry_lines.returns_line_id is
  'On a return: the original returnable line being given back. Null on everything else.';
