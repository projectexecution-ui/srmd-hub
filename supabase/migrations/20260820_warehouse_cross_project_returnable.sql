-- Borrowing from another project's store is always returnable.
--
-- Aksha's rule: if an engineer asks a DIFFERENT project's store for material it
-- is always on a returnable footing, because that stock was bought against
-- another project's budget. The engineer does not get to decide otherwise. The
-- Atm Head can release it — but AFTER approving, which is the point: firm at the
-- asking, flexible afterwards.
--
-- Applied to production 2026-08-20.

-- Whose stock does a store hold? NULL means shared (Central Store, the CT
-- containers), and asking from a shared store is never cross-project.
-- On the STORE, not the site: NGH holds an A store, a B store and an open area,
-- and they need not all belong to the same project.
alter table wh_locations
  add column if not exists project_id uuid references projects(id);

comment on column wh_locations.project_id is
  'The project whose stock this store holds. NULL means shared/central - asking '
  'from it is never cross-project. Set in Warehouse Settings. Cross-project is '
  'derived, never stored: see lib/warehouse/cross-project.ts.';

-- Releasing a returnable, post-approval. Stamped rather than silently dropped
-- off the Returnables report: a waiver nobody can trace is how an argument
-- starts months later.
alter table wh_request_lines
  add column if not exists return_waived_at   timestamptz,
  add column if not exists return_waived_by   uuid references profiles(id),
  add column if not exists return_waived_note text;

comment on column wh_request_lines.return_waived_at is
  'When the Atm Head released this line from having to come back. NULL means it '
  'is still expected - and still on the Returnables outstanding report.';

-- A waiver only makes sense on a line that was returnable, and must say who.
alter table wh_request_lines
  drop constraint if exists wh_request_lines_waiver_sane;
alter table wh_request_lines
  add constraint wh_request_lines_waiver_sane check (
    return_waived_at is null
    or (is_returnable and return_waived_by is not null)
  );

create index if not exists wh_request_lines_returnable_open_idx
  on wh_request_lines (request_id)
  where is_returnable and return_waived_at is null;
