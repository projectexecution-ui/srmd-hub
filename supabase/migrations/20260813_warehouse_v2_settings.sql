-- ===========================================================================
-- WAREHOUSE V2 — Settings (S8).
--
-- The switches themselves live in the shared `app_settings` table under wh_*
-- keys, because a second settings store is a second thing to keep in step.
-- But app_settings is only (key, value, updated_at) — no author, no history —
-- and the whole promise of this page is that "a switch can never be quietly
-- turned off". So the history gets its own table.
-- ===========================================================================

create table if not exists wh_setting_changes (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  old_value  text,
  new_value  text,
  actor_id   uuid references profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists wh_setting_changes_key_idx on wh_setting_changes (key, changed_at desc);
create index if not exists wh_setting_changes_at_idx  on wh_setting_changes (changed_at desc);

comment on table wh_setting_changes is
  'Who changed which Warehouse setting, when, and what it was before. app_settings keeps only the current value.';

alter table wh_setting_changes enable row level security;

-- Anyone who can see the module can read the history — that is the point of it.
drop policy if exists wh_setting_changes_read on wh_setting_changes;
create policy wh_setting_changes_read on wh_setting_changes
  for select using (fn_wh_can('view'));

-- Only an admin writes it, and only ever by inserting: a history that can be
-- edited is not a history.
drop policy if exists wh_setting_changes_write on wh_setting_changes;
create policy wh_setting_changes_write on wh_setting_changes
  for insert with check (fn_wh_can('admin'));

-- ---------------------------------------------------------------------------
-- "Two people must sign every count" is one of the settings above
-- (wh_count_requires_witness, default ON, enforced in submitCount and
-- approveCount). The CHECK below hard-required a witness on any approved count,
-- which would have made that switch a lie: turned off, it would still have
-- failed in the database.
--
-- So the split is now explicit. The DATABASE guarantees what is structurally
-- always true — an approved count has an approver and a counter, because a count
-- approved by nobody is not a count. The two-person rule is a POLICY, and the
-- setting is what decides it.
-- ---------------------------------------------------------------------------
alter table wh_counts drop constraint if exists wh_counts_approved_complete;
alter table wh_counts add constraint wh_counts_approved_complete check (
  status <> 'approved'
  or (approved_by is not null and counted_by is not null)
);
