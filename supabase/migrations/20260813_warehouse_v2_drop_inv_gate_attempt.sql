-- Warehouse V2 is a SEPARATE module. The gate-register tables from
-- 20260813_warehouse_gate_spine.sql were created in the inv_ namespace with
-- foreign keys into the existing inventory module's item master and stores —
-- too entangled for a module that must stand on its own. Dropped here (all had
-- zero rows) and rebuilt as wh_* in 20260813_warehouse_v2_schema.sql.
--
-- Nothing belonging to the existing inventory module is touched: no inv_ table
-- that existed before today is altered or dropped.
drop table if exists inv_gate_in_lines  cascade;
drop table if exists inv_gate_out_lines cascade;
drop table if exists inv_gate_in        cascade;
drop table if exists inv_gate_out       cascade;
drop table if exists inv_po_lines       cascade;
drop table if exists inv_po             cascade;
drop function if exists fn_inv_can(text);

-- The `security` value added to user_role is kept: Warehouse V2 needs it too,
-- and Postgres cannot remove an enum value without rewriting the type.
