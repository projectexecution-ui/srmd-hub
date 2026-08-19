-- Move warehouse requests onto the hub's SHARED approval matrix.
--
-- Aksha: "Give me liberty and Flexibility to modify the Approval and Request
-- Flow as per my need."
--
-- He already had that machinery and I had not used it. `approval_rules` +
-- `can_approve()` + `enforce_approval_via_matrix()` is a full engine he drives
-- from /admin/approvals for Cost Control, Indents, JMR and the old inventory
-- module. Warehouse had zero rows in it because I built a private three-position
-- dial instead — which meant the one thing he asked for, changing the flow
-- himself, needed me.
--
-- The new `checked` status is what makes an arbitrary chain expressible in rows
-- alone: pending → checked → approved is two stages, and a pending → approved
-- row carrying an amount cap is "this role alone, up to this much".
alter table wh_requests drop constraint if exists wh_requests_status_check;
alter table wh_requests add constraint wh_requests_status_check
  check (status in ('pending','checked','approved','rejected','part_issued','issued','cancelled'));

-- The DATABASE refuses an unauthorised transition, not just the screen. Same
-- trigger every other module uses; est_value is passed so amount caps bite.
drop trigger if exists wh_requests_approval_matrix on wh_requests;
create trigger wh_requests_approval_matrix
  before update on wh_requests
  for each row
  execute function enforce_approval_via_matrix('warehouse', 'wh_request', 'status', 'est_value');

-- A starting chain, seeded ONLY where nothing exists. Plain inserts guarded by
-- NOT EXISTS — never an upsert — so a rule Aksha has since tuned survives a
-- re-run untouched.
insert into approval_rules
  (module_slug, doc_type, from_stage, to_stage, approver_role, override_role,
   amount_cap_max, requires_remarks, is_active, notes)
select v.* from (values
  ('warehouse','wh_request','pending','approved','head','admin',
   200000::numeric,false,true,'Atm Head alone, up to the cap'),
  ('warehouse','wh_request','pending','checked','head','admin',
   null::numeric,false,true,'Atm Head first stage on a big request'),
  ('warehouse','wh_request','checked','approved','founder','admin',
   null::numeric,false,true,'Trustee releases what the Atm Head checked'),
  ('warehouse','wh_request','pending','rejected','head','admin',
   null::numeric,true,true,'Atm Head rejects'),
  ('warehouse','wh_request','checked','rejected','founder','admin',
   null::numeric,true,true,'Trustee rejects what was checked'),
  ('warehouse','wh_request','approved','part_issued','store_manager','admin',
   null::numeric,false,true,'Storekeeper issues part of it'),
  ('warehouse','wh_request','approved','issued','store_manager','admin',
   null::numeric,false,true,'Storekeeper issues all of it'),
  ('warehouse','wh_request','part_issued','issued','store_manager','admin',
   null::numeric,false,true,'Storekeeper completes it')
) as v(module_slug, doc_type, from_stage, to_stage, approver_role, override_role,
       amount_cap_max, requires_remarks, is_active, notes)
where not exists (
  select 1 from approval_rules ar
  where ar.module_slug = 'warehouse' and ar.doc_type = 'wh_request'
);
