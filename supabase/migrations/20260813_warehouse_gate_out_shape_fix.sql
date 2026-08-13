-- A store-to-store move must carry NO project.
--
-- The first version of this check (20260813_warehouse_gate_spine.sql) forbade an
-- engineer and a returnable flag on a move but forgot the project itself — which
-- is precisely the wrong entry the shape exists to prevent: a move that quietly
-- charges a project for material still sitting in our own store.
--
-- Caught by running the constraint test, not by reading the code.
alter table inv_gate_out drop constraint if exists inv_gate_out_shape;
alter table inv_gate_out add constraint inv_gate_out_shape check (
  (dest_type = 'site'
     and project_id      is not null
     and to_warehouse_id is null)
  or
  (dest_type = 'store'
     and to_warehouse_id is not null
     and to_warehouse_id <> from_warehouse_id
     and project_id      is null
     and engineer_id     is null
     and is_returnable   is false)
);
