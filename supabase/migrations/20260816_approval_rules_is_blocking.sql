-- Returned sheets were showing as "needs your approval" on the dashboard.
--
-- approval_rules holds two very different kinds of row: rules that GRANT a
-- transition, and guard rails that exist only so the enforcement trigger can
-- REFUSE one ("BLOCKED: returned sheets must be resubmitted first"). Both are
-- is_active = true, because the guard rail has to be present to do its job.
--
-- my_approval_inbox() could not tell them apart — it asked only "is there an
-- active rule whose from_stage matches?". Every `returned` sheet therefore
-- appeared in the inbox of anyone matching the blocking rule's role, and since
-- an admin matches every rule, admins saw all 9 of them (Rs 60,61,799).
--
-- The same bug was already patched once, for drafts, by hard-coding
-- `ws.status <> 'draft'` into the cost-control branch. Rather than add a second
-- hard-coded status, name the real distinction so it holds for every module.
alter table approval_rules
  add column if not exists is_blocking boolean not null default false;

comment on column approval_rules.is_blocking is
  'True for guard-rail rows that exist to REFUSE a transition, not to grant it. '
  'Kept active so the enforcement trigger still sees them, but excluded from '
  'approval inboxes — a blocked transition is nobody''s to-do.';

-- One-time classification from the note the rules were seeded with.
update approval_rules
   set is_blocking = true
 where notes ilike 'BLOCKED%' and not is_blocking;
