-- ============================================================
-- OLD INDENT TO PO — put the upload tracker's tables back, with its data.
-- ============================================================
-- Aksha, 21 Sep 2026: "this is the first one - i want the next one ... i had
-- made lot of improvemnrts". The upload-based Indent → PO tracker went in
-- clean-up round 2 on 10 September, and the screen is being restored.
--
-- The data was never lost: 20260910_cleanup_round2 copied every table into
-- schema `cleanup_backup_20260910` BEFORE dropping it. That backup is still
-- there and still holds his last upload — `global`, version 83, 854 kB,
-- saved 6 Sep 2026 — plus 30 history snapshots the diff banner reads.
--
-- IDEMPOTENT ON PURPOSE. This may be applied by hand and then again by the
-- merge action, so every statement is `if not exists` / `on conflict do
-- nothing`. Re-running it must never overwrite an upload made after it ran.
--
-- NOT restored, deliberately: the daily digest, its notification rules and
-- its app_settings keys. That is the part Aksha asked to be rid of
-- ("remove chase feature, it's not required for me now") — a cron that mails
-- people. Chase NOTES come back because they are a note on a row and the
-- restored screen reads them.

/* ── The shared blob, and its history ─────────────────────────────────── */

create table if not exists public.procurement_tracker_state (
  id          text primary key default 'global',
  state       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

create table if not exists public.procurement_tracker_state_history (
  id           bigserial primary key,
  state_id     text not null,
  state        jsonb not null,
  version      integer not null,
  snapshot_at  timestamptz not null default now(),
  snapshot_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_ptsh_state_id_version
  on public.procurement_tracker_state_history(state_id, version desc);

/* ── Chase notes and dropped lines ────────────────────────────────────── */

create table if not exists public.procurement_chase_notes (
  indent_no       text primary key,
  note            text,
  last_chased_at  timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

create table if not exists public.procurement_dropped_lines (
  line_key    text primary key,
  indent_no   text,
  material    text,
  block       text,
  reason      text,
  dropped_at  timestamptz not null default now(),
  dropped_by  uuid references public.profiles(id) on delete set null
);

/* ── The data, straight back out of the backup ────────────────────────── */
-- Guarded on the backup schema still being there: this migration must not
-- fail on a fresh database that never had the 10 September clean-up.

do $$
begin
  if to_regclass('cleanup_backup_20260910.procurement_tracker_state') is not null then
    insert into public.procurement_tracker_state (id, state, version, updated_at, updated_by)
      select id, state, version, updated_at, updated_by
      from cleanup_backup_20260910.procurement_tracker_state
      on conflict (id) do nothing;
  end if;

  if to_regclass('cleanup_backup_20260910.procurement_tracker_state_history') is not null then
    insert into public.procurement_tracker_state_history (state_id, state, version, snapshot_at, snapshot_by)
      select h.state_id, h.state, h.version, h.snapshot_at, h.snapshot_by
      from cleanup_backup_20260910.procurement_tracker_state_history h
      where not exists (
        select 1 from public.procurement_tracker_state_history x
        where x.state_id = h.state_id and x.version = h.version
      );
  end if;

  if to_regclass('cleanup_backup_20260910.procurement_chase_notes') is not null then
    insert into public.procurement_chase_notes (indent_no, note, last_chased_at, updated_at, updated_by)
      select indent_no, note, last_chased_at, updated_at, updated_by
      from cleanup_backup_20260910.procurement_chase_notes
      on conflict (indent_no) do nothing;
  end if;

  if to_regclass('cleanup_backup_20260910.procurement_dropped_lines') is not null then
    insert into public.procurement_dropped_lines (line_key, indent_no, material, block, reason, dropped_at, dropped_by)
      select line_key, indent_no, material, block, reason, dropped_at, dropped_by
      from cleanup_backup_20260910.procurement_dropped_lines
      on conflict (line_key) do nothing;
  end if;
end $$;

/* ── Who may read and write ───────────────────────────────────────────── */
-- Reading is open to any signed-in user, as it was: the screen itself is
-- admin-only (canSeeOldIndentToPo), and a second, looser copy of that rule in
-- the database would be the thing that actually decides — better that the app
-- gate is the only gate, and the table simply does not widen anything.
-- WRITING stays admin/uploader, which is what the original had.

alter table public.procurement_tracker_state          enable row level security;
alter table public.procurement_tracker_state_history  enable row level security;
alter table public.procurement_chase_notes            enable row level security;
alter table public.procurement_dropped_lines          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'procurement_tracker_state', 'procurement_tracker_state_history',
    'procurement_chase_notes', 'procurement_dropped_lines'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.profiles p
                     where p.id = auth.uid() and p.role::text in ('admin', 'uploader')))
      with check (exists (select 1 from public.profiles p
                     where p.id = auth.uid() and p.role::text in ('admin', 'uploader')))
    $f$, t || '_write', t);
  end loop;
end $$;
