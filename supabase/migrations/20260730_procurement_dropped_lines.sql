-- ============================================================
-- Procurement "not ordering" list — items the team has decided
-- to drop (won't raise a PO / won't chase). Keyed by a stable
-- CONTENT key (indent + block + material) so a drop survives the
-- next IN4 upload even though line row-ids are positional.
--
-- Collaborative like the chase notes: any signed-in tracker user
-- may drop or restore an item (restore = delete the row).
-- ============================================================

create table if not exists public.procurement_dropped_lines (
  line_key    text primary key,
  indent_no   text,
  material    text,
  block       text,
  reason      text,
  dropped_at  timestamptz not null default now(),
  dropped_by  uuid references public.profiles(id) on delete set null
);

comment on table public.procurement_dropped_lines is
  'Items marked "not ordering" in the Indent -> PO Tracker. Presence of a row => hidden from the working lists. Keyed by indent|block|material so it survives re-uploads. Collaborative: any authenticated user may drop/restore.';

alter table public.procurement_dropped_lines enable row level security;

drop policy if exists "pdl_select_all" on public.procurement_dropped_lines;
create policy "pdl_select_all"
  on public.procurement_dropped_lines
  for select to authenticated using (true);

drop policy if exists "pdl_insert_authenticated" on public.procurement_dropped_lines;
create policy "pdl_insert_authenticated"
  on public.procurement_dropped_lines
  for insert to authenticated with check (true);

drop policy if exists "pdl_update_authenticated" on public.procurement_dropped_lines;
create policy "pdl_update_authenticated"
  on public.procurement_dropped_lines
  for update to authenticated using (true) with check (true);

-- Restore = delete the row; any signed-in user may do it (collaborative).
drop policy if exists "pdl_delete_authenticated" on public.procurement_dropped_lines;
create policy "pdl_delete_authenticated"
  on public.procurement_dropped_lines
  for delete to authenticated using (true);

create or replace function public.procurement_dropped_lines_touch()
returns trigger language plpgsql as $$
begin
  new.dropped_at := now();
  new.dropped_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_procurement_dropped_lines_touch on public.procurement_dropped_lines;
create trigger trg_procurement_dropped_lines_touch
  before insert or update on public.procurement_dropped_lines
  for each row execute function public.procurement_dropped_lines_touch();
