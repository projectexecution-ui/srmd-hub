-- Inline-edit fields on the cost-control project detail page:
-- 1. Plan deadline that the PM/Head can set per discipline or sub-skill
--    (separate from the per-WS commitment deadlines)
-- 2. Per-sub-skill thumbrule mode override (some sub-skills inside a
--    detailed-mode discipline might still be thumbrule-only)

ALTER TABLE public.cc_project_disciplines
  ADD COLUMN IF NOT EXISTS target_deadline DATE;

ALTER TABLE public.cc_project_sub_skills
  ADD COLUMN IF NOT EXISTS target_deadline DATE,
  ADD COLUMN IF NOT EXISTS estimation_mode TEXT
    CHECK (estimation_mode IS NULL OR estimation_mode IN ('detailed','thumbrule')),
  ADD COLUMN IF NOT EXISTS thumbrule_rate_per_sft NUMERIC,
  ADD COLUMN IF NOT EXISTS thumbrule_notes TEXT;

COMMENT ON COLUMN public.cc_project_disciplines.target_deadline IS
  'PM/Head plan deadline for the whole discipline. Separate from per-WS deadlines.';
COMMENT ON COLUMN public.cc_project_sub_skills.target_deadline IS
  'PM/Head plan deadline for this sub-skill. Falls back to discipline-level plan when null.';
COMMENT ON COLUMN public.cc_project_sub_skills.estimation_mode IS
  'Per-sub-skill override. NULL = inherit from cc_project_disciplines.estimation_mode.';
