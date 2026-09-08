-- IN4 feed checks — the three defects the tracker feed copied from IN4's view,
-- with the counts measured on 8 Sep 2026 BEFORE the feed change on revamp-trial.
-- Run against IN4 (SQL Server, read-only login) — e.g. paste into the IN4 SQL
-- client, or wrap in lib/in4 in4Query(). Every statement is a SELECT.
--
-- The feed change (lib/in4/extract-feeds.ts applyPoLine, lib/in4/tracker.ts GRN
-- skip) is DORMANT on revamp-trial: the mirror is written only by main's cron.
-- Whoever merges it to main later re-runs check 1 and 2 against the MIRROR
-- (bottom of this file) and expects zero.

-- ── 1. PO line quantity: the view says the PO total, the detail says the line ─
-- Before: 4,714 PO lines in the view; 424 differ from the detail; 70,78,451 overstated.
WITH v AS (
  SELECT DISTINCT INDENT_ITEM_ID, PO_DETAIL_ID, PO_ORDER_QTY_IN_BASE_UOM view_qty, PO_ORDER_RATE_IN_BASE_UOM view_rate
  FROM PURCH_INDENT_TO_ISSUE WHERE PO_DETAIL_ID IS NOT NULL)
SELECT COUNT(*) po_lines_in_view,
       SUM(CASE WHEN ABS(v.view_qty - d.BASE_PO_QTY) > 0.001 THEN 1 ELSE 0 END) qty_differs,
       SUM(CASE WHEN d.ITEM_ID IS NULL THEN 1 ELSE 0 END) no_detail_row,
       ROUND(SUM(CASE WHEN ABS(v.view_qty - d.BASE_PO_QTY) > 0.001 THEN (v.view_qty - d.BASE_PO_QTY) * v.view_rate ELSE 0 END), 0) value_overstated
FROM v LEFT JOIN BI.FACT_PURCHASE_ORDER_DETAILS d ON d.ITEM_ID = v.PO_DETAIL_ID;

-- ── 2. GRN rows joined to indent lines they have no quantity for ─────────────
-- Before (mirror): 54 GRN entries of 0 qty and 0 value on 47 indent lines.
-- In IN4 terms: view rows whose (GRN, indent, material) has no quantity in the GRN fact.
WITH v AS (SELECT DISTINCT INDENT_ITEM_ID, INDENT_ID, MATERIAL_ID, GRN_ID FROM PURCH_INDENT_TO_ISSUE WHERE GRN_ID IS NOT NULL),
     g AS (SELECT GRN_ID, INDENT_ID, MATERIAL_ID, SUM(BASE_UOM_QTY) qty, SUM(GRN_MATERIAL_COST) value FROM BI.FACT_PURCHASE_GRN_DETAILS GROUP BY GRN_ID, INDENT_ID, MATERIAL_ID)
SELECT COUNT(*) grn_rows_in_view,
       SUM(CASE WHEN g.GRN_ID IS NULL OR (ISNULL(g.qty,0) = 0 AND ISNULL(g.value,0) = 0) THEN 1 ELSE 0 END) rows_with_nothing_received
FROM v LEFT JOIN g ON g.GRN_ID = v.GRN_ID AND g.INDENT_ID = v.INDENT_ID AND g.MATERIAL_ID = v.MATERIAL_ID;

-- ── 3. Supplier bills booked under one PO but received on another ─────────────
-- Before: 4,480 payment rows; 337 under another PO; 90 POs; 73 bills; 73,77,388 paid.
-- NOT fixed by this feed change: in4_supplier_certificates keeps one row per
-- certificate, so a bill spanning two POs cannot be split without a schema
-- change (a new table or a (certificate_id, po_id) key). Until then the
-- revamp's WO/PO tree reads these rows live from IN4 and places them by GRN.
WITH g AS (SELECT DISTINCT GRN_ID, PO_ID FROM BI.FACT_PURCHASE_GRN_DETAILS)
SELECT COUNT(*) payment_rows,
       SUM(CASE WHEN g.PO_ID IS NOT NULL AND g.PO_ID <> p.PO_ID THEN 1 ELSE 0 END) rows_booked_under_other_po,
       COUNT(DISTINCT CASE WHEN g.PO_ID IS NOT NULL AND g.PO_ID <> p.PO_ID THEN g.PO_ID END) pos_affected,
       COUNT(DISTINCT CASE WHEN g.PO_ID IS NOT NULL AND g.PO_ID <> p.PO_ID THEN p.CERTIFICATE_ID END) bills_spanning_pos,
       ROUND(SUM(CASE WHEN g.PO_ID IS NOT NULL AND g.PO_ID <> p.PO_ID THEN p.PAID_AMT ELSE 0 END), 0) paid_misplaced
FROM BI.FACT_PURCHASE_SUPPLIER_PAY p LEFT JOIN g ON g.GRN_ID = p.GRN_ID;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER the feed change is merged and has run: the same two checks on the
-- MIRROR (Supabase, SQL editor). Expected: both zero.
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PO lines in the mirror whose qty × rate exceeds the PO's own material value
--    cannot be checked without the header in the mirror — instead, the direct
--    check: no indent line's ordered_qty may exceed its indent_qty by the whole
--    PO total. Before: 128 POs doubled.
-- select count(*) from in4_indent_items where ordered_qty > indent_qty * 1.5 and jsonb_array_length(coalesce(pos,'[]'::jsonb)) >= 1;
-- 2. GRN entries of nothing. Before: 54.
-- select count(*) from in4_indent_items i, jsonb_array_elements(coalesce(i.grns,'[]'::jsonb)) g
--  where coalesce((g->>'qty')::numeric,0) = 0 and coalesce((g->>'value')::numeric,0) = 0;
