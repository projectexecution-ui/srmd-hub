-- ============================================================
-- Site Register — Discussions · Stakeholders · Decisions & Specs
-- ============================================================
-- Three project-workspace tabs, one spine. Additive only: no existing table
-- is altered and no existing column changes meaning. Reuses the hub's own
-- registers rather than growing new ones — projects, profiles, project_floors,
-- cc_disciplines (budget categories), cc_sub_skills (sub-categories),
-- cc_working_sheets, in4_parties — and the helpers current_user_role() and
-- set_updated_at().
--
-- WHY EACH TABLE
--   sr_disciplines          the design disciplines of a construction project
--                           (Architecture, Structural, Interior …). Distinct
--                           from cc_disciplines, which are BUDGET CATEGORIES
--                           despite the name; nothing there is touched.
--   sr_project_disciplines  which of them apply to one project. Configuration,
--                           so it is never on the reading screen.
--   sr_stakeholders         everyone attached to a project and their part in
--                           it, pinned to a CT Hub user or an IN4 party.
--   sr_threads              the register: site issues, requests for
--                           information, instructions, decisions, non-
--                           conformances, correspondence. One responsible
--                           person and one response date, always.
--   sr_thread_posts         what was written, in order.
--   sr_thread_events        what was DONE — reassigned, date revised, closed.
--                           Append-only; this is the audit trail.
--   sr_thread_watchers      who is kept informed.
--   sr_decision_items       one row per category / sub-category that needs a
--                           specification decided, with its current state.
--   sr_decision_revisions   every specification this item has ever carried,
--                           so superseding is a record and not an overwrite.
--
-- ACCESS
--   SELECT   any authenticated user; the pages are gated by
--            requirePermission('cost-control', …) plus the workspace tab
--            switches, exactly as every other tab in the cockpit is.
--   WRITE    anyone but a viewer — raising an issue and replying to one is
--            the job, not a privilege.
--   CONFIG   admin, head and founder only: the discipline master, which
--            disciplines a project uses, who its stakeholders are, and which
--            sub-categories need a decision.
--   DELETE   admin only, everywhere.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── 1. Discipline master ────────────────────────────────────────────────────
create table if not exists public.sr_disciplines (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  short_name     text,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists sr_disciplines_name_uq on public.sr_disciplines(lower(name));

insert into public.sr_disciplines (name, short_name, display_order) values
  ('Architecture',              'ARCH',  10),
  ('Structural',                'STR',   20),
  ('Civil / Site',              'CIV',   30),
  ('Interior',                  'INT',   40),
  ('Façade',                    'FAC',   50),
  ('Landscape',                 'LND',   60),
  ('Mechanical / HVAC',         'HVAC',  70),
  ('Electrical',                'ELE',   80),
  ('Plumbing & Public Health',  'PHE',   90),
  ('Fire & Life Safety',        'FLS',  100),
  ('Lighting',                  'LGT',  110),
  ('Acoustics',                 'ACO',  120),
  ('Audio Visual & ICT',        'AV',   130),
  ('Kitchen',                   'KIT',  140),
  ('Signage & Artefacts',       'SGN',  150),
  ('Quantity Surveying',        'QS',   160),
  ('Project Management',        'PMC',  170),
  ('Survey',                    'SUR',  180),
  ('Geotechnical & Soil',       'GEO',  190),
  ('Third-party Inspection',    'TPI',  200),
  ('Water Treatment (WTP / STP)','WTP', 210),
  ('Green Building',            'IGBC', 220),
  ('Safety & EHS',              'EHS',  230),
  ('Liaison & Statutory Approvals','LIA',240)
on conflict do nothing;

-- ── 2. Which disciplines a project uses ─────────────────────────────────────
create table if not exists public.sr_project_disciplines (
  id             uuid primary key default uuid_generate_v4(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  discipline_id  uuid not null references public.sr_disciplines(id) on delete cascade,
  is_enabled     boolean not null default true,
  enabled_by     uuid references public.profiles(id) on delete set null,
  enabled_at     timestamptz not null default now()
);
create unique index if not exists sr_project_disciplines_uq
  on public.sr_project_disciplines(project_id, discipline_id);
create index if not exists sr_project_disciplines_project_idx
  on public.sr_project_disciplines(project_id) where is_enabled;

-- ── 3. Stakeholders ─────────────────────────────────────────────────────────
create table if not exists public.sr_stakeholders (
  id               uuid primary key default uuid_generate_v4(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  discipline_id    uuid references public.sr_disciplines(id) on delete set null,
  -- Which register this party belongs to. 'team' is a CT Hub user; the rest
  -- are IN4 parties, or typed in where IN4 has no record (an authority).
  org_kind         text not null default 'consultant'
                     check (org_kind in ('team','consultant','contractor','vendor','authority')),
  user_id          uuid references public.profiles(id) on delete set null,
  in4_party_kind   text,
  in4_party_id     int,
  display_name     text not null,
  role_on_project  text,
  email            text,
  phone            text,
  -- The person or firm a query of this discipline is addressed to by default.
  -- At most one per (project, discipline) — enforced below.
  is_lead          boolean not null default false,
  is_active        boolean not null default true,
  started_on       date,
  ended_on         date,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists sr_stakeholders_project_idx on public.sr_stakeholders(project_id) where is_active;
create index if not exists sr_stakeholders_discipline_idx on public.sr_stakeholders(project_id, discipline_id);
create index if not exists sr_stakeholders_user_idx on public.sr_stakeholders(user_id);
create unique index if not exists sr_stakeholders_lead_uq
  on public.sr_stakeholders(project_id, discipline_id)
  where is_lead and is_active and discipline_id is not null;

drop trigger if exists sr_stakeholders_updated on public.sr_stakeholders;
create trigger sr_stakeholders_updated before update on public.sr_stakeholders
  for each row execute function public.set_updated_at();

-- ── 4. The register ─────────────────────────────────────────────────────────
create table if not exists public.sr_threads (
  id                uuid primary key default uuid_generate_v4(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  kind              text not null
                      check (kind in ('issue','rfi','instruction','decision','ncr','correspondence')),
  -- Per project and kind, so references read SRAH/RFI/007 and never collide.
  seq               int not null,
  ref               text not null,
  title             text not null,
  discipline_id     uuid references public.sr_disciplines(id) on delete set null,
  category_id       uuid references public.cc_disciplines(id) on delete set null,
  sub_category_id   uuid references public.cc_sub_skills(id) on delete set null,
  location          text,
  floor_id          uuid references public.project_floors(id) on delete set null,
  priority          text not null default 'normal'
                      check (priority in ('low','normal','high','critical')),
  status            text not null default 'open'
                      check (status in ('open','responded','closed','cancelled')),
  -- The responsible person. A thread without one cannot be saved: that is the
  -- whole point of the register, and the check constraint says so.
  assigned_to       uuid references public.profiles(id) on delete set null,
  assigned_stakeholder_id uuid references public.sr_stakeholders(id) on delete set null,
  assigned_at       timestamptz,
  due_on            date,
  cost_impact       numeric(14,2),
  cost_impact_note  text,
  ws_id             uuid references public.cc_working_sheets(id) on delete set null,
  wo_no             text,
  decision_item_id  uuid,
  raised_by         uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  responded_at      timestamptz,
  closed_by         uuid references public.profiles(id) on delete set null,
  closed_at         timestamptz,
  closing_note      text,
  escalated_at      timestamptz,
  last_activity_at  timestamptz not null default now(),
  constraint sr_threads_open_has_owner
    check (status not in ('open','responded')
           or assigned_to is not null or assigned_stakeholder_id is not null)
);
create unique index if not exists sr_threads_seq_uq on public.sr_threads(project_id, kind, seq);
create unique index if not exists sr_threads_ref_uq on public.sr_threads(ref);
create index if not exists sr_threads_project_idx on public.sr_threads(project_id, status, last_activity_at desc);
create index if not exists sr_threads_assigned_idx on public.sr_threads(assigned_to, status) where status in ('open','responded');
create index if not exists sr_threads_due_idx on public.sr_threads(due_on) where status in ('open','responded');
create index if not exists sr_threads_sub_idx on public.sr_threads(sub_category_id);
create index if not exists sr_threads_decision_idx on public.sr_threads(decision_item_id);

drop trigger if exists sr_threads_updated on public.sr_threads;
create trigger sr_threads_updated before update on public.sr_threads
  for each row execute function public.set_updated_at();

-- The project, the reference and who raised it never change after the fact.
create or replace function public.sr_threads_freeze()
returns trigger language plpgsql set search_path = public as $$
begin
  new.project_id := old.project_id;
  new.ref        := old.ref;
  new.seq        := old.seq;
  new.kind       := old.kind;
  new.raised_by  := old.raised_by;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists sr_threads_freeze_trg on public.sr_threads;
create trigger sr_threads_freeze_trg before update on public.sr_threads
  for each row execute function public.sr_threads_freeze();

-- ── 5. Posts ────────────────────────────────────────────────────────────────
create table if not exists public.sr_thread_posts (
  id          uuid primary key default uuid_generate_v4(),
  thread_id   uuid not null references public.sr_threads(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  -- [{ name, url, size }] — the same store the working sheets use.
  attachments jsonb not null default '[]'::jsonb,
  -- A line the system wrote (reassigned, closed) rather than a person.
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists sr_thread_posts_thread_idx on public.sr_thread_posts(thread_id, created_at);

-- ── 6. Events — the audit trail, append-only ────────────────────────────────
create table if not exists public.sr_thread_events (
  id          uuid primary key default uuid_generate_v4(),
  thread_id   uuid not null references public.sr_threads(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  event       text not null,
  detail      text,
  from_value  text,
  to_value    text,
  created_at  timestamptz not null default now()
);
create index if not exists sr_thread_events_thread_idx on public.sr_thread_events(thread_id, created_at);

-- ── 7. Watchers ─────────────────────────────────────────────────────────────
create table if not exists public.sr_thread_watchers (
  thread_id  uuid not null references public.sr_threads(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists sr_thread_watchers_user_idx on public.sr_thread_watchers(user_id);

-- ── 8. Decisions & specifications ───────────────────────────────────────────
create table if not exists public.sr_decision_items (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  category_id     uuid not null references public.cc_disciplines(id) on delete cascade,
  -- The tree works at sub-category level throughout; a category row is a
  -- roll-up of its children. Not null, so the applicability tick can be a
  -- plain upsert — ON CONFLICT cannot infer a partial unique index.
  sub_category_id uuid not null references public.cc_sub_skills(id) on delete cascade,
  -- Configuration: most sub-categories need no specification decision at all.
  is_applicable   boolean not null default true,
  status          text not null default 'pending'
                    check (status in ('pending','under_review','approved','superseded')),
  title           text,
  spec            text,
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_on      date,
  -- The date the specification is needed by, taken from the procurement lead
  -- time. This is what turns an open decision into a flagged one.
  required_by     date,
  owner_id        uuid references public.profiles(id) on delete set null,
  discipline_id   uuid references public.sr_disciplines(id) on delete set null,
  notes           text,
  attachments     jsonb not null default '[]'::jsonb,
  revision        int not null default 0,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.sr_decision_items
  drop constraint if exists sr_decision_items_project_sub_uq;
alter table public.sr_decision_items
  add constraint sr_decision_items_project_sub_uq unique (project_id, sub_category_id);
create index if not exists sr_decision_items_project_idx
  on public.sr_decision_items(project_id, category_id) where is_applicable;
create index if not exists sr_decision_items_required_idx
  on public.sr_decision_items(required_by) where is_applicable and status <> 'approved';

drop trigger if exists sr_decision_items_updated on public.sr_decision_items;
create trigger sr_decision_items_updated before update on public.sr_decision_items
  for each row execute function public.set_updated_at();

create table if not exists public.sr_decision_revisions (
  id           uuid primary key default uuid_generate_v4(),
  item_id      uuid not null references public.sr_decision_items(id) on delete cascade,
  revision     int not null,
  spec         text,
  decided_by   uuid references public.profiles(id) on delete set null,
  decided_on   date,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists sr_decision_revisions_uq on public.sr_decision_revisions(item_id, revision);
create index if not exists sr_decision_revisions_item_idx on public.sr_decision_revisions(item_id, revision desc);

-- A thread may be raised against a decision item (a query about a pending
-- specification). Added after both tables exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sr_threads_decision_item_fk'
  ) then
    alter table public.sr_threads
      add constraint sr_threads_decision_item_fk
      foreign key (decision_item_id) references public.sr_decision_items(id) on delete set null;
  end if;
end $$;

-- ── 9. Who may do what ──────────────────────────────────────────────────────
-- Raising and replying is the job. Only a viewer is kept out.
create or replace function public.sr_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() is not null
     and public.current_user_role()::text not in ('viewer');
$$;

-- Configuration — the discipline list, who the stakeholders are, which
-- sub-categories need a decision. Deliberately narrower than writing.
create or replace function public.sr_can_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text in ('admin','head','founder','project_head');
$$;

create or replace function public.sr_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role()::text = 'admin';
$$;

-- ── 10. Reference numbers ───────────────────────────────────────────────────
-- SRAH/RFI/007 — the project's own code, the kind, and a number that counts
-- per project and per kind. The advisory lock makes two people raising at the
-- same moment safe without a sequence per project.
create or replace function public.sr_create_thread(
  p_project        uuid,
  p_kind           text,
  p_title          text,
  p_body           text,
  p_discipline     uuid   default null,
  p_category       uuid   default null,
  p_sub_category   uuid   default null,
  p_location       text   default null,
  p_priority       text   default 'normal',
  p_assigned_to    uuid   default null,
  p_assigned_stake uuid   default null,
  p_due            date   default null,
  p_cost           numeric default null,
  p_cost_note      text   default null,
  p_watchers       uuid[] default '{}',
  p_attachments    jsonb  default '[]'::jsonb
) returns public.sr_threads
language plpgsql volatile security definer set search_path = public as $$
declare
  v_seq   int;
  v_code  text;
  v_short text;
  v_row   public.sr_threads;
  v_me    uuid := auth.uid();
  w       uuid;
begin
  if not public.sr_can_write() then
    raise exception 'You do not have permission to raise an entry on this project';
  end if;
  if p_assigned_to is null and p_assigned_stake is null then
    raise exception 'An entry needs someone responsible for it';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_project::text || ':' || p_kind));
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.sr_threads where project_id = p_project and kind = p_kind;

  select upper(regexp_replace(coalesce(nullif(p.code, ''), nullif(p.short_name, ''), p.name, 'PRJ'), '[^A-Za-z0-9]', '', 'g'))
    into v_code from public.projects p where p.id = p_project;
  v_code := left(coalesce(v_code, 'PRJ'), 10);

  v_short := case p_kind
    when 'issue' then 'SI' when 'rfi' then 'RFI' when 'instruction' then 'INS'
    when 'decision' then 'DEC' when 'ncr' then 'NCR' else 'COR' end;

  insert into public.sr_threads (
    project_id, kind, seq, ref, title, discipline_id, category_id, sub_category_id,
    location, priority, assigned_to, assigned_stakeholder_id, assigned_at, due_on,
    cost_impact, cost_impact_note, raised_by
  ) values (
    p_project, p_kind, v_seq, v_code || '/' || v_short || '/' || lpad(v_seq::text, 3, '0'),
    p_title, p_discipline, p_category, p_sub_category,
    nullif(p_location, ''), coalesce(p_priority, 'normal'), p_assigned_to, p_assigned_stake, now(), p_due,
    p_cost, nullif(p_cost_note, ''), v_me
  ) returning * into v_row;

  insert into public.sr_thread_posts (thread_id, author_id, body, attachments)
  values (v_row.id, v_me, p_body, coalesce(p_attachments, '[]'::jsonb));

  insert into public.sr_thread_events (thread_id, actor_id, event, detail)
  values (v_row.id, v_me, 'raised', v_row.ref);

  foreach w in array coalesce(p_watchers, '{}') loop
    insert into public.sr_thread_watchers (thread_id, user_id, added_by)
    values (v_row.id, w, v_me) on conflict do nothing;
  end loop;
  if p_assigned_to is not null then
    insert into public.sr_thread_watchers (thread_id, user_id, added_by)
    values (v_row.id, p_assigned_to, v_me) on conflict do nothing;
  end if;
  if v_me is not null then
    insert into public.sr_thread_watchers (thread_id, user_id, added_by)
    values (v_row.id, v_me, v_me) on conflict do nothing;
  end if;

  return v_row;
end $$;

-- Recording a specification: the outgoing one is kept as a revision, so
-- "we changed the tile in July" always has a record.
create or replace function public.sr_record_decision(
  p_item   uuid,
  p_spec   text,
  p_note   text default null,
  p_on     date default null
) returns public.sr_decision_items
language plpgsql volatile security definer set search_path = public as $$
declare
  v_item public.sr_decision_items;
  v_me   uuid := auth.uid();
begin
  if not public.sr_can_write() then
    raise exception 'You do not have permission to record a decision on this project';
  end if;
  select * into v_item from public.sr_decision_items where id = p_item for update;
  if v_item.id is null then raise exception 'That decision row no longer exists'; end if;

  -- Keep what it said before, if it said anything.
  if v_item.spec is not null and length(btrim(v_item.spec)) > 0 then
    insert into public.sr_decision_revisions (item_id, revision, spec, decided_by, decided_on, note, created_by)
    values (v_item.id, v_item.revision, v_item.spec, v_item.decided_by, v_item.decided_on, 'Superseded', v_me)
    on conflict do nothing;
  end if;

  update public.sr_decision_items set
    spec = p_spec,
    notes = coalesce(nullif(p_note, ''), notes),
    status = 'approved',
    decided_by = v_me,
    decided_on = coalesce(p_on, current_date),
    revision = v_item.revision + 1
  where id = p_item returning * into v_item;

  insert into public.sr_decision_revisions (item_id, revision, spec, decided_by, decided_on, note, created_by)
  values (v_item.id, v_item.revision, v_item.spec, v_me, v_item.decided_on, nullif(p_note, ''), v_me)
  on conflict (item_id, revision) do update set spec = excluded.spec;

  return v_item;
end $$;

-- ── 11. Row level security ──────────────────────────────────────────────────
alter table public.sr_disciplines          enable row level security;
alter table public.sr_project_disciplines  enable row level security;
alter table public.sr_stakeholders         enable row level security;
alter table public.sr_threads              enable row level security;
alter table public.sr_thread_posts         enable row level security;
alter table public.sr_thread_events        enable row level security;
alter table public.sr_thread_watchers      enable row level security;
alter table public.sr_decision_items       enable row level security;
alter table public.sr_decision_revisions   enable row level security;

drop policy if exists sr_disciplines_select on public.sr_disciplines;
create policy sr_disciplines_select on public.sr_disciplines for select to authenticated using (true);
drop policy if exists sr_disciplines_write on public.sr_disciplines;
create policy sr_disciplines_write on public.sr_disciplines for all to authenticated
  using (public.sr_can_admin()) with check (public.sr_can_admin());

drop policy if exists sr_project_disciplines_select on public.sr_project_disciplines;
create policy sr_project_disciplines_select on public.sr_project_disciplines for select to authenticated using (true);
drop policy if exists sr_project_disciplines_write on public.sr_project_disciplines;
create policy sr_project_disciplines_write on public.sr_project_disciplines for all to authenticated
  using (public.sr_can_admin()) with check (public.sr_can_admin());

drop policy if exists sr_stakeholders_select on public.sr_stakeholders;
create policy sr_stakeholders_select on public.sr_stakeholders for select to authenticated using (true);
drop policy if exists sr_stakeholders_write on public.sr_stakeholders;
create policy sr_stakeholders_write on public.sr_stakeholders for all to authenticated
  using (public.sr_can_admin()) with check (public.sr_can_admin());

drop policy if exists sr_threads_select on public.sr_threads;
create policy sr_threads_select on public.sr_threads for select to authenticated using (true);
drop policy if exists sr_threads_insert on public.sr_threads;
create policy sr_threads_insert on public.sr_threads for insert to authenticated with check (public.sr_can_write());
drop policy if exists sr_threads_update on public.sr_threads;
create policy sr_threads_update on public.sr_threads for update to authenticated
  using (public.sr_can_write()) with check (public.sr_can_write());
drop policy if exists sr_threads_delete on public.sr_threads;
create policy sr_threads_delete on public.sr_threads for delete to authenticated using (public.sr_is_admin());

drop policy if exists sr_thread_posts_select on public.sr_thread_posts;
create policy sr_thread_posts_select on public.sr_thread_posts for select to authenticated using (true);
drop policy if exists sr_thread_posts_insert on public.sr_thread_posts;
create policy sr_thread_posts_insert on public.sr_thread_posts for insert to authenticated with check (public.sr_can_write());
-- A post may be edited by the person who wrote it, and the edit shows as one.
drop policy if exists sr_thread_posts_update on public.sr_thread_posts;
create policy sr_thread_posts_update on public.sr_thread_posts for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists sr_thread_posts_delete on public.sr_thread_posts;
create policy sr_thread_posts_delete on public.sr_thread_posts for delete to authenticated using (public.sr_is_admin());

-- Events are the audit trail: written by anyone who may act, never changed.
drop policy if exists sr_thread_events_select on public.sr_thread_events;
create policy sr_thread_events_select on public.sr_thread_events for select to authenticated using (true);
drop policy if exists sr_thread_events_insert on public.sr_thread_events;
create policy sr_thread_events_insert on public.sr_thread_events for insert to authenticated with check (public.sr_can_write());

drop policy if exists sr_thread_watchers_select on public.sr_thread_watchers;
create policy sr_thread_watchers_select on public.sr_thread_watchers for select to authenticated using (true);
drop policy if exists sr_thread_watchers_write on public.sr_thread_watchers;
create policy sr_thread_watchers_write on public.sr_thread_watchers for all to authenticated
  using (public.sr_can_write() or user_id = (select auth.uid()))
  with check (public.sr_can_write() or user_id = (select auth.uid()));

drop policy if exists sr_decision_items_select on public.sr_decision_items;
create policy sr_decision_items_select on public.sr_decision_items for select to authenticated using (true);
-- Applicability is configuration; recording a specification is work. The two
-- are separated in the app, and the second is the one engineers need.
drop policy if exists sr_decision_items_insert on public.sr_decision_items;
create policy sr_decision_items_insert on public.sr_decision_items for insert to authenticated with check (public.sr_can_admin());
drop policy if exists sr_decision_items_update on public.sr_decision_items;
create policy sr_decision_items_update on public.sr_decision_items for update to authenticated
  using (public.sr_can_write()) with check (public.sr_can_write());
drop policy if exists sr_decision_items_delete on public.sr_decision_items;
create policy sr_decision_items_delete on public.sr_decision_items for delete to authenticated using (public.sr_is_admin());

drop policy if exists sr_decision_revisions_select on public.sr_decision_revisions;
create policy sr_decision_revisions_select on public.sr_decision_revisions for select to authenticated using (true);
drop policy if exists sr_decision_revisions_insert on public.sr_decision_revisions;
create policy sr_decision_revisions_insert on public.sr_decision_revisions for insert to authenticated with check (public.sr_can_write());

-- ── 12. Settings ────────────────────────────────────────────────────────────
-- How many days an entry may sit unanswered before it also appears on the Atm
-- Head's desk. One number, editable from the admin settings screen; the new
-- notification types themselves need no rows, because notification_allowed
-- defaults an unknown type to on.
insert into public.app_settings (key, value)
values ('sr_escalation_days', '3')
on conflict (key) do nothing;
