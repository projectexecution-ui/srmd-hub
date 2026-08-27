-- HOD #7: which budgets are adhoc, and which are as per the BOQ estimate.
--
-- His rule: it is a DECLARATION, not something we can derive. The Project Head
-- picks it when he signs off ("Adhoc Option should come from Mayank Project
-- head Level while asking to select"); if he forgets, the Atm Head or the
-- Trustee can set it later. Not selected + working linked = as per BOQ.
--
-- NULLABLE on purpose. false would claim "as per BOQ" for all 69 existing
-- sheets, which nobody has actually said. null means "nobody has been asked
-- yet" — a state we can show honestly and chase.

alter table public.cc_working_sheets
  add column if not exists is_adhoc     boolean,
  add column if not exists adhoc_set_by uuid references public.profiles(id),
  add column if not exists adhoc_set_at timestamptz;

comment on column public.cc_working_sheets.is_adhoc is
  'true = adhoc / extra work outside the BOQ; false = as per BOQ estimate; null = not declared yet. Set by the Project Head at sign-off, or later by the Atm Head / Trustee.';

-- The project view asks "which of this project's sheets are still
-- undeclared?" on every render.
create index if not exists cc_working_sheets_adhoc_idx
  on public.cc_working_sheets (project_id)
  where is_adhoc is null and archived_at is null;
