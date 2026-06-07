-- Per-row AI metadata for cost-control working-sheet rows.
-- Single JSONB column = cheap to add, easy to extend. Shape:
--   {
--     "suggested_sub_skill_id": "uuid"  -- AI's guess for which sub-skill this row belongs to
--     "confidence": 0.0-1.0
--     "cleaned_description": "string"   -- AI-cleaned version of the raw text
--     "rate_concern": "string|null"     -- explanation when the rate looks off
--     "category": "material" | "labour" | "material_and_labour" | "equipment" | null
--     "material_value": <number|null>   -- for material_and_labour: just the material portion
--     "labour_value":   <number|null>   -- for material_and_labour: just the labour portion
--     "anomaly": "string|null"          -- e.g. "Looks like a heading row" / "estimated split"
--     "model": "claude-sonnet-4-5"
--   }

ALTER TABLE public.cc_excel_rows
  ADD COLUMN IF NOT EXISTS ai_meta JSONB;

COMMENT ON COLUMN public.cc_excel_rows.ai_meta IS
  'Per-row AI insights produced by /api/cost-control/working-sheets/ai-parse. NULL when AI was not run (no API key) or when Claude declined to enrich this row.';

-- Summary-level AI parse meta on the working sheet itself: which model
-- ran, when, summary count of suggestions, totals split by category.
ALTER TABLE public.cc_working_sheets
  ADD COLUMN IF NOT EXISTS ai_parse_meta JSONB;

COMMENT ON COLUMN public.cc_working_sheets.ai_parse_meta IS
  'Summary of the AI parse pass: model, run_at, rows_in, rows_out, suggestions_count, rate_concerns_count, totals_by_category, split_totals.';
