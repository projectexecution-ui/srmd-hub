-- Hybrid versioning for cost-control working sheets.
--
-- Within a (project_id, discipline_id, sub_skill_id, line_type) bucket,
-- WSes ordered by created_at ASC are auto-numbered v1, v2, v3, … as
-- versions of the same logical scope.
--
-- When the engineer decides "this is a NEW piece of work, not a revision",
-- they tick break_chain=true on the new WS — that resets the version
-- counter back to v1, starting a fresh chain. Older WSes in the same
-- bucket are unaffected: they're version-mates of each other up to the
-- break, and the new chain starts from this WS.
--
-- Computed at read time (window function in queries), not stored as a
-- denormalised version_no column — keeps inserts simple and avoids
-- back-filling when a chain is reordered or a break is toggled.

ALTER TABLE public.cc_working_sheets
  ADD COLUMN IF NOT EXISTS break_chain BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.cc_working_sheets.break_chain IS
  'When true, this WS starts a new version chain within its (project, discipline, sub_skill, line_type) bucket. version_no resets to 1 here, and older WSes in the same bucket stop being its version-mates. Computed read-side via a window function.';

CREATE INDEX IF NOT EXISTS idx_cc_ws_chain_lookup
  ON public.cc_working_sheets (project_id, discipline_id, sub_skill_id, line_type, created_at);

-- View: cc_ws_with_versions — every working sheet decorated with the
-- chain_anchor_id (= id of the WS that started its chain), version_no
-- (1-based within the chain), and chain_size (total versions in the
-- chain). Use this view anywhere the WS list / detail UI needs to show
-- version metadata.
--
-- Pattern: "gaps and islands" — each break_chain=true row increments a
-- running counter (chain_group); within a counter slice, FIRST_VALUE
-- gives the anchor id. Postgres can't MAX(uuid) so we can't use the
-- carry-forward trick directly on ids — the group-counter detour fixes
-- that.
CREATE OR REPLACE VIEW public.cc_ws_with_versions AS
WITH grouped AS (
  SELECT
    ws.*,
    SUM(CASE WHEN ws.break_chain THEN 1 ELSE 0 END) OVER (
      PARTITION BY ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type
      ORDER BY ws.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS chain_group
  FROM public.cc_working_sheets ws
)
SELECT
  g.*,
  FIRST_VALUE(g.id) OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
    ORDER BY g.created_at ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS chain_anchor_id,
  ROW_NUMBER() OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
    ORDER BY g.created_at ASC
  ) AS version_no,
  COUNT(*) OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
  ) AS chain_size
FROM grouped g;

COMMENT ON VIEW public.cc_ws_with_versions IS
  'Per-row version metadata for cost-control working sheets: chain_anchor_id, version_no (1-based), chain_size. Uses a gaps-and-islands cumulative sum so each break_chain=true row starts a fresh chain.';
