-- Stable version numbering: add ws.id as the final ORDER BY key in every
-- window function of cc_ws_with_versions. Without it, two WSes that share
-- a created_at (same-second inserts) get arbitrary v2/v3 order and an
-- unstable chain anchor — the order could flip between reads, making the
-- prev/next sibling nav jump around.
--
-- DROP + CREATE (not CREATE OR REPLACE) because a column was added to
-- cc_working_sheets after the view was first created, shifting g.* column
-- positions — REPLACE can't reorder view columns.

DROP VIEW IF EXISTS public.cc_ws_with_versions;

CREATE VIEW public.cc_ws_with_versions AS
WITH grouped AS (
  SELECT
    ws.*,
    SUM(CASE WHEN ws.break_chain THEN 1 ELSE 0 END) OVER (
      PARTITION BY ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type
      ORDER BY ws.created_at ASC, ws.id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS chain_group
  FROM public.cc_working_sheets ws
)
SELECT
  g.*,
  FIRST_VALUE(g.id) OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
    ORDER BY g.created_at ASC, g.id ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS chain_anchor_id,
  ROW_NUMBER() OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
    ORDER BY g.created_at ASC, g.id ASC
  ) AS version_no,
  COUNT(*) OVER (
    PARTITION BY g.project_id, g.discipline_id, g.sub_skill_id, g.line_type, g.chain_group
  ) AS chain_size
FROM grouped g;

COMMENT ON VIEW public.cc_ws_with_versions IS
  'Per-row version metadata for cost-control working sheets: chain_anchor_id, version_no (1-based), chain_size. Gaps-and-islands cumulative sum over break_chain; ORDER BY (created_at, id) for stable numbering on same-second inserts.';
