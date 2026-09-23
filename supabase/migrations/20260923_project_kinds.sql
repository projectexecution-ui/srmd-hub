-- ============================================================
-- Three fixed levels: Group → Project → Sub-project (Aksha, 23 Sep 2026, H1)
-- ============================================================
-- projects.project_type already existed with 'individual' | 'group' and was
-- barely used (one row, P2, wrongly marked 'group'). It becomes the kind:
--
--   group       a programme that holds projects — no categories or approvers
--   project     a building or scope with its own Internal Estimate
--   subproject  a part or cost centre of ONE project
--
-- The kinds are read off today's tree, which already has the shape:
--   • a top-level row with children and no data of its own → group
--     (NGHG, P2G, VVG, RUG — the four anchors)
--   • a child of a group → project (NGH A, P2 A01, Raj Uphaar - Execution…)
--   • a child of a project → subproject (Admin Block Ground Floor, …CE…)
--   • everything else → project
-- No row moves. lib/projects/kind.ts holds the same rules for the app.
--
-- Idempotent: safe to run again.

alter table public.projects drop constraint if exists projects_project_type_chk;
alter table public.projects
  add constraint projects_project_type_chk
  check (project_type = any (array['group'::text, 'project'::text, 'subproject'::text, 'individual'::text]));

-- 1. Old word → new word.
update public.projects set project_type = 'project' where project_type = 'individual' or project_type is null;

-- 2. Anchors: top-level, children, nothing of their own.
with own as (
  select p.id
  from public.projects p
  where p.parent_project_id is null
    and exists (select 1 from public.projects c where c.parent_project_id = p.id)
    and not exists (select 1 from public.cc_budget_lines b where b.project_id = p.id)
    and not exists (select 1 from public.cc_working_sheets w where w.project_id = p.id)
    and not exists (select 1 from public.cc_project_disciplines d where d.project_id = p.id and d.is_enabled)
)
update public.projects p set project_type = 'group' from own where own.id = p.id;

-- A top-level row with no children is never a group (P2 "P2 Infra" was
-- mislabelled; it is a child of P2G anyway and is caught by step 3).
update public.projects set project_type = 'project'
 where project_type = 'group'
   and (parent_project_id is not null
        or not exists (select 1 from public.projects c where c.parent_project_id = projects.id));

-- 3. Children take their kind from their parent's.
update public.projects c set project_type = 'project'
  from public.projects g where c.parent_project_id = g.id and g.project_type = 'group';
update public.projects c set project_type = 'subproject'
  from public.projects p where c.parent_project_id = p.id and p.project_type = 'project';

-- 4. Now the legacy word can go.
alter table public.projects drop constraint if exists projects_project_type_chk;
alter table public.projects
  add constraint projects_project_type_chk
  check (project_type = any (array['group'::text, 'project'::text, 'subproject'::text]));
alter table public.projects alter column project_type set default 'project';

-- 5. The rules, held by the database as well as the app.
create or replace function public.projects_kind_guard()
returns trigger language plpgsql as $$
declare
  parent_kind text;
  child_kinds text[];
begin
  if new.parent_project_id is not null then
    select project_type into parent_kind from public.projects where id = new.parent_project_id;
    if parent_kind is null then
      raise exception 'Parent project not found';
    end if;
    if new.project_type = 'group' then
      raise exception 'A group is always top-level — it cannot sit under anything.';
    elsif new.project_type = 'project' and parent_kind <> 'group' then
      raise exception 'A project can only sit under a group.';
    elsif new.project_type = 'subproject' and parent_kind <> 'project' then
      raise exception 'A sub-project can only sit under a project.';
    end if;
    if new.parent_project_id = new.id then
      raise exception 'A project cannot be its own parent.';
    end if;
  elsif new.project_type = 'subproject' then
    raise exception 'A sub-project must sit under a project.';
  end if;

  -- What already sits under this row decides what it may become.
  if tg_op = 'UPDATE' and new.project_type <> old.project_type then
    select array_agg(distinct project_type) into child_kinds from public.projects where parent_project_id = new.id;
    if child_kinds is not null then
      if new.project_type = 'subproject' then
        raise exception 'This has things under it — a sub-project cannot. Move them out first.';
      elsif new.project_type = 'group' and child_kinds <> array['project'] then
        raise exception 'A group holds projects; the things under this are sub-projects.';
      elsif new.project_type = 'project' and child_kinds <> array['subproject'] then
        raise exception 'A project holds sub-projects; the things under this are projects.';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_kind_guard on public.projects;
create trigger trg_projects_kind_guard
  before insert or update of project_type, parent_project_id on public.projects
  for each row execute function public.projects_kind_guard();
