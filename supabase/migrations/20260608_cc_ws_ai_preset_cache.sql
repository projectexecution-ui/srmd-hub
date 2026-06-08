-- Cache AI-generated smart preset prompts per WS so the Ask-AI panel
-- doesn't burn a Gemini call every time someone opens the page.
--
-- Shape (set by /api/cost-control/working-sheets/[id]/ai-presets):
--   {
--     "presets": [{ "label": "string", "prompt": "string" }],
--     "model":   "gemini-2.5-flash-lite" | "llama-3.3-70b-versatile",
--     "generated_at": "ISO-8601 timestamp"
--   }
--
-- Invalidated when the sheet is re-parsed (cc_excel_rows replaced) or by
-- the user clicking "Refresh suggestions" in the panel.

ALTER TABLE public.cc_working_sheets
  ADD COLUMN IF NOT EXISTS ai_preset_prompts JSONB;

COMMENT ON COLUMN public.cc_working_sheets.ai_preset_prompts IS
  'Cached AI preset suggestions for the Ask-AI panel. Generated once per sheet, reused on subsequent opens to save Gemini quota.';
