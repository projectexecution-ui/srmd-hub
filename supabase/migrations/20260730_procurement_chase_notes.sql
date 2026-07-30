-- ============================================================
-- Procurement chase notes — per-indent follow-up memory
-- ============================================================
-- One row per indent number. Holds a free-text chase note ("spoke to
-- vendor, promised Fri") and a last-chased timestamp so the whole team
-- can see what's already been followed up on, straight from the tracker.
--
-- Collaborative like procurement_known_projects: any signed-in user who
-- can view the tracker may add or update a note (chasing is a shared
-- effort). The touch trigger stamps who/when on every write.
-- ============================================================

create table if not exists public.procurement_chase_notes (
  indent_no       text primary key,
  note            text,
  last_chased_at  timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

comment on table public.procurement_chase_notes is
  'Per-indent chase note + last-chased marker for the Indent -> PO Tracker. Keyed by indent number (free-text from the IN4 export). Collaborative: any authenticated user may upsert.';

alter table public.procurement_chase_notes enable row level security;

-- Anyone signed in can read the notes (they show on the tracker for everyone).
drop policy if exists "pcn_select_all" on public.procurement_chase_notes;
create policy "pcn_select_all"
  on public.procurement_chase_notes
  for select
  to authenticated
  using (true);

-- Any signed-in user can add a note.
drop policy if exists "pcn_insert_authenticated" on public.procurement_chase_notes;
create policy "pcn_insert_authenticated"
  on public.procurement_chase_notes
  for insert
  to authenticated
  with check (true);

-- Any signed-in user can update a note (shared chasing).
drop policy if exists "pcn_update_authenticated" on public.procurement_chase_notes;
create policy "pcn_update_authenticated"
  on public.procurement_chase_notes
  for update
  to authenticated
  using (true)
  with check (true);

-- Only admins can delete a note outright.
drop policy if exists "pcn_delete_admin" on public.procurement_chase_notes;
create policy "pcn_delete_admin"
  on public.procurement_chase_notes
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ─── Touch trigger — stamp who/when on every write ──────────
create or replace function public.procurement_chase_notes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_procurement_chase_notes_touch on public.procurement_chase_notes;
create trigger trg_procurement_chase_notes_touch
  before insert or update on public.procurement_chase_notes
  for each row execute function public.procurement_chase_notes_touch();
