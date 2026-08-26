-- HOD #3: let management close a sub-category once the WO/PO committed figure
-- and the Paid figure match, and show the leftover budget as a saving.
--
-- Deliberately NOT stored on cc_budget_lines: Budget / WO / Paid there are
-- authored by the IN4 -> BPH sync and nothing else may write them, or the next
-- sync silently overwrites us. Completion is our own fact, so it lives on our
-- own row and the saving is derived for display.

alter table public.cc_project_sub_skills
  add column if not exists completed_at   timestamptz,
  add column if not exists completed_by   uuid references public.profiles(id),
  add column if not exists completed_note text;

comment on column public.cc_project_sub_skills.completed_at is
  'Set when management closed this sub-category (WO == Paid). Null = still open. The leftover budget is derived, never written back to cc_budget_lines.';

-- Finding the closed lines for a project is the common read.
create index if not exists cc_project_sub_skills_completed_idx
  on public.cc_project_sub_skills (project_id)
  where completed_at is not null;
